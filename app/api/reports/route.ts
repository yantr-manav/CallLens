import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore, type ReportFilter, type ReportSort } from '@/lib/db/store';
import { Errors, json } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const SENTIMENTS = new Set(['all', 'positive', 'neutral', 'negative']);
const SORTS = new Set<ReportSort>(['newest', 'oldest', 'score_desc', 'score_asc']);

// GET /api/reports?limit=&offset=&sentiment=&q=&sort=
//
// Filtering, searching, sorting and paging are all pushed into the store (and
// from there into PostgREST). The previous implementation always fetched 100
// rows and sliced them in JS, so offset > 100 returned nothing and the total
// was wrong whenever a sentiment filter was active.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return json({ error: Errors.unauthorized }, 401);

  const params = req.nextUrl.searchParams;
  const rawSentiment = params.get('sentiment') ?? 'all';
  const rawSort = params.get('sort') ?? 'newest';

  const filter: ReportFilter = {
    limit: Math.min(50, Math.max(1, Number(params.get('limit') ?? 10) || 10)),
    offset: Math.max(0, Number(params.get('offset') ?? 0) || 0),
    sentiment: SENTIMENTS.has(rawSentiment)
      ? (rawSentiment as ReportFilter['sentiment'])
      : 'all',
    sort: SORTS.has(rawSort as ReportSort) ? (rawSort as ReportSort) : 'newest',
  };
  const q = params.get('q')?.trim();
  if (q) filter.q = q.slice(0, 100);

  const { items, total } = await getStore().listReports(user.id, filter);

  return json({ items, total, limit: filter.limit, offset: filter.offset }, 200);
}
