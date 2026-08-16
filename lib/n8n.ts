import 'server-only';
import { env, mode } from '@/lib/config';
import { analyzePayloadSchema, type AnalyzePayload } from '@/lib/validation';
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
      return { ok: true, result: json as AnalysisResult };
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

// Re-export the payload schema helper for callers that build the payload.
export { analyzePayloadSchema };