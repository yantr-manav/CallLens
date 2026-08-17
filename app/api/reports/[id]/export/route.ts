import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { toCsv, attachmentHeader } from '@/lib/csv';
import { Errors, json } from '@/lib/errors';

export const dynamic = 'force-dynamic';

// GET /api/reports/[id]/export?format=json|csv
//
// json → the complete analysis including raw_json and every sentence.
// csv  → the sentence-level breakdown, which is the part people actually want
//        in a spreadsheet.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return json({ error: Errors.unauthorized }, 401);

  const store = getStore();
  const conversation = await store.getConversation(user.id, params.id);
  if (!conversation) return json({ error: Errors.notFound }, 404);

  const detail = await store.getAnalysisDetail(conversation.id);
  if (!detail) {
    return json({ error: 'This report has no analysis to export yet.' }, 409);
  }

  const format = req.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const base = (conversation.title || conversation.file_name || 'report').replace(
    /\.txt$/i,
    ''
  );

  if (format === 'csv') {
    const csv = toCsv(
      ['Seq', 'Speaker', 'Text', 'Sentiment', 'Score', 'Confidence', 'Emotion', 'Evidence'],
      detail.sentences.map((s) => [
        s.seq,
        s.speaker,
        s.text,
        s.sentiment,
        s.score,
        s.confidence,
        s.emotion,
        s.evidence ?? '',
      ])
    );
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': attachmentHeader(`${base}-sentences.csv`),
        'Cache-Control': 'no-store',
      },
    });
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    conversation: {
      id: conversation.id,
      fileName: conversation.file_name,
      title: conversation.title ?? null,
      agentName: conversation.agent_name ?? null,
      customerName: conversation.customer_name ?? null,
      tags: conversation.tags ?? [],
      notes: conversation.notes ?? null,
      status: conversation.status,
      createdAt: conversation.created_at,
    },
    provenance: {
      engine: detail.analysis.engine ?? null,
      model: detail.analysis.model ?? null,
      latencyMs: detail.analysis.latency_ms ?? null,
      degraded: Boolean(detail.analysis.degraded),
    },
    analysis: detail.analysis.raw_json,
    sentences: detail.sentences,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachmentHeader(`${base}-analysis.json`),
      'Cache-Control': 'no-store',
    },
  });
}
