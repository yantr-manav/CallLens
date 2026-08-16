import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { Errors, json } from '@/lib/errors';

// GET /api/analyze/status/[id] — poll job status (used when the analysis is
// async via the /api/n8n-callback path, or just to confirm completion).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return json({ error: Errors.unauthorized }, 401);

  const conversation = await getStore().getConversation(user.id, params.id);
  if (!conversation) return json({ error: Errors.notFound }, 404);

  return json(
    {
      conversationId: conversation.id,
      status: conversation.status,
      fileName: conversation.file_name,
      createdAt: conversation.created_at,
    },
    200
  );
}