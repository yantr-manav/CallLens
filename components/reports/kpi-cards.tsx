import type { AnalysisResult } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { oneLineInterpretation, resolutionLabel, scoreLevel } from '@/lib/format';

function Stat({
  title,
  value,
  sub,
}: {
  title: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function KpiCards({ result }: { result: AnalysisResult }) {
  const os = result.overall_sentiment;
  const resolution = result.resolution;
  const satisfaction = result.customer.satisfaction;

  const resolutionValue = resolution
    ? `${resolution.status === 'unknown' ? 'Unknown' : resolutionLabel[resolution.status]}`
    : '—';
  const resolutionSub =
    resolution?.likelihood != null
      ? `${resolution.likelihood}% resolution likelihood`
      : 'No likelihood signal';

  const risk = result.risk.escalation;
  const riskLevel = scoreLevel(risk);

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat
        title="Overall sentiment"
        value={os ? `${os.score}/100 ${os.label}` : '—'}
        sub={
          os
            ? `${oneLineInterpretation(os.label, os.score)} ${Math.round(os.confidence * 100)}% confident`
            : null
        }
      />
      <Stat
        title="Resolution"
        value={resolutionValue}
        sub={resolutionSub}
      />
      <Stat
        title="Escalation risk"
        value={risk != null ? `${risk}/100` : '—'}
        sub={risk != null ? `${riskLevel.text} risk` : 'Not enough evidence'}
      />
      <Stat
        title="Customer satisfaction"
        value={satisfaction != null ? `${satisfaction}/100` : '—'}
        sub={satisfaction != null ? `${scoreLevel(satisfaction).text} signal` : 'Not enough evidence'}
      />
    </div>
  );
}