import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { saveRawTranscript } from '@/lib/storage';
import { normalizeTranscript } from '@/lib/normalize';
import { sha256File } from '@/lib/hash';
import {
  analyzePayloadSchema,
  validateUploadedFile,
  validateTextContent,
  MAX_ANALYZED_TURNS,
  type FileValidationError,
} from '@/lib/validation';
import { runAnalysis } from '@/lib/analysis-engine';
import { checkRateLimit } from '@/lib/rate-limit';
import { Errors, fileErrorMessage, json } from '@/lib/errors';

export const maxDuration = 60;

// ── POST /api/analyze — the browser's ONLY entry point ──
//
// Synchronous end to end: validate → persist → analyze → return the finished
// report id, typically in 5-7s. The analysis itself goes through the ladder in
// lib/analysis-engine.ts (n8n → direct Groq → heuristic), which is why this
// route no longer has an n8n-vs-mock branch and no longer returns 202.
//
// The previous async design returned 202 and waited for n8n to POST results
// back to /api/analyze/callback. n8n Cloud cannot reach http://localhost:3000,
// so that callback never arrived in local development and uploads sat on
// "processing" forever.

export async function POST(req: NextRequest) {
  try {
    return await handleAnalyze(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[/api/analyze] uncaught:', msg);
    return json({ error: Errors.serviceUnavailable }, 500);
  }
}

async function handleAnalyze(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return json({ error: Errors.unauthorized }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: Errors.noFile }, 400);
  }
  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return json({ error: Errors.noFile }, 400);
  }

  const fileCheck = validateUploadedFile(file);
  if (!fileCheck.ok) {
    return json({ error: fileErrorMessage(fileCheck.error as FileValidationError) }, 400);
  }

  const text = await file.text();
  const contentCheck = validateTextContent(text);
  if (!contentCheck.ok) {
    return json({ error: fileErrorMessage(contentCheck.error as FileValidationError) }, 400);
  }

  const fileHash = await sha256File(file);
  const store = getStore();

  // ── Idempotency: same content hash → serve the cached report, never re-bill
  // the LLM. A row only counts as cached if the analysis actually EXISTS: rows
  // could be marked 'done' with no analysis attached, and every stale
  // 'processing' row left over from the old async design would otherwise be
  // un-analysable forever. Anything else re-runs in place.
  const existing = await store.findConversationByHash(user.id, fileHash);
  if (existing && existing.status === 'done') {
    const detail = await store.getAnalysisDetail(existing.id);
    if (detail) {
      return json(
        {
          conversationId: existing.id,
          status: 'done',
          cached: true,
          engine: detail.analysis.engine ?? null,
          model: detail.analysis.model ?? null,
          degraded: Boolean(detail.analysis.degraded),
        },
        200
      );
    }
  }

  // Rate limit per user (6 analyses / 10 min). Cached hits above are exempt —
  // they never touch the LLM.
  const rate = await checkRateLimit(user.id, 6);
  if (!rate.ok) {
    return json({ error: Errors.rateLimited, retryAfterSec: rate.retryAfterSec }, 429);
  }

  // ── Normalize to canonical turns BEFORE anything reaches n8n ──
  const normalized = normalizeTranscript(text);
  if (normalized.turns.length === 0) {
    return json({ error: Errors.noTurns }, 422);
  }

  // Guard the context window and the latency budget. The payload schema
  // tolerates far more turns than a single LLM call can sensibly handle, so cap
  // it here and tell the user plainly how many were dropped rather than
  // silently analysing a fraction of their call.
  const totalTurns = normalized.turns.length;
  const analyzedTurns = normalized.turns.slice(0, MAX_ANALYZED_TURNS);
  const truncatedTurns = totalTurns - analyzedTurns.length;
  const forAnalysis = { ...normalized, turns: analyzedTurns };

  // ── Persist raw transcript + conversation row ──
  const storagePath = await saveRawTranscript(user.id, fileHash, text);
  let conversation = existing;
  if (!conversation) {
    conversation = await store.createConversation({
      userId: user.id,
      fileName: file.name,
      fileHash,
      storagePath,
    });
  } else {
    await store.updateConversationStatus(conversation.id, 'processing');
  }

  // ── Build + validate the n8n payload (the signed webhook contract) ──
  const payload = analyzePayloadSchema.parse({
    conversation_id: conversation.id,
    file_name: file.name,
    transcript: analyzedTurns.map((t) => ({
      seq: t.seq,
      speaker: t.speaker,
      text: t.text,
      ...(t.timestamp ? { timestamp: t.timestamp } : {}),
    })),
  });

  // ── Analyze (n8n → Groq → heuristic) ──
  const outcome = await runAnalysis(payload, forAnalysis);
  if (!outcome.ok || !outcome.result) {
    // eslint-disable-next-line no-console
    console.error('[/api/analyze] every engine failed:', outcome.error);
    await store.updateConversationStatus(conversation.id, 'failed');
    return json({ error: Errors.serviceUnavailable }, 502);
  }

  try {
    await store.replaceAnalysis({
      conversationId: conversation.id,
      result: outcome.result,
      engine: outcome.engine,
      model: outcome.model,
      latencyMs: outcome.latencyMs,
      degraded: outcome.degraded,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[/api/analyze] store analysis failed:', err);
    await store.updateConversationStatus(conversation.id, 'failed');
    return json({ error: Errors.serviceUnavailable }, 502);
  }

  return json(
    {
      conversationId: conversation.id,
      status: 'done',
      cached: false,
      detectedFormat: normalized.format,
      formatConfidence: normalized.formatConfidence,
      turnCount: analyzedTurns.length,
      truncatedTurns,
      engine: outcome.engine,
      model: outcome.model ?? null,
      latencyMs: outcome.latencyMs,
      degraded: outcome.degraded,
    },
    200
  );
}
