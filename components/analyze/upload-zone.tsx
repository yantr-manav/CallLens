'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, FileText, Loader2, UploadCloud, X } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const MAX_BYTES = 2 * 1024 * 1024;

const STAGES = [
  { key: 'received', label: 'File received' },
  { key: 'parsed', label: 'Parsing transcript' },
  { key: 'evaluating', label: 'Evaluating sentiment' },
  { key: 'kpis', label: 'Extracting KPIs' },
  { key: 'insights', label: 'Preparing insights' },
];

const FORMAT_LABELS: Record<string, string> = {
  labeled: 'labeled dialogue',
  timestamped: 'timestamped transcript',
  caption: 'SRT captions',
  csv: 'CSV/TSV export',
  unlabeled_turns: 'unlabeled turns',
  unlabeled_prose: 'plain prose',
};

interface AnalyzeResponse {
  conversationId: string;
  status: string;
  cached?: boolean;
  detectedFormat?: string;
  turnCount?: number;
  truncatedTurns?: number;
  engine?: string;
  model?: string | null;
  latencyMs?: number;
  degraded?: boolean;
}

export function UploadZone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [summary, setSummary] = useState<AnalyzeResponse | null>(null);
  const [stageIdx, setStageIdx] = useState(-1);
  const [pending, startTransition] = useTransition();

  function pick(f: File | undefined | null) {
    setLocalError(null);
    setServerError(null);
    if (!f) return;
    const name = f.name.toLowerCase();
    if (!name.endsWith('.txt')) {
      setLocalError('Only .txt files are supported.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setLocalError('File exceeds the 2 MB limit.');
      return;
    }
    if (f.size === 0) {
      setLocalError("This file doesn't contain any readable text.");
      return;
    }
    setFile(f);
  }

  function submit() {
    if (!file || pending) return;
    setServerError(null);
    setCached(false);
    setSummary(null);
    setStageIdx(0);

    const form = new FormData();
    form.append('file', file);

    startTransition(async () => {
      // The request is synchronous now (n8n answers in ~5s), so the stage list
      // is purely a progress affordance. It advances on a timer and stops on
      // the real response — no polling, no job ids, no 150s deadline.
      const timer = setInterval(() => {
        setStageIdx((i) => Math.min(i + 1, STAGES.length - 1));
      }, 1100);

      let res: Response;
      try {
        res = await fetch('/api/analyze', { method: 'POST', body: form });
      } catch {
        clearInterval(timer);
        setStageIdx(-1);
        setServerError('Could not reach the server. Check your connection and retry.');
        return;
      }
      clearInterval(timer);
      const data = (await res.json().catch(() => ({}))) as Partial<AnalyzeResponse> & {
        error?: string;
      };

      if (!res.ok) {
        setStageIdx(-1);
        setServerError(data?.error ?? 'Something went wrong. Please retry.');
        return;
      }

      setStageIdx(STAGES.length - 1);
      setCached(Boolean(data.cached));
      setSummary(data as AnalyzeResponse);
      setTimeout(() => {
        router.push(`/reports/${data.conversationId}`);
        router.refresh();
      }, 550);
    });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Analyze</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a{' '}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">
            .txt
          </code>{' '}
          call transcript and get a full conversation-intelligence report.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-6">
          {!file ? (
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pick(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center transition-colors',
                dragOver
                  ? 'border-primary bg-accent/60'
                  : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/40'
              )}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-secondary">
                <UploadCloud className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  Drag &amp; drop your transcript, or{' '}
                  <span className="text-primary">browse</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  TXT &bull; Max 2 MB
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.size)} &bull; Ready
                  </p>
                </div>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/15">
                  <Check className="h-3 w-3 text-success" />
                </span>
                <button
                  onClick={() => {
                    setFile(null);
                    if (inputRef.current) inputRef.current.value = '';
                  }}
                  className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Remove file"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {cached && (
                <p className="text-sm text-muted-foreground">
                  This file was analyzed before — showing the saved result
                  instead of re-running the pipeline.
                </p>
              )}
              {summary && !cached && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {summary.detectedFormat && (
                    <p>
                      Detected{' '}
                      <span className="font-medium text-foreground">
                        {FORMAT_LABELS[summary.detectedFormat] ?? summary.detectedFormat}
                      </span>
                      {typeof summary.turnCount === 'number' &&
                        ` — ${summary.turnCount} turns extracted`}
                      {typeof summary.truncatedTurns === 'number' &&
                        summary.truncatedTurns > 0 &&
                        ` (${summary.truncatedTurns} further turns were not analyzed)`}
                      .
                    </p>
                  )}
                  {summary.engine && (
                    <p>
                      Analyzed via{' '}
                      <span className="font-medium text-foreground">
                        {summary.engine === 'n8n'
                          ? `n8n → ${summary.model ?? 'Groq'}`
                          : summary.engine === 'groq-direct'
                            ? `direct Groq fallback (${summary.model ?? 'Groq'})`
                            : 'heuristic fallback — no LLM available'}
                      </span>
                      {typeof summary.latencyMs === 'number' &&
                        ` in ${(summary.latencyMs / 1000).toFixed(1)}s`}
                      .
                    </p>
                  )}
                </div>
              )}

              {stageIdx >= 0 ? (
                <div className="space-y-2.5">
                  {STAGES.map((s, i) => {
                    const state =
                      i < stageIdx ? 'done' : i === stageIdx ? 'active' : 'todo';
                    return (
                      <div key={s.key} className="flex items-center gap-3 text-sm">
                        {state === 'done' ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/15">
                            <Check className="h-3 w-3 text-success" />
                          </span>
                        ) : state === 'active' ? (
                          <span className="flex h-5 w-5 items-center justify-center">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          </span>
                        ) : (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border" />
                        )}
                        <span
                          className={cn(state === 'todo' && 'text-muted-foreground/60')}
                        >
                          {s.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Button onClick={submit} className="w-full" disabled={!file}>
                  Analyze conversation
                </Button>
              )}
            </div>
          )}

          {/* Outside the file/no-file branches: a rejected drag-drop leaves
              `file` null, and an error rendered only in the has-file branch
              would never be seen. */}
          {(localError || serverError) && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {localError ?? serverError}
            </p>
          )}

          <input
            ref={inputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Supported transcript formats: labeled dialogue, timestamped, CSV/TSV
        exports, SRT captions, and plain prose.
      </p>
    </div>
  );
}
