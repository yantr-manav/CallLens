import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, FileText, RotateCcw, StickyNote } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { getStore } from '@/lib/db/store';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCards } from '@/components/reports/kpi-cards';
import { SentimentDistribution } from '@/components/reports/sentiment-distribution';
import { SentimentTimeline } from '@/components/charts/sentiment-timeline';
import { EmotionBars } from '@/components/reports/emotion-bars';
import { EvidenceCards } from '@/components/reports/evidence-cards';
import { WhyCard } from '@/components/reports/why-card';
import { SentenceTable } from '@/components/reports/sentence-table';
import { ReasoningCard } from '@/components/reports/reasoning-card';
import { DerivedKpis } from '@/components/reports/derived-kpis';
import { KeyMoments } from '@/components/reports/key-moments';
import { ProvenanceStrip } from '@/components/reports/provenance-strip';
import { ReportActions } from '@/components/reports/report-actions';
import { sentimentBadge, confidenceLabel } from '@/lib/format';
import { timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function ReportPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireUser();
  const store = getStore();
  const conversation = await store.getConversation(user.id, params.id);
  if (!conversation) notFound();

  const detail = await store.getAnalysisDetail(conversation.id);
  const analysis = detail?.analysis ?? null;
  const tags = conversation.tags ?? [];

  return (
    <AppShell user={user}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold tracking-tight">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {conversation.title || conversation.file_name}
              </span>
            </h1>
            {analysis?.overall_sentiment && (
              <Badge
                variant={
                  sentimentBadge(analysis.overall_sentiment)?.badge ?? 'secondary'
                }
              >
                {sentimentBadge(analysis.overall_sentiment)?.label}
              </Badge>
            )}
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            {conversation.title && (
              <span className="font-mono text-xs">{conversation.file_name} · </span>
            )}
            Analyzed {timeAgo(conversation.created_at)}
            {analysis?.confidence != null &&
              ` · ${confidenceLabel(analysis.confidence)}`}
            {conversation.agent_name && ` · Agent: ${conversation.agent_name}`}
            {conversation.customer_name && ` · Customer: ${conversation.customer_name}`}
          </p>

          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/analyze">
              <RotateCcw className="h-4 w-4" />
              New analysis
            </Link>
          </Button>
          <ReportActions
            conversationId={conversation.id}
            fileName={conversation.file_name}
            hasAnalysis={Boolean(analysis)}
            redirectAfterDelete
            meta={{
              title: conversation.title ?? null,
              agentName: conversation.agent_name ?? null,
              customerName: conversation.customer_name ?? null,
              tags,
              notes: conversation.notes ?? null,
            }}
          />
        </div>
      </div>

      {!analysis && conversation.status === 'processing' && (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-sm font-medium">Still analyzing…</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The pipeline is running. Refresh in a moment.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href={`/reports/${conversation.id}`}>Refresh</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!analysis && conversation.status !== 'processing' && (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-sm font-medium">No analysis for this transcript</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The last run didn&apos;t produce a result. Re-run it from the actions
              menu — the original transcript is still stored.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/analyze">
                Upload another <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {analysis && (
        <div className="space-y-6">
          <ProvenanceStrip
            analysis={analysis}
            turnCount={detail?.sentences.length}
          />

          <KpiCards result={analysis.raw_json} />

          <div className="grid gap-4 lg:grid-cols-3">
            <SentimentDistribution result={analysis.raw_json} />
            <div className="lg:col-span-2">
              <SentimentTimeline result={analysis.raw_json} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-foreground/90">
                  {analysis.raw_json.summary}
                </p>
              </CardContent>
            </Card>
            <WhyCard result={analysis.raw_json} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ReasoningCard result={analysis.raw_json} />
            <DerivedKpis result={analysis.raw_json} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <EmotionBars result={analysis.raw_json} />
            <KeyMoments result={analysis.raw_json} />
          </div>

          <EvidenceCards result={analysis.raw_json} />

          {conversation.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <StickyNote className="h-4 w-4 text-muted-foreground" />
                  Analyst notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {conversation.notes}
                </p>
              </CardContent>
            </Card>
          )}

          <SentenceTable
            result={analysis.raw_json}
            highlightSeqs={analysis.raw_json.important_moments?.map((m) => m.seq)}
          />
        </div>
      )}
    </AppShell>
  );
}
