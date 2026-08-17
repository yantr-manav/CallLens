import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore, type ReportMetadataPatch } from '@/lib/db/store';
import { deleteRawTranscripts } from '@/lib/storage';
import { reportMetadataSchema } from '@/lib/validation';
import { Errors, json } from '@/lib/errors';

export const dynamic = 'force-dynamic';

// GET /api/reports/[id] — full analysis detail for the results dashboard.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return json({ error: Errors.unauthorized }, 401);

  const store = getStore();
  const conversation = await store.getConversation(user.id, params.id);
  if (!conversation) return json({ error: Errors.notFound }, 404);

  const detail = await store.getAnalysisDetail(conversation.id);
  return json(
    {
      conversation,
      analysis: detail?.analysis ?? null,
      sentences: detail?.sentences ?? [],
      status: conversation.status,
    },
    200
  );
}

// PATCH /api/reports/[id] — rename / re-tag / annotate.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return json({ error: Errors.unauthorized }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const parsed = reportMetadataSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid report metadata.' },
      400
    );
  }

  const store = getStore();
  // Ownership is enforced by RLS and by the user_id predicate in the store, so
  // a foreign id simply matches nothing and 404s.
  const updated = await store.updateConversationMeta(
    user.id,
    params.id,
    parsed.data as ReportMetadataPatch
  );
  if (!updated) return json({ error: Errors.notFound }, 404);

  return json({ conversation: updated }, 200);
}

// DELETE /api/reports/[id] — removes the conversation, its analysis and
// sentences (via cascade), and the stored transcript blob.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return json({ error: Errors.unauthorized }, 401);

  const store = getStore();
  const result = await store.deleteConversations(user.id, [params.id]);
  if (result.deleted === 0) return json({ error: Errors.notFound }, 404);

  await deleteRawTranscripts(result.storagePaths);
  return json({ deleted: result.deleted }, 200);
}
