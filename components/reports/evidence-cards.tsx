import type { AnalysisResult } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { resolutionLabel, scoreLevel } from '@/lib/format';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="capitalize tabular-nums">{value}</span>
    </div>
  );
}

function NullNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground">— {children}</p>
  );
}

export function EvidenceCards({ result }: { result: AnalysisResult }) {
  const c = result.customer;
  const a = result.agent;
  const r = result.resolution;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="text-base">Customer experience</CardTitle>
        </CardHeader>
        <CardContent>
          {c.frustration == null && c.satisfaction == null && c.effort == null ? (
            <NullNote>
              Not enough evidence to rate the customer&apos;s experience.
            </NullNote>
          ) : (
            <>
              {c.frustration != null && (
                <Row label="Frustration" value={c.frustration} />
              )}
              {c.satisfaction != null && (
                <Row label="Satisfaction" value={`${c.satisfaction}/100 (${scoreLevel(c.satisfaction).text.toLowerCase()})`} />
              )}
              {c.effort != null && <Row label="Customer effort" value={c.effort} />}
              {c.frustration == null && <NullNote>Frustration not detected.</NullNote>}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="text-base">Resolution</CardTitle>
        </CardHeader>
        <CardContent>
          {r.status === 'unknown' && r.likelihood == null ? (
            <NullNote>
              Not enough evidence to determine whether the issue was resolved.
            </NullNote>
          ) : (
            <>
              <Row
                label="Status"
                value={r.status === 'unknown' ? 'Unknown' : (resolutionLabel[r.status] ?? r.status)}
              />
              {r.likelihood != null && (
                <Row label="Resolution likelihood" value={`${r.likelihood}%`} />
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="text-base">Agent quality</CardTitle>
        </CardHeader>
        <CardContent>
          {a.empathy == null && a.clarity == null && a.professionalism == null ? (
            <NullNote>
              Not enough evidence to rate the agent&apos;s performance.
            </NullNote>
          ) : (
            <>
              {a.empathy != null && (
                <Row label="Empathy" value={`${a.empathy}/100 (${scoreLevel(a.empathy).text.toLowerCase()})`} />
              )}
              {a.clarity != null && (
                <Row label="Clarity" value={`${a.clarity}/100 (${scoreLevel(a.clarity).text.toLowerCase()})`} />
              )}
              {a.professionalism != null && (
                <Row label="Professionalism" value={`${a.professionalism}/100 (${scoreLevel(a.professionalism).text.toLowerCase()})`} />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}