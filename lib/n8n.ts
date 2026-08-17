import 'server-only';
import { env, mode } from '@/lib/config';
import { analyzePayloadSchema } from '@/lib/validation';
import { normalizeAnalysisResult } from '@/lib/normalize-result';
import type { AnalyzePayload, AnalysisResultSchemaType } from '@/lib/validation';

// ── n8n webhook caller — the ONLY boundary where Next.js talks to n8n ──
//
// The browser never sees N8N_WEBHOOK_URL. The request is HMAC-SHA256 signed
// with N8N_WEBHOOK_SECRET; n8n's Verify Signature node recomputes the digest
// over the received body and rejects anything that doesn't match.
//
// ARCHITECTURE NOTE — this is a SYNCHRONOUS call.
// The previous design fired the job at n8n, took a 202, and waited for n8n to
// POST the result back to /api/analyze/callback. That could never work in local
// development, because n8n Cloud cannot reach http://localhost:3000 — which is
// why uploads sat on "processing" forever. Groq answers in ~4s, and Vercel
// allows far more than that, so n8n now responds with the finished analysis on
// the same connection. No callback, no polling, no job state to get stuck in.

export type N8nFailure =
  | 'unreachable'
  | 'invalid_output'
  | 'timeout'
  | 'rejected'
  | 'unknown';

export interface N8nResponse {
  ok: boolean;
  result?: AnalysisResultSchemaType;
  model?: string;
  error?: string;
  code?: N8nFailure;
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
  opts: { timeoutMs?: number } = {}
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
  const timeoutMs = opts.timeoutMs ?? env.n8nTimeoutMs;

  try {
    const res = await fetch(env.n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
      },
      body,
      // AbortSignal.timeout cleans itself up. The hand-rolled
      // AbortController+setTimeout this replaced leaked a timer on every
      // early return.
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: 'rejected', error: 'Webhook signature rejected.' };
    }

    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!res.ok && !json) {
      return { ok: false, code: 'unreachable', error: `n8n responded ${res.status}` };
    }
    if (!json) {
      return { ok: false, code: 'invalid_output', error: 'Empty response from n8n.' };
    }

    // n8n Cloud serves non-2xx Respond-node bodies over HTTP 200, so a
    // rejection must be detected from the envelope, not the status code.
    const envelope = json as {
      ok?: unknown;
      error?: unknown;
      result?: unknown;
      model?: unknown;
    };
    if (typeof envelope.error === 'string' && envelope.ok !== true) {
      const err = envelope.error;
      return {
        ok: false,
        code: err.toLowerCase().includes('signature') ? 'rejected' : 'invalid_output',
        error: err,
      };
    }

    // Accept both the current envelope ({ ok, engine, model, result }) and a
    // bare analysis object, so an older workflow build still works.
    const rawResult = envelope.result ?? json;
    const result = normalizeAnalysisResult(rawResult);
    if (!result) {
      return {
        ok: false,
        code: 'invalid_output',
        error: 'Invalid analysis output from n8n.',
      };
    }

    return {
      ok: true,
      result,
      model: typeof envelope.model === 'string' ? envelope.model : undefined,
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError');
    if (isTimeout) {
      return {
        ok: false,
        code: 'timeout',
        error: `n8n did not respond within ${timeoutMs}ms.`,
      };
    }
    return {
      ok: false,
      code: 'unreachable',
      error: err instanceof Error ? err.message : 'unknown fetch error',
    };
  }
}

// Re-export the payload schema helper for callers that build the payload.
export { analyzePayloadSchema };
export { normalizeAnalysisResult };
