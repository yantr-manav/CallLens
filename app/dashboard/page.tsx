import Link from 'next/link';
import { ArrowRight, FilePlus2 } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportTable } from '@/components/analysis/report-table';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();
  const recent = await getStore().listReports(user.id, 5);

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
                  Upload a <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">.txt</code>{' '}
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