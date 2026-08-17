import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { deleteRawTranscripts } from '@/lib/storage';
import { bulkDeleteSchema } from '@/lib/validation';
import { Errors, json } from '@/lib/errors';

export const dynamic = 'force-dynamic';

// POST /api/reports/bulk-delete  { ids: string[] }
//
// POST rather than DELETE-with-a-body: some proxies and fetch implementations
// strip bodies from DELETE requests.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return json({ error: Errors.unauthorized }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Provide between 1 and 50 report ids.' }, 400);
  }

  const store = getStore();
  // deleteConversations filters by user_id, so ids belonging to someone else are
  // silently skipped rather than deleted.
  const result = await store.deleteConversations(user.id, parsed.data.ids);
  await deleteRawTranscripts(result.storagePaths);

  return json({ deleted: result.deleted }, 200);
}
