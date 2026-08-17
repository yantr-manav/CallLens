import { Flag } from 'lucide-react';
import type { AnalysisResult } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// The turns that changed the direction of the call. Each one deep-links to its
// row in the sentence table (which renders `id="turn-N"` and highlights these
// seqs), so a reviewer can jump straight from "what mattered" to "what was said".
export function KeyMoments({ result }: { result: AnalysisResult }) {
  const moments = result.important_moments ?? [];
  if (moments.length === 0) return null;

  const bySeq = new Map(result.sentences.map((s) => [s.seq, s]));

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Flag className="h-4 w-4 text-muted-foreground" />
          Key moments
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {moments.map((m) => {
            const turn = bySeq.get(m.seq);
            return (
              <li key={`${m.seq}-${m.event}`} className="flex gap-3">
                <a
                  href={`#turn-${m.seq}`}
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[11px] font-medium tabular-nums transition-colors hover:border-primary hover:text-primary"
                  title={`Jump to turn ${m.seq}`}
                >
                  {m.seq}
                </a>
                <div className="min-w-0">
                  <p className="text-sm text-foreground/90">{m.event}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {m.speaker || turn?.speaker || 'unknown'}
                    {turn && ` · “${turn.text.slice(0, 80)}${turn.text.length > 80 ? '…' : ''}”`}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
