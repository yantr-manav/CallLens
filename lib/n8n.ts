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

// ── v2 → v1 normalization ──
// The n8n prompt (n8n/LLM_PROMPT_AND_SCHEMA.md) asks Gemini for a richer v2
// shape: overall_sentiment as a string, overall_sentiment_score, confidence,
// customer.{satisfaction_start,satisfaction_end,churn_risk}, emotions with
// `emotion` keys and no resolution/risk blocks. The app's canonical shape is
// v1 (§8.4) — DB columns and dashboard are built around it — so v2 is mapped
// here, at the ONLY place n8n output enters the app.
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

  const customer = asObj(raw.customer);
  const agent = asObj(raw.agent);
  const intent = asObj(raw.intent);
  const conf = num(raw.confidence, 1) ?? 0.5;

  const emotions = (Array.isArray(raw.emotions) ? raw.emotions : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .slice(0, 10)
    .map((e) => ({
      label: label(e.emotion ?? e.label, 'unknown').slice(0, 40),
      intensity: num(e.intensity) ?? 0,
    }));

  const moments = (Array.isArray(raw.important_moments) ? raw.important_moments : [])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .slice(0, 10)
    .map((m) => ({
      seq: num(m.seq) ?? 1,
      speaker: label(m.speaker, '').slice(0, 40),
      event: label(m.event, 'Key moment.').slice(0, 200),
    }));

  const sentences = (Array.isArray(raw.sentences) ? raw.sentences : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      seq: num(s.seq) ?? 1,
      speaker: label(s.speaker, '').slice(0, 40),
      text: label(s.text, '').slice(0, 2000),
      sentiment: sentiment(s.sentiment),
      score: num(s.score ?? s.sentiment_score) ?? 50,
      confidence: num(s.confidence, 1) ?? 0.5,
      emotion: label(s.emotion, 'neutral').slice(0, 40),
      ...(s.evidence ? { evidence: label(s.evidence, '').slice(0, 200) } : {}),
    }));

  if (sentences.length === 0) return null;

  const mapped = {
    overall_sentiment: {
      label: sentiment(raw.overall_sentiment),
      score: num(raw.overall_sentiment_score) ?? 50,
      confidence: conf,
    },
    summary: label(raw.summary, 'No summary available.').slice(0, 500),
    intent: {
      category: label(intent.category, 'general').slice(0, 40),
      description: label(intent.description, 'No description available.').slice(0, 200),
    },
    resolution: { status: 'unknown', likelihood: null },
    risk: { escalation: null },
    customer: {
      frustration: null,
      satisfaction: num(customer.satisfaction_end ?? customer.satisfaction),
      effort: null,
    },
    agent: {
      empathy: num(agent.empathy),
      clarity: num(agent.clarity),
      professionalism: num(agent.professionalism),
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