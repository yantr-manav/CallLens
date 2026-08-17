import 'server-only';
import { env, mode } from '@/lib/config';
import contract from '@/lib/analysis-contract.json';
import { normalizeAnalysisResult } from '@/lib/normalize-result';
import type { AnalysisResultSchemaType } from '@/lib/validation';
import type { TranscriptTurn } from '@/lib/types';

// ── In-app Groq client — the FALLBACK engine ──
//
// The primary path is n8n (UI → n8n → AI), which is the architecture the
// assignment grades. This module exists so that an n8n outage, a cold start, or
// a misconfigured webhook secret never turns into an error screen during a
// demo. It deliberately reads the SAME prompt and schema from
// lib/analysis-contract.json that gets baked into the n8n Code node, so the two
// engines cannot drift apart.
//
// SECURITY: `server-only` above makes this a build error if it is ever imported
// from a client component. GROQ_API_KEY must never gain a NEXT_PUBLIC_ prefix.

export type GroqFailure = 'unreachable' | 'invalid_output' | 'timeout' | 'unknown';

export interface GroqOutcome {
  ok: boolean;
  result?: AnalysisResultSchemaType;
  model?: string;
  code?: GroqFailure;
  error?: string;
}

/**
 * Renders turns exactly as the n8n `Build Request` node does, so both engines
 * see byte-identical user content.
 */
export function buildUserContent(turns: TranscriptTurn[]): string {
  return turns.map((t) => `${t.speaker}: ${t.text}`).join('\n');
}

/**
 * The rules text plus the literal JSON schema.
 *
 * Groq's `json_object` mode guarantees only that the reply is *some* valid
 * JSON — it enforces no shape. If the schema isn't spelled out in the prompt
 * the model invents its own keys: an earlier build shipped the rules alone and
 * the model silently dropped `resolution`, `risk` and `customer` entirely,
 * which is what rendered as "Resolution: Unknown / Escalation Risk: —".
 *
 * Baked into the n8n Build Request node by scripts/build-n8n-workflow.mjs using
 * exactly this concatenation, so both engines send identical bytes.
 */
export function buildSystemPrompt(): string {
  return (
    contract.systemPrompt +
    '\n\nSCHEMA — your reply must be a single JSON object with EXACTLY these keys and types:\n' +
    JSON.stringify(contract.jsonSchema)
  );
}

export function buildMessages(turns: TranscriptTurn[]) {
  return [
    { role: 'system' as const, content: buildSystemPrompt() },
    { role: 'user' as const, content: buildUserContent(turns) },
  ];
}

/**
 * Sizes the completion budget to fit Groq's per-request token admission check.
 *
 * Groq admits a request only if `prompt_tokens + max_completion_tokens` is
 * within the tier's TPM limit — the *requested* total, not the actual usage.
 * A fixed 8192 therefore returned HTTP 413 "Request too large" on an 11-turn
 * transcript. This computes the largest completion budget that still fits,
 * and trims the transcript itself if even the minimum won't.
 *
 * Mirrored verbatim in the n8n `Build Request` node (scripts/build-n8n-workflow.mjs).
 */
export function planRequest(userContent: string): {
  content: string;
  maxCompletionTokens: number;
  truncatedChars: number;
} {
  const {
    tpmLimit,
    tpmSafetyMargin,
    systemPromptTokens,
    charsPerToken,
    minCompletionTokens,
    maxCompletionTokens,
    maxUserChars,
  } = contract;

  let content = userContent;
  let truncatedChars = 0;
  if (content.length > maxUserChars) {
    truncatedChars = content.length - maxUserChars;
    // Cut on a line boundary so we never split a turn mid-sentence.
    const cut = content.slice(0, maxUserChars);
    const lastNewline = cut.lastIndexOf('\n');
    content = lastNewline > 0 ? cut.slice(0, lastNewline) : cut;
  }

  const promptTokens = systemPromptTokens + Math.ceil(content.length / charsPerToken);
  const available = tpmLimit - tpmSafetyMargin - promptTokens;

  return {
    content,
    maxCompletionTokens: Math.max(
      minCompletionTokens,
      Math.min(maxCompletionTokens, available)
    ),
    truncatedChars,
  };
}

