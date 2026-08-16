import type { AnalysisResult } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function EmotionBars({ result }: { result: AnalysisResult }) {
  const emotions = result.emotions.slice(0, 4);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Emotion signals
        </CardTitle>
      </CardHeader>
      <CardContent>
        {emotions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not enough evidence to detect dominant emotions.
          </p>
        ) : (
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {emotions.map((e) => (
              <div key={e.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="capitalize">{e.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {e.intensity}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${e.intensity}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}