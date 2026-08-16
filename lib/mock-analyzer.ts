import 'server-only';
import type {
  AnalysisResult,
  NormalizedTranscript,
  SentenceResult,
  SentimentLabel,
  TranscriptTurn,
} from '@/lib/types';

// ── Offline mock analyzer (demo mode fallback) ──
// Used ONLY when n8n isn't configured. Produces a schema-valid AnalysisResult
// from lexicon heuristics so the whole dashboard is demonstrable end-to-end.
// Deterministic: the same transcript always yields the same result (so
// idempotency caching behaves correctly). Respects §8.4 hard rules: metrics
// with no evidence are null, never guessed; agent.* null unless an agent is
// identifiable; no chain-of-thought; enums from fixed lists.

const POSITIVE = new Set([
  'thanks', 'thank', 'great', 'perfect', 'resolved', 'helpful', 'appreciate',
  'wonderful', 'excellent', 'glad', 'happy', 'good', 'love', 'satisfied',
  'awesome', 'fixed', 'working', 'sure', 'correct', 'pleased', 'kind',
]);
const NEGATIVE = new Set([
  'angry', 'frustrated', 'frustrating', 'upset', 'broken', 'useless', 'terrible',
  'horrible', 'wait', 'waiting', 'cancelled', 'canceled', 'wrong', 'refund',
  'complain', 'complaint', 'issue', 'problem', 'disappointed', 'unacceptable',
  'hate', 'fail', 'failed', 'rude', 'unresolved', 'charged', 'overcharged',
]);
const NEGATORS = new Set(['not', "n't", 'no', 'never', "isn't", "doesn't", "wasn't"]);

const EMPATHY = new Set(['sorry', 'apologize', 'understand', 'understandably', 'hear', 'appreciate']);
const CLARITY = new Set(['sure', 'absolutely', 'here', 'step', 'let me', 'first', 'next', 'confirm', 'exactly']);
const PROF = new Set(['thank', 'please', 'certainly', 'welcome', 'regards', 'kindly', 'gladly']);

const AGENT_RE = /(agent|rep|representative|support|advisor|operator|associate|staff)/i;
const CUSTOMER_RE = /(customer|caller|client|user)/i;

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Lexicon-based sentence sentiment. Considers negation.
export function scoreText(text: string): { score: number; pos: number; neg: number } {
  const w = words(text);
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < w.length; i++) {
    const word = w[i] ?? '';
    const prev1 = w[i - 1] ?? '';
    const prev2 = w[i - 2] ?? '';
    const negated = NEGATORS.has(prev1) || NEGATORS.has(prev2);
    if (POSITIVE.has(word)) negated ? neg++ : pos++;
    else if (NEGATIVE.has(word)) negated ? pos++ : neg++;
  }
  const delta = pos - neg;
  const score = clamp(50 + delta * 14, 0, 100);
  return { score, pos, neg };
}

function labelOf(score: number): SentimentLabel {
  if (score >= 60) return 'positive';
  if (score <= 40) return 'negative';
  return 'neutral';
}

