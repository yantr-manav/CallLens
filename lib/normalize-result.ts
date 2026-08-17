import {
  analysisResultSchema,
  LIMITS,
  type AnalysisResultSchemaType,
} from '@/lib/validation';

// ── LLM output normalization — the ONLY place raw model output enters the app ──
//
// Groq's `json_object` mode enforces no server-side schema, so the model is
// free to drift: keys get renamed, scores come back as floats, enums arrive as
// synonyms, optional fields vanish. This module maps every observed variant
// onto the app's canonical v1 shape.
//
// DESIGN NOTE — why there is no "strict path" any more:
// The previous version tried `analysisResultSchema.safeParse(input)` first and
// only fell back to a mapper if that failed. But the mapper hardcoded
// `resolution: 'unknown'`, `risk.escalation: null` and `customer.frustration:
// null`, so ANY single schema violation — one over-long summary, one float
// score — silently blanked the entire KPI set. That is exactly what produced
// the "Resolution: Unknown / Escalation Risk: —" rows in production while
// agent.* scores came through fine.
//
// The mapper is now idempotent on already-valid v1 input, so it always runs and
// validation happens exactly once, at the end. There is no lossy branch left to
// fall into.

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};

/** First defined, non-null value across candidate keys. */
function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/**
 * Integer 0..max. Accepts numeric strings ("85", "85%").
 *
 * Rounding matters: every score field is `z.number().int()`, so a model
 * returning `intensity: 72.5` used to fail the final parse and take the whole
 * analysis down with it.
 */
function num(v: unknown, max = 100): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const parsed = Number(v.replace(/[%\s]/g, ''));
    if (!Number.isFinite(parsed)) return null;
    n = parsed;
  } else return null;
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(0, Math.round(n)));
}

/** 0..1 float — must NOT be rounded (it would collapse to 0 or 1). */
function num01(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const parsed = Number(v);
    if (!Number.isFinite(parsed)) return null;
    n = parsed;
  } else return null;
  if (!Number.isFinite(n)) return null;
  // Some models report confidence on a 0-100 scale; rescale rather than clamp
  // everything above 1 down to 1.
  if (n > 1 && n <= 100) n = n / 100;
  return Math.min(1, Math.max(0, n));
}

function str(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s.length > 0 ? s : fallback;
}

/** Truncate at a word boundary rather than mid-word. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

const SENTIMENTS = new Set(['positive', 'neutral', 'negative']);

function sentiment(v: unknown): 'positive' | 'neutral' | 'negative' {
  const s = String(v ?? '').trim().toLowerCase();
  if (SENTIMENTS.has(s)) return s as 'positive' | 'neutral' | 'negative';
  // Common synonyms seen in the wild.
  if (['pos', 'happy', 'satisfied', 'good'].includes(s)) return 'positive';
  if (['neg', 'angry', 'frustrated', 'bad', 'upset'].includes(s)) return 'negative';
  return 'neutral';
}

/** low | medium | high — from an enum, a synonym, or a 0-100 number. */
function tri(v: unknown): 'low' | 'medium' | 'high' | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return v < 34 ? 'low' : v < 67 ? 'medium' : 'high';
  }
  const s = String(v).trim().toLowerCase();
  if (s === 'low' || s === 'medium' || s === 'high') return s;
  if (['minimal', 'none', 'very low', 'slight'].includes(s)) return 'low';
  if (['moderate', 'mid', 'average', 'medium-high'].includes(s)) return 'medium';
  if (['severe', 'very high', 'extreme', 'critical'].includes(s)) return 'high';
  // Numeric string, e.g. "72"
  const n = Number(s);
  if (Number.isFinite(n)) return n < 34 ? 'low' : n < 67 ? 'medium' : 'high';
  return null;
}

const RESOLUTION_SYNONYMS: Record<string, 'resolved' | 'unresolved' | 'partial'> = {
  resolved: 'resolved',
  solved: 'resolved',
  closed: 'resolved',
  fixed: 'resolved',
  complete: 'resolved',
  completed: 'resolved',
  success: 'resolved',
  successful: 'resolved',
  unresolved: 'unresolved',
  open: 'unresolved',
  pending: 'unresolved',
  escalated: 'unresolved',
  failed: 'unresolved',
  ongoing: 'unresolved',
  partial: 'partial',
  partially_resolved: 'partial',
  'partially resolved': 'partial',
  partial_resolution: 'partial',
  'in progress': 'partial',
  in_progress: 'partial',
};

function resolutionStatus(
  v: unknown
): 'resolved' | 'unresolved' | 'partial' | 'unknown' {
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return 'unknown';
  return RESOLUTION_SYNONYMS[s] ?? RESOLUTION_SYNONYMS[s.replace(/ /g, '_')] ?? 'unknown';
}

const SUMMARY_FALLBACK = 'No summary available.';

