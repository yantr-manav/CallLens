import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { json } from '@/lib/errors';

// ── GET /api/analyze/status/[id] ──
// Lightweight poll endpoint for the async client. Returns the job status so
// the UI can show progress and navigate to the report once 'done'.

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = await params;
  const store = getStore();
  const conversation = await store.getConversation(user.id, id);
  if (!conversation) return json({ error: 'Not found' }, 404);

  return json(
    {
      conversationId: conversation.id,
      status: conversation.status,
      createdAt: conversation.created_at,
    },
    200
  );
}
