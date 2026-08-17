import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FilePlus2,
  Gauge,
  MessagesSquare,
} from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportTable } from '@/components/analysis/report-table';
import { sentimentBadge } from '@/lib/format';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();
  const store = getStore();

  // One read powers both the KPI strip and the recent list.
  const all = await store.listAllForExport(user.id);
  const recent = all.slice(0, 5);

  const analyzed = all.filter((r) => r.overallSentiment !== null);
  const scores = analyzed
    .map((r) => r.overallScore)
    .filter((v): v is number => typeof v === 'number');
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;
  const avgLabel =
    avgScore == null ? null : avgScore >= 60 ? 'positive' : avgScore <= 40 ? 'negative' : 'neutral';

  const resolved = analyzed.filter((r) => r.resolutionStatus === 'resolved').length;
  const resolvedPct = analyzed.length
    ? Math.round((resolved / analyzed.length) * 100)
    : null;

  const riskiest = analyzed
    .filter((r) => typeof r.escalationRisk === 'number')
    .sort((a, b) => (b.escalationRisk ?? 0) - (a.escalationRisk ?? 0))[0];

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = all.filter((r) => new Date(r.createdAt).getTime() >= weekAgo).length;

  const avgMeta = sentimentBadge(avgLabel as 'positive' | 'neutral' | 'negative' | null);

  return (
    <AppShell user={user}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sentiment and KPIs from your recent call analyses.
          </p>
        </div>
        <Button asChild>
          <Link href="/analyze">
            <FilePlus2 className="h-4 w-4" />
            Analyze conversation
          </Link>
        </Button>
      </div>

      {all.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Gauge className="h-4 w-4" />}
            label="Average sentiment"
            value={avgScore == null ? '—' : `${avgScore}/100`}
            footer={
              avgMeta ? <Badge variant={avgMeta.badge}>{avgMeta.label}</Badge> : undefined
            }
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Resolved"
            value={resolvedPct == null ? '—' : `${resolvedPct}%`}
            footer={
              <span className="text-xs text-muted-foreground">
                {resolved} of {analyzed.length} analyzed
              </span>
            }
          />
          <StatCard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Highest escalation risk"
            value={riskiest?.escalationRisk != null ? `${riskiest.escalationRisk}/100` : '—'}
            footer={
              riskiest ? (
                <Link
                  href={`/reports/${riskiest.conversationId}`}
                  className="block truncate text-xs text-primary hover:underline"
                >
                  {riskiest.title || riskiest.fileName}
                </Link>
              ) : undefined
            }
          />
          <StatCard
            icon={<MessagesSquare className="h-4 w-4" />}
            label="Analyzed this week"
            value={String(thisWeek)}
            footer={
              <span className="text-xs text-muted-foreground">
                {all.length} total
              </span>
            }
          />
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Recent analyses</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/reports" className="text-muted-foreground">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-secondary">
                <FilePlus2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No analyses yet</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Upload a{' '}
                  <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">
                    .txt
                  </code>{' '}
                  call transcript to get started.
                </p>
              </div>
              <Button asChild size="sm">
                <Link href="/analyze">Analyze a conversation</Link>
              </Button>
            </div>
          ) : (
            <ReportTable reports={recent} />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function StatCard({
  icon,
  label,
  value,
  footer,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </p>
        {footer && <div className="mt-1.5">{footer}</div>}
      </CardContent>
    </Card>
  );
}
