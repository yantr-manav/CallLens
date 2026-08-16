import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { Errors, json } from '@/lib/errors';

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
  if (!detail) {
    return json(
      {
        conversation,
        analysis: null,
        sentences: [],
        status: conversation.status,
      },
      200
    );
  }

  return json(
    {
      conversation,
      analysis: detail.analysis,
      sentences: detail.sentences,
      status: conversation.status,
    },
    200
  );
}