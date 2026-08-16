import type { AnalysisResult } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function WhyCard({ result }: { result: AnalysisResult }) {
  const os = result.overall_sentiment;
  const evidence: string[] = [];

  const strong = result.sentences
    .filter((s) => s.sentiment === os.label && (s.confidence ?? 0) >= 0.8)
    .sort((x, y) => y.confidence - x.confidence)
    .slice(0, 2);

  for (const s of strong) {
    const quote = s.text.length > 110 ? `${s.text.slice(0, 110)}…` : s.text;
    evidence.push(`"${quote}"`);
  }

  for (const m of result.important_moments.slice(0, 1)) {
    evidence.push(m.event);
  }

  if (evidence.length === 0) {
    evidence.push(
      `No high-confidence ${os.label} sentences were detected; the label is inferred from the overall tone of the transcript.`
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Why this analysis?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed text-foreground/90">
          Overall sentiment is{' '}
          <span className="font-medium capitalize">{os.label}</span> at{' '}
          {os.score}/100 — {Math.round(os.confidence * 100)}% confidence.
          The main intent of the conversation was{' '}
          <span className="font-medium">{result.intent.category.toLowerCase()}</span>
          {result.intent.description && ` — ${result.intent.description}`}.
        </p>
        <div className="space-y-1.5">
          {evidence.map((e, i) => (
            <div key={i} className="flex items-start gap-2">
              <Badge variant="secondary" className="mt-0.5 shrink-0">
                {i === 0 && strong.length > 0 ? 'Evidence' : 'Signal'}
              </Badge>
              <p className="text-sm text-muted-foreground">{e}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}