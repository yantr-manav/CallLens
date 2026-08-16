import 'server-only';
import { env, mode } from '@/lib/config';
import {
  analyzePayloadSchema,
  analysisResultSchema,
  type AnalysisResultSchemaType,
} from '@/lib/validation';
import type { AnalyzePayload } from '@/lib/validation';
import type { AnalysisResult } from '@/lib/types';

// ── n8n webhook caller — the ONLY boundary where Next.js talks to n8n.
// The browser never sees N8N_WEBHOOK_URL. The request is HMAC-signed with
// N8N_WEBHOOK_SECRET; n8n's first node validates the signature and rejects
// anything that doesn't match (build plan §8.5). ──

export interface N8nResponse {
  ok: boolean;
  result?: AnalysisResult;
  error?: string;
  code?: 'unreachable' | 'invalid_output' | 'timeout' | 'rejected' | 'unknown';
}

async function hmac(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.n8nWebhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(body)
  );
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export async function callN8nAnalysis(
  payload: AnalyzePayload,
  opts: { timeoutMs?: number; maxRetries?: number } = {}
): Promise<N8nResponse> {
  if (!mode.n8nConfigured) {
    return {
      ok: false,
      code: 'unreachable',
      error: 'n8n is not configured (local demo mode).',
    };
  }

  const body = JSON.stringify(payload);
  const signature = await hmac(body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);

  let lastError: string | undefined;
  const attempts = Math.max(1, opts.maxRetries ?? 1);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(env.n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
        },
        body,
        signal: controller.signal,
      });

      if (res.status === 401 || res.status === 403) {
        return { ok: false, code: 'rejected', error: 'Webhook signature rejected.' };
      }
      if (!res.ok) {
        lastError = `n8n responded ${res.status}`;
        // backoff before retry
        if (attempt < attempts) await sleep(2 ** attempt * 250);
        continue;
      }

      const json = await res.json().catch(() => null);
      if (!json) {
        return { ok: false, code: 'invalid_output', error: 'Empty response from n8n.' };
      }
      const result = normalizeAnalysisResult(json);
      if (!result) {
        return { ok: false, code: 'invalid_output', error: 'Invalid analysis output from n8n.' };
      }
      return { ok: true, result };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, code: 'timeout', error: 'n8n request timed out.' };
      }
      lastError = err instanceof Error ? err.message : 'unknown fetch error';
      if (attempt < attempts) await sleep(2 ** attempt * 250);
    }
  }
  clearTimeout(timeout);
  return {
    ok: false,
    code: 'unreachable',
    error: lastError ?? 'n8n unreachable.',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── v1 normalization ──
// Gemini is prompted with a rich schema (n8n/LLM_PROMPT_AND_SCHEMA.md) but
// does NOT reliably follow it key-for-key across runs — observed variants:
//   flat v2:  overall_sentiment:"positive", overall_sentiment_score, confidence,
//             customer.{satisfaction_start,satisfaction_end,churn_risk},
//             emotions[].{emotion,intensity}
//   nested:   overall_sentiment:{score,label,confidence}, customer.{initial_
//             sentiment,final_sentiment,satisfaction_score,intent:{category,
//             description}}, important_moments[].{seq,event,impact}
// The app's canonical shape is v1 (§8.4) — DB columns and dashboard are built
// around it — so ANY variant is mapped here, at the ONLY place n8n output
// enters the app. Fallbacks are only used when the value is truly absent.
export function normalizeAnalysisResult(
  input: unknown
): AnalysisResultSchemaType | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  // Already v1 (or exactly matching) — validate directly.
  const direct = analysisResultSchema.safeParse(input);
  if (direct.success) return direct.data;

  const asObj = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  // First defined non-null value across candidate keys.
  const pick = (
    o: Record<string, unknown>,
    ...keys: string[]
  ): unknown => {
    for (const k of keys) {
      const v = o[k];
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  };
  const num = (v: unknown, max = 100): number | null => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return Math.min(max, Math.max(0, v));
  };
  const label = (v: unknown, fallback: string): string => {
    const s = String(v ?? '').trim();
    return s.length > 0 ? s : fallback;
  };
  const sentiment = (v: unknown): 'positive' | 'neutral' | 'negative' =>
    v === 'positive' || v === 'neutral' || v === 'negative' ? v : 'neutral';

  // overall_sentiment: string (flat v2) or object (nested variant).
  const os = asObj(raw.overall_sentiment);
  const osLabel = sentiment(
    typeof raw.overall_sentiment === 'string'
      ? raw.overall_sentiment
      : pick(os, 'label', 'sentiment', 'value')
  );
  const osScore = num(
    pick(raw, 'overall_sentiment_score', 'overall_score') ?? pick(os, 'score')
  );
  const conf = num(pick(raw, 'confidence') ?? pick(os, 'confidence'), 1) ?? 0.5;

  // intent: top-level or nested inside customer.
  const customer = asObj(raw.customer);
  const intent = asObj(raw.intent ?? pick(customer, 'intent'));

  const emotions = (Array.isArray(raw.emotions) ? raw.emotions : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .slice(0, 10)
    .map((e) => ({
      label: label(pick(e, 'emotion', 'label', 'name'), 'unknown').slice(0, 40),
      intensity: num(pick(e, 'intensity', 'score')) ?? 0,
    }));

  const moments = (Array.isArray(raw.important_moments) ? raw.important_moments : [])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .slice(0, 10)
    .map((m) => ({
      seq: num(pick(m, 'seq')) ?? 1,
      speaker: label(pick(m, 'speaker'), '').slice(0, 40),
      event: label(pick(m, 'event', 'description', 'summary'), 'Key moment.').slice(0, 200),
    }));

  const sentences = (Array.isArray(raw.sentences) ? raw.sentences : Array.isArray(raw.turns) ? raw.turns : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      seq: num(pick(s, 'seq')) ?? 1,
      speaker: label(pick(s, 'speaker'), '').slice(0, 40),
      text: label(pick(s, 'text'), '').slice(0, 2000),
      sentiment: sentiment(pick(s, 'sentiment', 'label')),
      score: num(pick(s, 'score', 'sentiment_score')) ?? 50,
      confidence: num(pick(s, 'confidence', 'sentiment_confidence'), 1) ?? 0.5,
      emotion: label(pick(s, 'emotion'), 'neutral').slice(0, 40),
      ...(s.evidence ? { evidence: label(s.evidence, '').slice(0, 200) } : {}),
    }));

  if (sentences.length === 0) return null;

  const mapped = {
    overall_sentiment: {
      label: osLabel,
      score: osScore ?? 50,
      confidence: conf,
    },
    summary: label(raw.summary, 'No summary available.').slice(0, 500),
    intent: {
      category: label(pick(intent, 'category', 'name', 'type'), 'general').slice(0, 40),
      description: label(pick(intent, 'description', 'summary'), 'No description available.').slice(0, 200),
    },
    resolution: { status: 'unknown', likelihood: null },
    risk: { escalation: null },
    customer: {
      frustration: null,
      satisfaction: num(
        pick(customer, 'satisfaction_end', 'satisfaction_score', 'satisfaction', 'final_satisfaction')
      ),
      effort: null,
    },
    agent: {
      empathy: num(pick(asObj(raw.agent), 'empathy', 'empathy_score')),
      clarity: num(pick(asObj(raw.agent), 'clarity', 'clarity_score')),
      professionalism: num(pick(asObj(raw.agent), 'professionalism', 'professionalism_score')),
    },
    emotions,
    important_moments: moments,
    sentences,
  };

  const check = analysisResultSchema.safeParse(mapped);
  return check.success ? check.data : null;
}

// Re-export the payload schema helper for callers that build the payload.
export { analyzePayloadSchema };