/**
 * Extracts the JSON object from a chat-completion message.
 *
 * gpt-oss models spend part of `max_completion_tokens` on reasoning, so a long
 * transcript can return a *truncated* object. Rather than discard the whole
 * analysis we salvage everything up to the last closing brace — a partial
 * result still normalizes into a usable report.
 */
export function parseModelJson(text: string): unknown | null {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > 0) {
      try {
        return JSON.parse(cleaned.slice(0, lastBrace + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

interface RawCall {
  status: number;
  body: unknown;
  text: string;
}

async function callGroq(
  model: string,
  reasoningEffort: string,
  turns: TranscriptTurn[],
  timeoutMs: number
): Promise<RawCall> {
  const plan = planRequest(buildUserContent(turns));
  const res = await fetch(contract.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.groqApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: plan.content },
      ],
      temperature: contract.temperature,
      reasoning_effort: reasoningEffort,
      max_completion_tokens: plan.maxCompletionTokens,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

function extractContent(body: unknown): string {
  const choices = (body as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const msg = (choices[0] as { message?: { content?: unknown } })?.message;
  return typeof msg?.content === 'string' ? msg.content : '';
}

/**
 * Analyze a transcript directly against Groq.
 *
 * Automatically retries once on the smaller/faster model when the primary is
 * rejected (404 model_not_found), rate-limited (429) or erroring (5xx). That
 * self-healing exists because a silent Groq model decommission
 * (`llama-3.3-70b-versatile`) is precisely what broke this pipeline before.
 */
export async function analyzeWithGroq(
  turns: TranscriptTurn[],
  opts: { timeoutMs?: number } = {}
): Promise<GroqOutcome> {
  if (!mode.groqConfigured) {
    return { ok: false, code: 'unreachable', error: 'GROQ_API_KEY is not set.' };
  }

  const timeoutMs = opts.timeoutMs ?? env.groqTimeoutMs;
  const attempts: Array<{ model: string; effort: string }> = [
    { model: contract.model, effort: contract.reasoningEffort },
    { model: contract.fallbackModel, effort: contract.fallbackReasoningEffort },
  ];

  let lastError = 'Groq call failed.';
  let lastCode: GroqFailure = 'unknown';

  for (const [i, attempt] of attempts.entries()) {
    try {
      const { status, body, text } = await callGroq(
        attempt.model,
        attempt.effort,
        turns,
        timeoutMs
      );

      if (status !== 200) {
        const apiMsg =
          (body as { error?: { message?: string } })?.error?.message ??
          text.slice(0, 200);
        lastError = `Groq ${status}: ${apiMsg}`;
        lastCode = status >= 500 || status === 429 ? 'unreachable' : 'invalid_output';
        // Retry on the smaller model for model/rate/server errors only.
        const retryable = status === 404 || status === 429 || status >= 500;
        if (retryable && i < attempts.length - 1) {
          console.warn(
            `[groq] ${attempt.model} failed (${status}), retrying on ${attempts[i + 1]?.model}`
          );
          continue;
        }
        return { ok: false, code: lastCode, error: lastError, model: attempt.model };
      }

      const parsed = parseModelJson(extractContent(body));
      if (!parsed) {
        lastError = 'Groq returned unparseable JSON.';
        lastCode = 'invalid_output';
        if (i < attempts.length - 1) continue;
        return { ok: false, code: lastCode, error: lastError, model: attempt.model };
      }

      const result = normalizeAnalysisResult(parsed);
      if (!result) {
        lastError = 'Groq output did not satisfy the analysis schema.';
        lastCode = 'invalid_output';
        if (i < attempts.length - 1) continue;
        return { ok: false, code: lastCode, error: lastError, model: attempt.model };
      }

      return { ok: true, result, model: attempt.model };
    } catch (err) {
      const isTimeout =
        err instanceof Error &&
        (err.name === 'TimeoutError' || err.name === 'AbortError');
      lastCode = isTimeout ? 'timeout' : 'unreachable';
      lastError = isTimeout
        ? `Groq timed out after ${timeoutMs}ms.`
        : err instanceof Error
          ? err.message
          : 'unknown fetch error';
      // A timeout will almost certainly repeat on a retry; don't burn the budget.
      if (isTimeout) break;
    }
  }

  return { ok: false, code: lastCode, error: lastError };
}