function pickEmotion(turn: TranscriptTurn, scoreInfo: { pos: number; neg: number }): string {
  const t = turn.text.toLowerCase();
  if (/\b(angry|mad|furious|outrage)\b/.test(t)) return 'angry';
  if (/\b(frustrated?|annoyed|irritated)\b/.test(t)) return 'frustrated';
  if (/\b(thank|appreciate|glad|great|happy|pleased)\b/.test(t)) return 'grateful';
  if (/\b(sorry|apolog)\b/.test(t)) return 'apologetic';
  if (/\b(worried|concerned|scared|afraid)\b/.test(t)) return 'anxious';
  if (/\b(confused|don't understand|unsure)\b/.test(t)) return 'confused';
  if (/\b(relieved|finally|got it)\b/.test(t)) return 'relieved';
  if (scoreInfo.neg > scoreInfo.pos) return 'frustrated';
  if (scoreInfo.pos > 0) return 'grateful';
  return 'neutral';
}

function detectIntentCategory(turns: TranscriptTurn[]): string {
  const all = turns.map((t) => t.text).join(' ').toLowerCase();
  const map: Array<[string, RegExp]> = [
    ['billing', /\b(bill|invoice|charge|charged|payment|refund|overcharg)/],
    ['outage', /\b(outage|down|offline|no signal|no service)/],
    ['technical', /\b(error|bug|crash|not working|broken|glitch|fail)/],
    ['shipping', /\b(shipping|delivery|delivered|package|tracking)/],
    ['account', /\b(account|login|password|access|sign in|2fa|reset)/],
    ['product', /\b(product|feature|upgrade|plan|renew|cancel)/],
  ];
  for (const [cat, re] of map) if (re.test(all)) return cat;
  return 'general inquiry';
}

export function mockAnalyze(transcript: NormalizedTranscript): AnalysisResult {
  const turns = transcript.turns;

  const sentences: SentenceResult[] = turns.map((turn, i) => {
    const info = scoreText(turn.text);
    const label = labelOf(info.score);
    return {
      seq: i + 1,
      speaker: turn.speaker,
      text: turn.text,
      sentiment: label,
      score: info.score,
      confidence: clamp(0.55 + (info.pos + info.neg) * 0.08, 0.5, 0.95),
      emotion: pickEmotion(turn, info),
      evidence: turn.text.length <= 80 ? turn.text : turn.text.slice(0, 79).trimEnd(),
    };
  });

  const avgScore = Math.round(
    sentences.reduce((a, s) => a + s.score, 0) / Math.max(1, sentences.length)
  );
  const sentimentCounts = sentences.reduce(
    (acc, s) => {
      acc[s.sentiment]++;
      return acc;
    },
    { positive: 0, neutral: 0, negative: 0 }
  );
  const dominant: SentimentLabel =
    sentimentCounts.positive >= sentimentCounts.negative
      ? sentimentCounts.positive > 0 || avgScore >= 60
        ? 'positive'
        : 'neutral'
      : 'negative';
  const overallConfidence = clamp(
    0.7 + Math.abs(avgScore - 50) / 150,
    0.6,
    0.95
  );

  const allText = turns.map((t) => t.text).join(' ');
  const agentIdentifiable = turns.some((t) => AGENT_RE.test(t.speaker));
  const customerIdentifiable = turns.some((t) => CUSTOMER_RE.test(t.speaker));

  // agent scores from agent-only turns
  let empathy: number | null = null;
  let clarity: number | null = null;
  let professionalism: number | null = null;
  if (agentIdentifiable) {
    const agentTurns = turns.filter((t) => AGENT_RE.test(t.speaker));
    const w = words(agentTurns.map((t) => t.text).join(' '));
    const scoreFromSet = (set: Set<string>): number | null => {
      const hits = w.filter((x) => set.has(x)).length;
      return hits > 0 ? clamp(60 + hits * 10, 60, 95) : null;
    };
    empathy = scoreFromSet(EMPATHY);
    clarity = scoreFromSet(CLARITY);
    professionalism = scoreFromSet(PROF);
  }

  // customer metrics
  let frustration: 'low' | 'medium' | 'high' | null = null;
  let satisfaction: number | null = null;
  let effort: 'low' | 'medium' | 'high' | null = null;
  if (customerIdentifiable) {
    const custTurns = turns.filter((t) => CUSTOMER_RE.test(t.speaker));
    const negCount = custTurns.reduce(
      (a, t) => a + scoreText(t.text).neg,
      0
    );
    frustration = negCount === 0 ? 'low' : negCount <= 2 ? 'medium' : 'high';
    const custAvg =
      custTurns.reduce((a, t) => a + scoreText(t.text).score, 0) /
      Math.max(1, custTurns.length);
    satisfaction = Math.round(custAvg);
    const totalWords = custTurns.reduce((a, t) => a + words(t.text).length, 0);
    effort = totalWords < 30 ? 'low' : totalWords < 80 ? 'medium' : 'high';
  }

  // resolution
  const hasResolvedSignal = /\b(resolved|fixed|thank you,? (agent|for)|all set|that works|great,? thanks)\b/i.test(
    allText
  );
  const hasUnresolved = /\b(still|not fixed|unresolved|escalat|manager|supervisor)\b/i.test(
    allText
  );
  let resolutionStatus: 'resolved' | 'unresolved' | 'partial' | 'unknown' = 'unknown';
  let resolutionLikelihood: number | null = null;
  if (customerIdentifiable || agentIdentifiable) {
    if (hasResolvedSignal && !hasUnresolved) {
      resolutionStatus = 'resolved';
      resolutionLikelihood = clamp(avgScore + 10, 60, 95);
    } else if (hasUnresolved) {
      resolutionStatus = 'unresolved';
      resolutionLikelihood = clamp(100 - avgScore, 10, 40);
    } else {
      resolutionStatus = 'partial';
      resolutionLikelihood = clamp(avgScore, 35, 70);
    }
  }

  // escalation risk — only when customer is identifiable
  let escalation: number | null = null;
  if (customerIdentifiable) {
    const neg = sentences.reduce((a, s) => a + (s.sentiment === 'negative' ? 1 : 0), 0);
    escalation = clamp(
      Math.round((neg / Math.max(1, sentences.length)) * 100) +
        (hasUnresolved ? 15 : 0),
      0,
      100
    );
  }

  // emotions aggregate (label -> max intensity)
  const emoMap = new Map<string, number>();
  for (const s of sentences) {
    const intensity = s.sentiment === 'negative' ? clamp(s.score, 40, 95) : s.sentiment === 'positive' ? clamp(s.score, 40, 95) : 40;
    emoMap.set(s.emotion, Math.max(emoMap.get(s.emotion) ?? 0, intensity));
  }
  const emotions = Array.from(emoMap.entries())
    .filter(([label]) => label !== 'neutral')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, intensity]) => ({ label, intensity }));

  // important moments: top sentiment swings + keyword lines
  const important = sentences
    .map((s) => ({
      s,
      weight: Math.abs(s.score - 50) + (/\b(refund|cancel|manager|issue|problem|broken|fail|resolved|thank)\b/i.test(s.text) ? 20 : 0),
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)
    .map(({ s }) => ({
      seq: s.seq,
      speaker: s.speaker,
      event: s.text.length > 60 ? s.text.slice(0, 59) + '\u2026' : s.text,
    }));

  // summary (≤3 sentences)
  const firstText = turns[0]?.text ?? '';
  const lastText = turns[turns.length - 1]?.text ?? '';
  const summaryParts = [
    `Customer reached out regarding ${detectIntentCategory(turns)}.`,
    firstText
      ? `Opened: "${firstText.length > 60 ? firstText.slice(0, 59) + '\u2026' : firstText}"`
      : '',
    resolutionStatus === 'resolved'
      ? 'The interaction was resolved.'
      : resolutionStatus === 'unresolved'
      ? 'The interaction ended unresolved.'
      : 'Outcome was partially addressed.',
    lastText && lastText !== firstText
      ? `Closed: "${lastText.length > 60 ? lastText.slice(0, 59) + '\u2026' : lastText}"`
      : '',
  ].filter(Boolean).slice(0, 3);
  const summary = summaryParts.join(' ');

  return {
    overall_sentiment: { label: dominant, score: avgScore, confidence: Number(overallConfidence.toFixed(2)) },
    summary,
    intent: { category: detectIntentCategory(turns), description: 'Inferred from transcript lexicon (demo analyzer).' },
    resolution: { status: resolutionStatus, likelihood: resolutionLikelihood },
    risk: { escalation },
    customer: { frustration, satisfaction, effort },
    agent: { empathy, clarity, professionalism },
    emotions: emotions.length > 0 ? emotions : [{ label: 'neutral', intensity: 40 }],
    important_moments: important.length > 0 ? important : [{ seq: 1, speaker: turns[0]?.speaker ?? 'unknown', event: turns[0]?.text.slice(0, 60) ?? 'n/a' }],
    sentences,
  };
}