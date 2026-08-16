import Link from 'next/link';
import type { ReportSummary } from '@/lib/db/store';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { sentimentBadge, resolutionLabel } from '@/lib/format';
import { timeAgo } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export function StatusBadge({ status }: { status: ReportSummary['status'] }) {
  switch (status) {
    case 'done':
      return null;
    case 'processing':
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Processing
        </Badge>
      );
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="secondary">Pending</Badge>;
  }
}

export function ReportTable({
  reports,
  showStatus = true,
}: {
  reports: ReportSummary[];
  showStatus?: boolean;
}) {
  if (reports.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No analyses yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[42%]">Conversation</TableHead>
          <TableHead>Sentiment</TableHead>
          <TableHead>Resolution</TableHead>
          <TableHead>Escalation risk</TableHead>
          <TableHead className="text-right">Analyzed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reports.map((r) => {
          const meta = sentimentBadge(r.overallSentiment);
          return (
            <TableRow key={r.conversationId} className="cursor-pointer">
              <TableCell className="max-w-0">
                <Link
                  href={`/reports/${r.conversationId}`}
                  className="block truncate font-medium hover:underline"
                >
                  {r.fileName}
                </Link>
                {showStatus && <StatusBadge status={r.status} />}
              </TableCell>
              <TableCell>
                {meta ? (
                  <Badge variant={meta.badge}>{meta.label}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {r.resolutionStatus ? (
                  <span className="text-sm">
                    {resolutionLabel[r.resolutionStatus] ?? r.resolutionStatus}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {r.escalationRisk != null ? (
                  <span className="text-sm">{r.escalationRisk}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {timeAgo(r.createdAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </div>
  );
}