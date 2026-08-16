import { z } from 'zod';

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
  category: z.string().min(1).max(40),
  description: z.string().min(1).max(200),
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
  label: z.string().min(1).max(40),
  intensity: score100,
});

export const importantMomentSchema = z.object({
  seq: z.number().int().min(1),
  speaker: z.string().max(40),
  event: z.string().min(1).max(200),
});

export const sentenceResultSchema = z.object({
  seq: z.number().int().min(1),
  speaker: z.string().max(40),
  text: z.string().min(1).max(2000),
  sentiment: sentimentLabelSchema,
  score: score100,
  confidence: confidence01,
  emotion: z.string().min(1).max(40),
  evidence: z.string().max(200).optional(),
});

// The full structured LLM output — enforced at the n8n boundary AND on the
// Next.js side before anything is written to Supabase (defense in depth).
export const analysisResultSchema = z.object({
  overall_sentiment: overallSentimentSchema,
  summary: z.string().min(1).max(500),
  intent: intentSchema,
  resolution: resolutionSchema,
  risk: riskSchema,
  customer: customerSchema,
  agent: agentSchema,
  emotions: z.array(emotionEntrySchema).max(10),
  important_moments: z.array(importantMomentSchema).max(10),
  sentences: z.array(sentenceResultSchema).min(1),
});

export type AnalysisResultSchemaType = z.infer<typeof analysisResultSchema>;

// ── Payload Next.js sends to n8n (the contract over the webhook boundary) ──

export const analyzePayloadSchema = z.object({
  conversation_id: z.string().uuid(),
  file_name: z.string().min(1).max(200),
  transcript: z
    .array(
      z.object({
        seq: z.number().int().min(1),
        speaker: z.string().max(40),
        text: z.string().min(1).max(2000),
        timestamp: z.string().max(20).optional(),
      })
    )
    .min(1)
    .max(2000),
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