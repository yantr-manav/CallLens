import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { readRawTranscript } from '@/lib/storage';
import { normalizeTranscript } from '@/lib/normalize';
import { analyzePayloadSchema, MAX_ANALYZED_TURNS } from '@/lib/validation';
import { runAnalysis } from '@/lib/analysis-engine';
import { checkRateLimit } from '@/lib/rate-limit';
import { Errors, json } from '@/lib/errors';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// POST /api/reports/[id]/rerun — re-analyze a stored transcript in place.
//
// Useful when a run failed, when the prompt has been improved, or to move a
// report off a fallback engine once n8n is healthy again. The analysis row is
// REPLACED (analyses is 1:1 with conversations), so the report id and any
// metadata the user set are preserved.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return json({ error: Errors.unauthorized }, 401);

  const store = getStore();
  const conversation = await store.getConversation(user.id, params.id);
  if (!conversation) return json({ error: Errors.notFound }, 404);

  // A re-run costs a real LLM call, so it counts against the same budget as an
  // upload.
  const rate = await checkRateLimit(user.id, 6);
  if (!rate.ok) {
    return json({ error: Errors.rateLimited, retryAfterSec: rate.retryAfterSec }, 429);
  }

  const text = await readRawTranscript(conversation.storage_path);
  if (!text) {
    return json(
      { error: 'The original transcript is no longer available for this report.' },
      410
    );
  }

  const normalized = normalizeTranscript(text);
  if (normalized.turns.length === 0) return json({ error: Errors.noTurns }, 422);

  const analyzedTurns = normalized.turns.slice(0, MAX_ANALYZED_TURNS);
  const forAnalysis = { ...normalized, turns: analyzedTurns };

  await store.updateConversationStatus(conversation.id, 'processing');

  const payload = analyzePayloadSchema.parse({
    conversation_id: conversation.id,
    file_name: conversation.file_name,
    transcript: analyzedTurns.map((t) => ({
      seq: t.seq,
      speaker: t.speaker,
      text: t.text,
      ...(t.timestamp ? { timestamp: t.timestamp } : {}),
    })),
  });

  const outcome = await runAnalysis(payload, forAnalysis);
  if (!outcome.ok || !outcome.result) {
    // eslint-disable-next-line no-console
    console.error('[/api/reports/rerun] every engine failed:', outcome.error);
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
    console.error('[/api/reports/rerun] store analysis failed:', err);
    await store.updateConversationStatus(conversation.id, 'failed');
    return json({ error: Errors.serviceUnavailable }, 502);
  }

  return json(
    {
      conversationId: conversation.id,
      status: 'done',
      engine: outcome.engine,
      model: outcome.model ?? null,
      latencyMs: outcome.latencyMs,
      degraded: outcome.degraded,
    },
    200
  );
}
