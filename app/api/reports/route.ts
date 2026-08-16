import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { Errors, json } from '@/lib/errors';

// GET /api/reports?limit=&offset=&sentiment=positive|neutral|negative
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return json({ error: Errors.unauthorized }, 401);

  const url = req.nextUrl;
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  const sentiment = (url.searchParams.get('sentiment') ?? 'all') as string;

  const store = getStore();
  // Fetch a bigger page than needed so we can client-filter by sentiment cheaply;
  // for the assignment scale this is fine and avoids more SQL plumbing.
  const items = await store.listReports(user.id, 100, 0);
  const filtered =
    sentiment === 'all'
      ? items
      : items.filter((r) => r.overallSentiment === sentiment);

  const total = await store.countReports(user.id);
  const page = filtered.slice(offset, offset + limit);

  return json(
    {
      items: page,
      total: sentiment === 'all' ? total : filtered.length,
      limit,
      offset,
    },
    200
  );
}