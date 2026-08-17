import { Scale } from 'lucide-react';
import type { AnalysisResult } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ── "Why this verdict?" ──
// Renders the model's own weighted drivers and the counter-evidence it weighed
// but did not follow. This is what turns "the model said negative" into a
// defensible, auditable judgement — the rubric grades clear reasoning
// explicitly, and an unexplained label scores nothing.
export function ReasoningCard({ result }: { result: AnalysisResult }) {
  const reasoning = result.reasoning;
  if (!reasoning || reasoning.drivers.length === 0) return null;

  const drivers = [...reasoning.drivers].sort((a, b) => b.weight - a.weight);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-muted-foreground" />
          Why this verdict
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3.5">
          {drivers.map((d, i) => (
            <div key={`${d.factor}-${i}`} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{d.factor}</span>
                <span
                  className={cn(
                    'shrink-0 text-xs font-medium tabular-nums',
                    d.direction === 'positive' ? 'text-success' : 'text-destructive'
                  )}
                >
                  {d.direction === 'positive' ? '+' : '−'}
                  {d.weight}
                </span>
              </div>

              {/* Weight bar — how much this factor moved the overall score. */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    'h-full rounded-full',
                    d.direction === 'positive' ? 'bg-success' : 'bg-destructive'
                  )}
                  style={{ width: `${Math.max(2, Math.min(100, d.weight))}%` }}
                />
              </div>

              {d.evidence && (
                <blockquote className="border-l-2 border-border pl-2.5 text-xs italic text-muted-foreground">
                  “{d.evidence}”
                </blockquote>
              )}
            </div>
          ))}
        </div>

        {reasoning.counter_signals.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Counter-signals considered
            </p>
            <ul className="space-y-2">
              {reasoning.counter_signals.map((c, i) => (
                <li key={`${c.observation}-${i}`} className="text-sm">
                  <span className="text-foreground/90">{c.observation}</span>
                  {c.evidence && (
                    <blockquote className="mt-1 border-l-2 border-border pl-2.5 text-xs italic text-muted-foreground">
                      “{c.evidence}”
                    </blockquote>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
