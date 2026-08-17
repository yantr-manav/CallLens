import 'server-only';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { toCsv, attachmentHeader } from '@/lib/csv';
import { Errors, json } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const HEADERS = [
  'Report ID',
  'Title',
  'File name',
  'Agent',
  'Tags',
  'Status',
  'Overall sentiment',
  'Score',
  'Resolution',
  'Escalation risk',
  'Engine',
  'Degraded',
  'Created at',
];

// GET /api/reports/export — every report for the signed-in user as CSV.
export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return json({ error: Errors.unauthorized }, 401);

  const reports = await getStore().listAllForExport(user.id);

  const csv = toCsv(
    HEADERS,
    reports.map((r) => [
      r.conversationId,
      r.title ?? '',
      r.fileName,
      r.agentName ?? '',
      r.tags,
      r.status,
      r.overallSentiment ?? '',
      r.overallScore ?? '',
      r.resolutionStatus ?? '',
      r.escalationRisk ?? '',
      r.engine ?? '',
      r.degraded ? 'yes' : 'no',
      r.createdAt,
    ])
  );

  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': attachmentHeader(`calllens-reports-${date}.csv`),
      'Cache-Control': 'no-store',
    },
  });
}