export function normalizeAnalysisResult(
  input: unknown
): AnalysisResultSchemaType | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Obj;

  // ── overall_sentiment: may be a bare string (flat variant) or an object ──
  const os = asObj(raw.overall_sentiment);
  const osLabelRaw =
    typeof raw.overall_sentiment === 'string'
      ? raw.overall_sentiment
      : pick(os, 'label', 'sentiment', 'value');
  const osScore = num(
    pick(os, 'score') ?? pick(raw, 'overall_sentiment_score', 'overall_score')
  );
  const osConf = num01(pick(os, 'confidence') ?? pick(raw, 'confidence'));

  // ── intent: top-level, or nested under customer ──
  const customer = asObj(raw.customer);
  const agent = asObj(raw.agent);
  const agentScores = asObj(agent.scores);
  const intent = asObj(raw.intent ?? pick(customer, 'intent'));
  const resolution = asObj(raw.resolution);
  const risk = asObj(raw.risk);

  // ── sentences: the backbone. Drop blank rows BEFORE validation, because a
  //    single empty `text` would fail `min(1)` and void the whole analysis. ──
  const rawSentences = Array.isArray(raw.sentences)
    ? raw.sentences
    : Array.isArray(raw.turns)
      ? raw.turns
      : [];

  const sentences = rawSentences
    .filter((s): s is Obj => !!s && typeof s === 'object')
    .map((s, i) => {
      const text = str(pick(s, 'text', 'utterance', 'content'), '');
      const evidence = str(pick(s, 'evidence', 'justification', 'quote'), '');
      return {
        seq: num(pick(s, 'seq', 'index', 'turn'), 100_000) ?? i + 1,
        speaker: clip(str(pick(s, 'speaker', 'role'), ''), LIMITS.speaker),
        text: clip(text, LIMITS.sentenceText),
        sentiment: sentiment(pick(s, 'sentiment', 'label')),
        score: num(pick(s, 'score', 'sentiment_score')) ?? 50,
        confidence: num01(pick(s, 'confidence', 'sentiment_confidence')) ?? 0.5,
        emotion: clip(str(pick(s, 'emotion'), 'neutral'), LIMITS.label),
        ...(evidence ? { evidence: clip(evidence, LIMITS.evidence) } : {}),
      };
    })
    .filter((s) => s.text.length > 0);

  if (sentences.length === 0) return null;

  // `seq` must be >= 1 and unique for the sentence table and the
  // jump-to-moment anchors to work. Renumber only if the model gave us
  // something unusable, so genuine seq alignment with the input is preserved.
  const seqs = sentences.map((s) => s.seq);
  const seqUnusable =
    seqs.some((n) => !Number.isFinite(n) || n < 1) ||
    new Set(seqs).size !== seqs.length;
  if (seqUnusable) sentences.forEach((s, i) => (s.seq = i + 1));

  const validSeqs = new Set(sentences.map((s) => s.seq));

  // ── aggregates: derive honestly from per-sentence data when omitted ──
  const mean = (arr: number[]): number =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const sentenceScores = sentences.map((s) => s.score);

  const osScoreFinal = osScore ?? Math.round(mean(sentenceScores));
  const osLabelFinal =
    osLabelRaw === undefined
      ? osScoreFinal >= 60
        ? 'positive'
        : osScoreFinal <= 40
          ? 'negative'
          : 'neutral'
      : sentiment(osLabelRaw);
  const osConfFinal = osConf ?? mean(sentences.map((s) => s.confidence));

  const emotionsSeen = new Set<string>();
  const emotions = (Array.isArray(raw.emotions) ? raw.emotions : [])
    .filter((e): e is Obj => !!e && typeof e === 'object')
    .map((e) => ({
      label: clip(str(pick(e, 'label', 'emotion', 'name'), ''), LIMITS.label),
      intensity: num(pick(e, 'intensity', 'score')) ?? 0,
    }))
    .filter((e) => {
      if (!e.label) return false;
      const k = e.label.toLowerCase();
      if (emotionsSeen.has(k)) return false;
      emotionsSeen.add(k);
      return true;
    })
    .slice(0, LIMITS.maxEmotions);

  const moments = (Array.isArray(raw.important_moments) ? raw.important_moments : [])
    .filter((m): m is Obj => !!m && typeof m === 'object')
    .map((m) => ({
      seq: num(pick(m, 'seq', 'index'), 100_000) ?? 1,
      speaker: clip(str(pick(m, 'speaker'), ''), LIMITS.speaker),
      event: clip(str(pick(m, 'event', 'description', 'summary'), ''), LIMITS.event),
    }))
    // Drop invented seqs — a moment that deep-links to a non-existent turn is
    // worse than no moment at all.
    .filter((m) => m.event.length > 0 && validSeqs.has(m.seq))
    .slice(0, LIMITS.maxMoments);

  // ── reasoning (optional; absent in analyses stored before it existed) ──
  const reasoningRaw = asObj(raw.reasoning);
  const drivers = (Array.isArray(reasoningRaw.drivers) ? reasoningRaw.drivers : [])
    .filter((d): d is Obj => !!d && typeof d === 'object')
    .map((d) => ({
      factor: clip(str(pick(d, 'factor', 'name'), ''), LIMITS.factor),
      direction:
        sentiment(pick(d, 'direction', 'polarity')) === 'negative'
          ? ('negative' as const)
          : ('positive' as const),
      weight: num(pick(d, 'weight', 'importance')) ?? 50,
      evidence: clip(str(pick(d, 'evidence', 'quote'), ''), LIMITS.evidence),
    }))
    .filter((d) => d.factor.length > 0)
    .slice(0, LIMITS.maxDrivers);

  const counterSignals = (
    Array.isArray(reasoningRaw.counter_signals) ? reasoningRaw.counter_signals : []
  )
    .filter((c): c is Obj => !!c && typeof c === 'object')
    .map((c) => ({
      observation: clip(
        str(pick(c, 'observation', 'note', 'signal'), ''),
        LIMITS.observation
      ),
      evidence: clip(str(pick(c, 'evidence', 'quote'), ''), LIMITS.evidence),
    }))
    .filter((c) => c.observation.length > 0)
    .slice(0, LIMITS.maxCounterSignals);

  const summary = clip(str(raw.summary, SUMMARY_FALLBACK), LIMITS.summary);

  const resolutionStatusFinal = resolutionStatus(
    pick(resolution, 'status') ??
      pick(raw, 'resolution_status', 'outcome', 'call_outcome')
  );
  const resolutionLikelihood =
    num(pick(resolution, 'likelihood', 'probability')) ??
    num(pick(raw, 'resolution_likelihood')) ??
    (() => {
      const c = num01(pick(resolution, 'confidence'));
      return c == null ? null : Math.round(c * 100);
    })();

  const escalation =
    num(pick(risk, 'escalation', 'escalation_risk')) ??
    num(pick(raw, 'escalation_risk')) ??
    num(pick(customer, 'churn_risk')) ??
    (() => {
      // Some variants express escalation only as a tri-level. Bucket midpoints
      // are an approximation, flagged here rather than silently invented.
      const t = tri(pick(risk, 'level', 'escalation_level'));
      return t === 'low' ? 25 : t === 'medium' ? 55 : t === 'high' ? 85 : null;
    })();

  const frustration =
    tri(pick(customer, 'frustration', 'frustration_level')) ??
    tri(pick(raw, 'frustration'));
  const effort =
    tri(pick(customer, 'effort', 'customer_effort', 'ces')) ?? tri(pick(raw, 'effort'));
  const satisfaction =
    num(
      pick(
        customer,
        'satisfaction',
        'satisfaction_end',
        'satisfaction_score',
        'csat',
        'final_satisfaction'
      )
    ) ?? num(pick(customer, 'satisfaction_start'));

  const agentEmpathy =
    num(pick(agent, 'empathy', 'empathy_score')) ??
    num(pick(agentScores, 'empathy')) ??
    num(pick(raw, 'agent_empathy'));
  const agentClarity =
    num(pick(agent, 'clarity', 'clarity_score')) ??
    num(pick(agentScores, 'clarity')) ??
    num(pick(raw, 'agent_clarity'));
  const agentProfessionalism =
    num(pick(agent, 'professionalism', 'professionalism_score')) ??
    num(pick(agentScores, 'professionalism')) ??
    num(pick(raw, 'agent_professionalism'));

  const mapped = {
    overall_sentiment: {
      label: osLabelFinal,
      score: osScoreFinal,
      confidence: osConfFinal,
    },
    summary,
    intent: {
      category: clip(
        str(pick(intent, 'category', 'name', 'type'), 'general'),
        LIMITS.intentCategory
      ),
      description: clip(
        str(pick(intent, 'description', 'summary'), 'No description available.'),
        LIMITS.intentDescription
      ),
    },
    resolution: {
      status: resolutionStatusFinal,
      likelihood: resolutionLikelihood,
    },
    risk: { escalation },
    customer: { frustration, satisfaction, effort },
    agent: {
      empathy: agentEmpathy,
      clarity: agentClarity,
      professionalism: agentProfessionalism,
    },
    emotions,
    important_moments: moments,
    ...(drivers.length > 0 || counterSignals.length > 0
      ? { reasoning: { drivers, counter_signals: counterSignals } }
      : {}),
    sentences,
  };

  // ── Garbage floor ──
  // Coercing this aggressively means we could manufacture a plausible-looking
  // report out of noise. If the model gave us nothing but sentence rows — no
  // summary and not a single derived metric — treat it as a failed analysis so
  // the caller falls through to the next engine instead of persisting a fake.
  const everyMetricNull =
    resolutionLikelihood == null &&
    escalation == null &&
    frustration == null &&
    effort == null &&
    satisfaction == null &&
    agentEmpathy == null &&
    agentClarity == null &&
    agentProfessionalism == null;
  if (summary === SUMMARY_FALLBACK && everyMetricNull && emotions.length === 0) {
    return null;
  }

  const check = analysisResultSchema.safeParse(mapped);
  if (!check.success) {
    // Should be unreachable — every field above is clamped/clipped to LIMITS.
    // Log loudly rather than silently returning a blank report.
    console.error(
      '[normalize] mapped result still failed schema:',
      check.error.issues.slice(0, 5)
    );
    return null;
  }
  return check.data;
}
