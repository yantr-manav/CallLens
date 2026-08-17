import { z } from 'zod';

// ── Size limits ──
// Single source of truth. The Zod schemas below are BUILT from these, and
// lib/normalize-result.ts truncates to the same constants. Previously the
// normalizer carried its own magic numbers, so a drift between the two silently
// pushed valid LLM output down a lossy fallback path and blanked the KPIs.
// Change a number here and both sides move together.
export const LIMITS = {
  summary: 500,
  intentCategory: 40,
  intentDescription: 200,
  evidence: 200,
  label: 40,
  speaker: 40,
  sentenceText: 2000,
  event: 200,
  factor: 80,
  observation: 160,
  maxEmotions: 10,
  maxMoments: 10,
  maxDrivers: 5,
  maxCounterSignals: 4,
  maxTurns: 2000,
} as const;

// Hard cap on how many turns we actually send to the LLM. The payload schema
// tolerates up to LIMITS.maxTurns, but a real 2000-turn transcript would blow
// both the context window and the latency budget. The analyze route truncates
// to this and reports how many turns were dropped.
export const MAX_ANALYZED_TURNS = 250;

// ── Enums: fixed allowed-value lists prevent the dashboard from ever
//    rendering an unexpected label (§8.4 hard rules). ──

export const sentimentLabelSchema = z.enum(['positive', 'neutral', 'negative']);
export const resolutionStatusSchema = z.enum([
  'resolved',
  'unresolved',
  'partial',
  'unknown',
]);
export const triLevelSchema = z.enum(['low', 'medium', 'high']);

// 0-100 integer metric
const score100 = z.number().int().min(0).max(100);
// 0-1 confidence
const confidence01 = z.number().min(0).max(1);

// A field that may legitimately be null when there is no transcript evidence.
// We never guess metrics — null is the honest answer (§8.4).
const nullableScore = score100.nullable();
const nullableTri = triLevelSchema.nullable();

export const overallSentimentSchema = z.object({
  label: sentimentLabelSchema,
  score: score100,
  confidence: confidence01,
});

export const intentSchema = z.object({
  category: z.string().min(1).max(LIMITS.intentCategory),
  description: z.string().min(1).max(LIMITS.intentDescription),
});

export const resolutionSchema = z.object({
  status: resolutionStatusSchema,
  likelihood: nullableScore,
});

export const riskSchema = z.object({
  escalation: nullableScore,
});

export const customerSchema = z.object({
  frustration: nullableTri,
  satisfaction: nullableScore,
  effort: nullableTri,
});

export const agentSchema = z.object({
  empathy: nullableScore,
  clarity: nullableScore,
  professionalism: nullableScore,
});

export const emotionEntrySchema = z.object({
  label: z.string().min(1).max(LIMITS.label),
  intensity: score100,
});

export const importantMomentSchema = z.object({
  seq: z.number().int().min(1),
  speaker: z.string().max(LIMITS.speaker),
  event: z.string().min(1).max(LIMITS.event),
});

export const sentenceResultSchema = z.object({
  seq: z.number().int().min(1),
  speaker: z.string().max(LIMITS.speaker),
  text: z.string().min(1).max(LIMITS.sentenceText),
  sentiment: sentimentLabelSchema,
  score: score100,
  confidence: confidence01,
  emotion: z.string().min(1).max(LIMITS.label),
  // The verbatim fragment justifying the label. The prompt marks it REQUIRED
  // (it is the core of the "clear reasoning" rubric line), but it stays
  // optional here so a single missed quote degrades one row instead of
  // invalidating the whole analysis.
  evidence: z.string().max(LIMITS.evidence).optional(),
});

// ── Reasoning: how the model reached the overall verdict ──
// Stored inside analyses.raw_json (jsonb) — no dedicated columns needed.
export const reasoningDriverSchema = z.object({
  factor: z.string().min(1).max(LIMITS.factor),
  direction: z.enum(['positive', 'negative']),
  weight: score100,
  evidence: z.string().max(LIMITS.evidence),
});

export const counterSignalSchema = z.object({
  observation: z.string().min(1).max(LIMITS.observation),
  evidence: z.string().max(LIMITS.evidence),
});

export const reasoningSchema = z.object({
  drivers: z.array(reasoningDriverSchema).max(LIMITS.maxDrivers),
  counter_signals: z.array(counterSignalSchema).max(LIMITS.maxCounterSignals),
});

