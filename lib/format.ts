import type { SentimentLabel } from '@/lib/types';

// Display helpers shared across the dashboard. Kept pure so both server and
// client components can use them.

export const sentimentMeta: Record<
  SentimentLabel,
  { label: string; badge: 'success' | 'warning' | 'destructive'; bar: string }
> = {
  positive: { label: 'Positive', badge: 'success', bar: 'bg-success' },
  neutral: { label: 'Neutral', badge: 'warning', bar: 'bg-warning' },
  negative: { label: 'Negative', badge: 'destructive', bar: 'bg-destructive' },
};

export const resolutionLabel: Record<string, string> = {
  resolved: 'Resolved',
  unresolved: 'Unresolved',
  partial: 'Partially resolved',
  unknown: 'Unknown',
};

export function sentimentBadge(s?: string | null) {
  if (!s) return null;
  return sentimentMeta[s as SentimentLabel] ?? null;
}

export function scoreLevel(score: number | null | undefined): {
  text: string;
  color: 'text-success' | 'text-warning' | 'text-destructive' | 'text-muted-foreground';
} {
  if (score == null) return { text: '—', color: 'text-muted-foreground' };
  if (score >= 70) return { text: 'Strong', color: 'text-success' };
  if (score >= 45) return { text: 'Moderate', color: 'text-warning' };
  return { text: 'Weak', color: 'text-destructive' };
}

export function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function formatSentimentDistribution(
  sentences: Array<{ sentiment: string }>
): Array<{ label: SentimentLabel; count: number; pct: number }> {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const s of sentences) {
    if (s.sentiment in counts) counts[s.sentiment as SentimentLabel]++;
  }
  const total = Math.max(1, sentences.length);
  return (['positive', 'neutral', 'negative'] as SentimentLabel[]).map(
    (label) => ({ label, count: counts[label], pct: counts[label] / total })
  );
}

export function oneLineInterpretation(
  sentiment: string | null | undefined,
  score: number | null | undefined
): string {
  if (!sentiment || score == null) return 'Not enough evidence yet.';
  switch (sentiment) {
    case 'positive':
      return score >= 70
        ? 'The interaction ended strongly positive.'
        : 'A mostly positive interaction.';
    case 'neutral':
      return 'A balanced, neutral interaction.';
    case 'negative':
      return score <= 30
        ? 'A strongly negative interaction.'
        : 'A mostly negative interaction.';
    default:
      return 'Sentiment is mixed.';
  }
}

export function confidenceLabel(confidence: number | null | undefined): string {
  if (confidence == null) return 'Low confidence';
  if (confidence >= 0.8) return 'High confidence';
  if (confidence >= 0.6) return 'Moderate confidence';
  return 'Low confidence';
}