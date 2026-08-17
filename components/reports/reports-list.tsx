'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Search, Trash2 } from 'lucide-react';
import type { ReportSummary } from '@/lib/db/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { ReportTable } from '@/components/analysis/report-table';
import { ConfirmDialog } from '@/components/reports/confirm-dialog';

type Filter = 'all' | 'positive' | 'neutral' | 'negative';
type Sort = 'newest' | 'oldest' | 'score_desc' | 'score_asc';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'positive', label: 'Positive' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'negative', label: 'Negative' },
];

const SORTS: Array<{ key: Sort; label: string }> = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'score_desc', label: 'Highest score' },
  { key: 'score_asc', label: 'Lowest score' },
];

const PAGE_SIZE = 10;

export function ReportsList({
  initial,
  initialTotal,
}: {
  initial: ReportSummary[];
  initialTotal: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ReportSummary[]>(initial);
  const [total, setTotal] = useState(initialTotal);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  // Skip the fetch on first render — the server already supplied page 1.
  const firstRender = useRef(true);

  const fetchPage = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(offset),
          sentiment: filter,
          sort,
        });
        if (search.trim()) qs.set('q', search.trim());

        const res = await fetch(`/api/reports?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data?.error ?? 'Could not load reports.');
          return;
        }
        setItems((prev) => (replace ? (data.items ?? []) : [...prev, ...(data.items ?? [])]));
        setTotal(data.total ?? 0);
      } catch {
        toast.error('Could not reach the server.');
      } finally {
        setLoading(false);
      }
    },
    [filter, sort, search]
  );

  // Debounce the search box; filter and sort changes apply immediately.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      setSelected(new Set());
      void fetchPage(0, true);
    }, 250);
    return () => clearTimeout(t);
  }, [fetchPage]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(items.map((r) => r.conversationId)) : new Set());
  }

  function reload() {
    setSelected(new Set());
    void fetchPage(0, true);
    router.refresh();
  }

  async function bulkDelete() {
    const ids = [...selected];
    const res = await fetch('/api/reports/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data?.error ?? 'Could not delete the selected reports.');
      return;
    }
    toast.success(`Deleted ${data.deleted} report${data.deleted === 1 ? '' : 's'}.`);
    reload();
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? 'secondary' : 'ghost'}
                onClick={() => setFilter(f.key)}
                disabled={loading}
                className="h-7 px-2.5 text-xs"
              >
                {f.label}
              </Button>
            ))}
          </div>

          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, file or agent…"
              className="h-7 pl-8 text-xs"
              aria-label="Search reports"
            />
          </div>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort reports"
            className="h-7 rounded-md border border-input bg-card px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>

          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" asChild>
            <a href="/api/reports/export">
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </a>
          </Button>
        </div>

        {selected.size > 0 && (
          <div className="mb-3 flex items-center justify-between rounded-md border border-border bg-accent/40 px-3 py-2">
            <span className="text-xs font-medium">
              {selected.size} selected
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setBulkOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete selected
              </Button>
            </div>
          </div>
        )}

        <div className="mb-2 text-right text-xs text-muted-foreground">
          Showing {items.length} of {total}
        </div>

        <ReportTable
          reports={items}
          selectable
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          showActions
          onChanged={reload}
        />

        {items.length < total && (
          <div className="mt-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchPage(items.length, false)}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`Delete ${selected.size} report${selected.size === 1 ? '' : 's'}?`}
        description="Their analyses, sentence breakdowns and stored transcripts will be permanently removed. This cannot be undone."
        confirmLabel={`Delete ${selected.size}`}
        onConfirm={bulkDelete}
      />
    </Card>
  );
}