// The full structured LLM output — enforced at the n8n boundary AND on the
// Next.js side before anything is written to Supabase (defense in depth).
export const analysisResultSchema = z.object({
  overall_sentiment: overallSentimentSchema,
  summary: z.string().min(1).max(LIMITS.summary),
  intent: intentSchema,
  resolution: resolutionSchema,
  risk: riskSchema,
  customer: customerSchema,
  agent: agentSchema,
  emotions: z.array(emotionEntrySchema).max(LIMITS.maxEmotions),
  important_moments: z.array(importantMomentSchema).max(LIMITS.maxMoments),
  // Optional so an older stored analysis (written before the reasoning block
  // existed) still parses when re-read from the DB.
  reasoning: reasoningSchema.optional(),
  sentences: z.array(sentenceResultSchema).min(1),
});

export type AnalysisResultSchemaType = z.infer<typeof analysisResultSchema>;
export type ReasoningSchemaType = z.infer<typeof reasoningSchema>;

// ── Report metadata (the editable half of the reports CRUD) ──
// Empty strings are normalised to null so clearing a field in the UI actually
// clears the column instead of storing ''.
const trimmedOrNull = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => {
      const t = s.trim();
      return t.length > 0 ? t : null;
    })
    .nullable();

export const reportMetadataSchema = z
  .object({
    title: trimmedOrNull(120).optional(),
    agentName: trimmedOrNull(80).optional(),
    customerName: trimmedOrNull(80).optional(),
    notes: trimmedOrNull(2000).optional(),
    tags: z
      .array(z.string().trim().min(1).max(24))
      .max(10)
      // de-duplicate case-insensitively, preserving first-seen casing
      .transform((arr) => {
        const seen = new Set<string>();
        return arr.filter((t) => {
          const k = t.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      })
      .optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: 'No fields to update.',
  });

export type ReportMetadataInput = z.infer<typeof reportMetadataSchema>;

export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
});

// ── Payload Next.js sends to n8n (the contract over the webhook boundary) ──

// NOTE: the HMAC is computed over JSON.stringify() of the parsed payload, and
// Zod emits keys in schema-declaration order — so REORDERING THESE FIELDS
// CHANGES THE SIGNATURE. n8n's Verify Signature node re-stringifies the parsed
// body to recompute it. Keep the order stable.
export const analyzePayloadSchema = z.object({
  conversation_id: z.string().uuid(),
  file_name: z.string().min(1).max(200),
  // Retained (optional, and no longer sent) purely so its absence cannot alter
  // the signed byte order. n8n stopped needing it when the async callback was
  // removed in favour of a synchronous response.
  app_url: z.string().url().optional(),
  transcript: z
    .array(
      z.object({
        seq: z.number().int().min(1),
        speaker: z.string().max(LIMITS.speaker),
        text: z.string().min(1).max(LIMITS.sentenceText),
        timestamp: z.string().max(20).optional(),
      })
    )
    .min(1)
    .max(LIMITS.maxTurns),
});

export type AnalyzePayload = z.infer<typeof analyzePayloadSchema>;

// ── File validation (server-side, never trust the client alone) ──

export const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
export const ALLOWED_MIME = ['text/plain', 'application/octet-stream', ''];
export const ALLOWED_EXT = '.txt';

export type FileValidationError =
  | 'invalid_extension'
  | 'invalid_mime'
  | 'too_large'
  | 'empty'
  | 'invalid_utf8';

export function validateUploadedFile(file: File): {
  ok: boolean;
  error?: FileValidationError;
} {
  const name = file.name.toLowerCase();
  if (!name.endsWith(ALLOWED_EXT)) {
    return { ok: false, error: 'invalid_extension' };
  }
  // MIME can be empty or text/plain in browsers; we re-verify content as UTF-8.
  if (
    file.type &&
    file.type !== 'text/plain' &&
    !ALLOWED_MIME.includes(file.type)
  ) {
    return { ok: false, error: 'invalid_mime' };
  }
  if (file.size > MAX_FILE_SIZE) return { ok: false, error: 'too_large' };
  if (file.size === 0) return { ok: false, error: 'empty' };
  return { ok: true };
}

// Re-validate raw text as valid, non-empty UTF-8 after reading the buffer.
export function validateTextContent(text: string): {
  ok: boolean;
  error?: FileValidationError;
} {
  if (!text || text.trim().length === 0) return { ok: false, error: 'empty' };
  // A high number of replacement chars typically indicates decoding failures.
  const replacementChars = (text.match(/\uFFFD/g) || []).length;
  if (replacementChars > text.length * 0.05) {
    return { ok: false, error: 'invalid_utf8' };
  }
  return { ok: true };
}