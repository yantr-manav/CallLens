'use client';

import { useState } from 'react';
import type { ReportSummary } from '@/lib/db/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ReportTable } from '@/components/analysis/report-table';

type Filter = 'all' | 'positive' | 'neutral' | 'negative';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'positive', label: 'Positive' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'negative', label: 'Negative' },
];

export function ReportsList({
  initial,
  initialTotal,
}: {
  initial: ReportSummary[];
  initialTotal: number;
}) {
  const [items, setItems] = useState<ReportSummary[]>(initial);
  const [total, setTotal] = useState(initialTotal);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(false);

  async function apply(nextFilter: Filter) {
    setFilter(nextFilter);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/reports?limit=10&offset=0&sentiment=${nextFilter}`
      );
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (items.length >= total) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/reports?limit=10&offset=${items.length}&sentiment=${filter}`
      );
      const data = await res.json();
      setItems((prev) => [...prev, ...(data.items ?? [])]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? 'secondary' : 'ghost'}
                onClick={() => apply(f.key)}
                disabled={loading}
                className="h-7 px-2.5 text-xs"
              >
                {f.label}
              </Button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            Showing {items.length} of {total}
          </span>
        </div>

        <ReportTable reports={items} />

        {items.length < total && (
          <div className="mt-3 flex justify-center">
            <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
              {loading ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}