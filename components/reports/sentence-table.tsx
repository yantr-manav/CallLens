'use client';

import { useMemo, useState } from 'react';
import type { AnalysisResult } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'positive' | 'neutral' | 'negative';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'positive', label: 'Positive' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'negative', label: 'Negative' },
];

export function SentenceTable({
  result,
  highlightSeqs,
}: {
  result: AnalysisResult;
  /** Seqs called out as important moments — highlighted and link-targetable. */
  highlightSeqs?: number[];
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const highlighted = useMemo(() => new Set(highlightSeqs ?? []), [highlightSeqs]);

  const rows = useMemo(
    () =>
      filter === 'all'
        ? result.sentences
        : result.sentences.filter((s) => s.sentiment === filter),
    [filter, result.sentences]
  );

  function toggle(seq: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-medium">Sentence-level analysis</h2>
          <p className="text-xs text-muted-foreground">
            One row per transcript turn. Click a row to see the evidence behind
            its label.
          </p>
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? 'secondary' : 'ghost'}
              onClick={() => setFilter(f.key)}
              className="h-7 px-2.5 text-xs"
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          No sentences in this filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14 text-right">#</TableHead>
              <TableHead className="w-32">Speaker</TableHead>
              <TableHead>Text</TableHead>
              <TableHead className="w-24">Sentiment</TableHead>
              <TableHead className="w-20">Score</TableHead>
              <TableHead className="w-28">Emotion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => {
              const isOpen = expanded.has(s.seq);
              const expandable = s.text.length > 100 || Boolean(s.evidence);
              const text = isOpen
                ? s.text
                : s.text.length > 100
                  ? `${s.text.slice(0, 100)}…`
                  : s.text;
              return (
                <TableRow
                  key={s.seq}
                  id={`turn-${s.seq}`}
                  className={cn(
                    'scroll-mt-24',
                    highlighted.has(s.seq) && 'bg-accent/40'
                  )}
                >
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {s.seq}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-medium">{s.speaker}</span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      'max-w-0 text-sm',
                      expandable && 'cursor-pointer hover:underline'
                    )}
                    onClick={() => expandable && toggle(s.seq)}
                    title={
                      expandable
                        ? isOpen
                          ? 'Click to collapse'
                          : 'Click to see the evidence'
                        : undefined
                    }
                  >
                    {text}
                    {/* The model's verbatim justification for this label — the
                        core of the "clear reasoning" requirement. It was
                        captured in raw_json all along but never rendered. */}
                    {isOpen && s.evidence && (
                      <blockquote className="mt-1.5 border-l-2 border-primary/40 pl-2 text-xs italic text-muted-foreground">
                        “{s.evidence}”
                      </blockquote>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        s.sentiment === 'positive'
                          ? 'success'
                          : s.sentiment === 'negative'
                          ? 'destructive'
                          : 'warning'
                      }
                      className="capitalize"
                    >
                      {s.sentiment}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {s.score}
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({Math.round(s.confidence * 100)}%)
                    </span>
                  </TableCell>
                  <TableCell className="text-xs capitalize text-muted-foreground">
                    {s.emotion || '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
      )}
    </div>
  );
}