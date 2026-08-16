import type { AnalysisResult } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSentimentDistribution } from '@/lib/format';

const COLORS: Record<string, string> = {
  positive: 'bg-success',
  neutral: 'bg-warning',
  negative: 'bg-destructive',
};

export function SentimentDistribution({
  result,
}: {
  result: AnalysisResult;
}) {
  const dist = formatSentimentDistribution(result.sentences);
  const total = result.sentences.length;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Sentiment distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
          {dist.map((d) => (
            <div
              key={d.label}
              className={COLORS[d.label]}
              style={{ width: `${d.pct * 100}%` }}
              title={`${d.label}: ${d.count} (${Math.round(d.pct * 100)}%)`}
            />
          ))}
        </div>
        <div className="mt-4 space-y-2.5">
          {dist.map((d) => (
            <div key={d.label} className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${COLORS[d.label]}`} />
              <span className="capitalize text-muted-foreground">{d.label}</span>
              <span className="ml-auto tabular-nums">
                {d.count} <span className="text-xs text-muted-foreground">({Math.round(d.pct * 100)}%)</span>
              </span>
            </div>
          ))}
          {total === 0 && (
            <p className="text-sm text-muted-foreground">
              No sentence-level sentiment available.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}