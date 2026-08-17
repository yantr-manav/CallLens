import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { ReportsList } from '@/components/reports/reports-list';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const user = await requireUser();
  const store = getStore();
  // One round-trip: the store returns the page and the total together.
  const { items: initial, total } = await store.listReports(user.id, {
    limit: 10,
    offset: 0,
  });

  return (
    <AppShell user={user}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} conversation{total === 1 ? '' : 's'} analyzed.
          </p>
        </div>
        <Button asChild>
          <Link href="/analyze">
            <Plus className="h-4 w-4" />
            New analysis
          </Link>
        </Button>
      </div>

      <ReportsList initial={initial} initialTotal={total} />
    </AppShell>
  );
}