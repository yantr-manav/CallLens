import { AlertTriangle, Cpu, ShieldCheck, Workflow, Zap } from 'lucide-react';
import type { Analysis } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

// ── Where this analysis came from ──
//
// Makes the UI → n8n → AI chain visible instead of implied, and — just as
// importantly — refuses to pass a fallback off as the orchestrated path. If the
// heuristic engine produced this report, it says so.
export function ProvenanceStrip({
  analysis,
  detectedFormat,
  formatConfidence,
  turnCount,
}: {
  analysis: Analysis;
  detectedFormat?: string | null;
  formatConfidence?: number | null;
  turnCount?: number;
}) {
  const engine = analysis.engine ?? null;
  const latency =
    typeof analysis.latency_ms === 'number'
      ? `${(analysis.latency_ms / 1000).toFixed(1)}s`
      : null;

  const engineChip =
    engine === 'n8n' ? (
      <Badge variant="success" className="gap-1">
        <Workflow className="h-3 w-3" />
        n8n → {analysis.model ?? 'Groq'}
      </Badge>
    ) : engine === 'groq-direct' ? (
      <Badge variant="warning" className="gap-1">
        <Zap className="h-3 w-3" />
        Direct Groq fallback ({analysis.model ?? 'Groq'})
      </Badge>
    ) : engine === 'heuristic' ? (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        Heuristic fallback — no LLM
      </Badge>
    ) : (
      <Badge variant="secondary" className="gap-1">
        <Cpu className="h-3 w-3" />
        Engine not recorded
      </Badge>
    );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
      {engineChip}

      {latency && <span className="tabular-nums">{latency}</span>}

      <span className="flex items-center gap-1">
        <ShieldCheck className="h-3 w-3" />
        Zod-validated
      </span>

      {detectedFormat && (
        <span>
          Detected <span className="font-medium text-foreground">{detectedFormat}</span>
          {typeof formatConfidence === 'number' &&
            ` (${Math.round(formatConfidence * 100)}% of lines matched)`}
          {typeof turnCount === 'number' && ` · ${turnCount} turns`}
        </span>
      )}

      {analysis.degraded && (
        <span className="text-destructive">
          Scores are keyword-derived, not model-derived.
        </span>
      )}
    </div>
  );
}
