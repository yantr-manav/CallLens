import { Activity, MessagesSquare, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { AnalysisResult } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  talkShare,
  trajectory,
  volatility,
  longestNegativeStreak,
  perSpeakerSentiment,
} from '@/lib/kpi';
import { cn } from '@/lib/utils';

// Call-centre KPIs derived from the sentence-level data — no extra LLM call.
export function DerivedKpis({ result }: { result: AnalysisResult }) {
  const sentences = result.sentences ?? [];
  if (sentences.length === 0) return null;

  const share = talkShare(sentences);
  const arc = trajectory(sentences);
  const vol = volatility(sentences);
  const streak = longestNegativeStreak(sentences);
  const speakers = perSpeakerSentiment(sentences);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Derived call KPIs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Talk share ── */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Talk share
          </p>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
            {share.map((s, i) => (
              <div
                key={s.speaker}
                title={`${s.speaker}: ${s.charShare}% (${s.turns} turns)`}
                style={{ width: `${s.charShare}%` }}
                className={cn(
                  'h-full',
                  i === 0 ? 'bg-primary' : i === 1 ? 'bg-primary/55' : 'bg-primary/30'
                )}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {share.map((s) => (
              <span key={s.speaker} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{s.speaker}</span>{' '}
                {s.charShare}% · {s.turns} turn{s.turns === 1 ? '' : 's'}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* ── Trajectory ── */}
          <Metric
            label="Sentiment arc"
            value={
              arc ? (
                <span className="flex items-center gap-1.5">
                  {arc.direction === 'recovered' ? (
                    <TrendingUp className="h-4 w-4 text-success" />
                  ) : arc.direction === 'deteriorated' ? (
                    <TrendingDown className="h-4 w-4 text-destructive" />
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                  {arc.delta > 0 ? '+' : ''}
                  {arc.delta}
                </span>
              ) : (
                '—'
              )
            }
            hint={arc ? `${arc.start} → ${arc.end} (first vs last third)` : undefined}
          />

          {/* ── Volatility ── */}
          <Metric
            label="Emotional turbulence"
            value={vol ? `σ ${vol.stdDev}` : '—'}
            hint={vol ? `${vol.level} variation between turns` : undefined}
          />

          {/* ── Negative streak ── */}
          <Metric
            label="Longest negative run"
            value={streak ? `${streak.length} turns` : 'none'}
            hint={
              streak
                ? streak.recoveredAtSeq
                  ? `turns ${streak.startSeq}–${streak.endSeq}, recovered at ${streak.recoveredAtSeq}`
                  : `turns ${streak.startSeq}–${streak.endSeq}, never recovered`
                : 'no two consecutive negative turns'
            }
          />
        </div>

        {/* ── Per-speaker sentiment ── */}
        {speakers.length > 1 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <MessagesSquare className="h-3.5 w-3.5" />
              Sentiment by speaker
            </p>
            <div className="space-y-2">
              {speakers.map((s) => (
                <div key={s.speaker} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-sm font-medium">
                    {s.speaker}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        s.meanScore >= 60
                          ? 'bg-success'
                          : s.meanScore <= 40
                            ? 'bg-destructive'
                            : 'bg-warning'
                      )}
                      style={{ width: `${Math.max(2, s.meanScore)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {s.meanScore}
                  </span>
                  {s.role !== 'unknown' && (
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {s.role}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
