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
import { timeAgo, cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { ReportActions } from '@/components/reports/report-actions';

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
  selectable = false,
  selected,
  onToggle,
  onToggleAll,
  showActions = false,
  onChanged,
}: {
  reports: ReportSummary[];
  showStatus?: boolean;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: (checked: boolean) => void;
  showActions?: boolean;
  onChanged?: () => void;
}) {
  if (reports.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No analyses yet.
      </p>
    );
  }

  const allSelected =
    selectable && reports.length > 0 && reports.every((r) => selected?.has(r.conversationId));

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-8">
                {/* Native checkbox: @radix-ui/react-checkbox isn't a dependency
                    and one control doesn't justify adding it. */}
                <input
                  type="checkbox"
                  aria-label="Select all reports on this page"
                  checked={allSelected}
                  onChange={(e) => onToggleAll?.(e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary"
                />
              </TableHead>
            )}
            <TableHead className={selectable ? 'w-[34%]' : 'w-[42%]'}>
              Conversation
            </TableHead>
            <TableHead>Sentiment</TableHead>
            <TableHead>Resolution</TableHead>
            <TableHead>Escalation risk</TableHead>
            <TableHead className="text-right">Analyzed</TableHead>
            {showActions && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.map((r) => {
            const meta = sentimentBadge(r.overallSentiment);
            const isSelected = selected?.has(r.conversationId) ?? false;
            return (
              <TableRow
                key={r.conversationId}
                className={cn(isSelected && 'bg-accent/40')}
              >
                {selectable && (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.title || r.fileName}`}
                      checked={isSelected}
                      onChange={() => onToggle?.(r.conversationId)}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary"
                    />
                  </TableCell>
                )}
                <TableCell className="max-w-0">
                  <Link
                    href={`/reports/${r.conversationId}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {r.title || r.fileName}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {showStatus && <StatusBadge status={r.status} />}
                    {r.degraded && (
                      <Badge variant="warning" title="Produced without an LLM">
                        Heuristic
                      </Badge>
                    )}
                    {r.tags.slice(0, 3).map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                    {r.tags.length > 3 && (
                      <span className="text-[10px] text-muted-foreground">
                        +{r.tags.length - 3}
                      </span>
                    )}
                  </div>
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
                {showActions && (
                  <TableCell className="text-right">
                    <ReportActions
                      conversationId={r.conversationId}
                      fileName={r.fileName}
                      hasAnalysis={Boolean(r.analysisId)}
                      meta={{
                        title: r.title,
                        agentName: r.agentName,
                        customerName: null,
                        tags: r.tags,
                        notes: null,
                      }}
                      onChanged={onChanged}
                    />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
