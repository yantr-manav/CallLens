import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { saveRawTranscript } from '@/lib/storage';
import { normalizeTranscript } from '@/lib/normalize';
import { sha256File } from '@/lib/hash';
import {
  analyzePayloadSchema,
  analysisResultSchema,
  validateUploadedFile,
  validateTextContent,
} from '@/lib/validation';
import { dispatchN8nAnalysis } from '@/lib/n8n';
import { mockAnalyze } from '@/lib/mock-analyzer';
import { mode } from '@/lib/config';
import { checkRateLimit } from '@/lib/rate-limit';
import { type FileValidationError } from '@/lib/validation';
import { Errors, fileErrorMessage, json } from '@/lib/errors';

export const maxDuration = 60;

// ── POST /api/analyze — async pipeline (build plan §8.1) ──
// The browser's ONLY entry point. Validates + persists, dispatches the job to
// n8n, and returns 202 immediately. n8n runs Groq in the background and calls
// /api/analyze/callback when done (see §8.5). This keeps the request under
// serverless function limits — works on Vercel Hobby's 10s cap.

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

  // ── Idempotency: same content hash → cached result (never re-bill the LLM)
  const existing = await store.findConversationByHash(user.id, fileHash);
  if (existing) {
    if (existing.status === 'done') {
      return json(
        { conversationId: existing.id, status: 'done', cached: true },
        200
      );
    }
    if (existing.status === 'processing') {
      return json(
        { conversationId: existing.id, status: 'processing', cached: false },
        202
      );
    }
    // 'failed' or 'pending' → fall through and re-run on the same row.
  }

  // §8.6 — rate limit per user (6 analyses / 10 min). Cached hits are
  // exempt: they never touch the LLM.
  const rate = await checkRateLimit(user.id, 6);
  if (!rate.ok) {
    return json(
      { error: Errors.rateLimited, retryAfterSec: rate.retryAfterSec },
      429
    );
  }

  // ── Normalize to canonical turns BEFORE anything reaches n8n (§8.2)
  const normalized = normalizeTranscript(text);
  if (normalized.turns.length === 0) {
    return json({ error: Errors.noTurns }, 422);
  }

  // ── Persist raw transcript + conversation row
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

  // ── Build + validate the n8n payload (contract over the webhook boundary)
  const payload = analyzePayloadSchema.parse({
    conversation_id: conversation.id,
    file_name: file.name,
    app_url: req.nextUrl.origin,
    transcript: normalized.turns.map((t) => ({
      seq: t.seq,
      speaker: t.speaker,
      text: t.text,
      ...(t.timestamp ? { timestamp: t.timestamp } : {}),
    })),
  });

  // ── Analyze: async n8n when configured, deterministic mock otherwise ──
  if (mode.n8nConfigured) {
    // Fire-and-forget: n8n verifies the signature, accepts the job (202), then
    // runs Groq and calls /api/analyze/callback with the result. We return
    // immediately so the request stays inside the serverless time limit.
    const dispatched = await dispatchN8nAnalysis(payload, { timeoutMs: 15_000 });
    if (!dispatched.accepted) {
      // eslint-disable-next-line no-console
      console.error('[/api/analyze] n8n rejected job:', dispatched.code, dispatched.error);
      await store.updateConversationStatus(conversation.id, 'failed');
      if (dispatched.code === 'rejected') {
        return json({ error: Errors.serviceUnavailable }, 502);
      }
      return json({ error: Errors.serviceUnavailable }, 502);
    }
    return json(
      {
        conversationId: conversation.id,
        status: 'processing',
        cached: false,
        detectedFormat: normalized.format,
      },
      202
    );
  }

  // Demo mode: run the mock synchronously and persist at once.
  const result = mockAnalyze(normalized);
  const validated = analysisResultSchema.safeParse(result);
  if (!validated.success) {
    await store.updateConversationStatus(conversation.id, 'failed');
    return json({ error: Errors.invalidOutput }, 502);
  }
  try {
    await store.createAnalysis({
      conversationId: conversation.id,
      result: validated.data,
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
    },
    200
  );
}