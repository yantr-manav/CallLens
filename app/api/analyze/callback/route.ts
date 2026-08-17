import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/db/store';
import { normalizeAnalysisResult } from '@/lib/n8n';
import { env } from '@/lib/config';
import { analysisResultSchema } from '@/lib/validation';
import { Errors } from '@/lib/errors';

// ── POST /api/analyze/callback ──
// Async result sink. n8n calls this after Groq finishes (build plan §8.5).
// Authenticated by a shared secret header — NOT a user session (n8n is the
// caller). The job is matched to its conversation row by `jobId`.

export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(req: NextRequest) {
  // 1. Shared-secret auth (the same secret n8n uses to sign outbound calls).
  const provided = req.headers.get('x-calllens-callback') ?? '';
  if (!env.n8nWebhookSecret || provided !== env.n8nWebhookSecret) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const obj = (body ?? {}) as Record<string, unknown>;
  const jobId = typeof obj.jobId === 'string' ? obj.jobId : '';
  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  const store = getStore();

  // 2. n8n reports a failure for this job → mark it failed and ack.
  if (obj.error) {
    await store.updateConversationStatus(jobId, 'failed');
    return NextResponse.json({ ok: true, status: 'failed' });
  }

  // 3. Otherwise validate + persist the result.
  const normalized = normalizeAnalysisResult(obj.result);
  const validated = normalized ? analysisResultSchema.safeParse(normalized) : null;
  if (!validated || !validated.success) {
    // eslint-disable-next-line no-console
    console.error('[/api/analyze/callback] invalid result for', jobId);
    await store.updateConversationStatus(jobId, 'failed');
    return NextResponse.json({ ok: true, status: 'failed' });
  }

  try {
    await store.createAnalysis({ conversationId: jobId, result: validated.data });
    await store.updateConversationStatus(jobId, 'done');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[/api/analyze/callback] store failed:', err);
    await store.updateConversationStatus(jobId, 'failed');
    return NextResponse.json({ ok: true, status: 'failed' });
  }

  return NextResponse.json({ ok: true, status: 'done' });
}
