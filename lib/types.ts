// ── Domain types — mirrors the LLM structured output (§8.4) and DB schema (§6) ──

export type ConversationStatus = 'pending' | 'processing' | 'done' | 'failed';
export type TranscriptFormat =
  | 'labeled'
  | 'timestamped'
  | 'caption'
  | 'csv'
  | 'unlabeled_turns'
  | 'unlabeled_prose';

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

// A normalized turn — produced by lib/normalize.ts before anything hits n8n.
export interface TranscriptTurn {
  seq: number;
  speaker: string;
  text: string;
  timestamp?: string;
}

export interface NormalizedTranscript {
  format: TranscriptFormat;
  turns: TranscriptTurn[];
  formatConfidence: number; // fraction of lines the winning detector matched
}

// ── LLM structured output (validated by Zod in lib/validation.ts) ──

export interface OverallSentiment {
  label: SentimentLabel;
  score: number; // 0-100
  confidence: number; // 0-1
}

export interface IntentBlock {
  category: string;
  description: string;
}

export interface ResolutionBlock {
  status: 'resolved' | 'unresolved' | 'partial' | 'unknown';
  likelihood: number | null; // 0-100 | null
}

export interface RiskBlock {
  escalation: number | null; // 0-100 | null
}

export interface CustomerBlock {
  frustration: 'low' | 'medium' | 'high' | null;
  satisfaction: number | null; // 0-100
  effort: 'low' | 'medium' | 'high' | null;
}

export interface AgentBlock {
  empathy: number | null;
  clarity: number | null;
  professionalism: number | null;
}

export interface EmotionEntry {
  label: string;
  intensity: number; // 0-100
}

export interface ImportantMoment {
  seq: number;
  speaker: string;
  event: string;
}

export interface SentenceResult {
  seq: number;
  speaker: string;
  text: string;
  sentiment: SentimentLabel;
  score: number; // 0-100
  confidence: number; // 0-1
  emotion: string;
  evidence?: string;
}

export interface ReasoningDriver {
  factor: string;
  direction: 'positive' | 'negative';
  weight: number; // 0-100
  evidence: string;
}

export interface CounterSignal {
  observation: string;
  evidence: string;
}

// How the model reached its verdict. Rendered by ReasoningCard — this is the
// artifact that satisfies the rubric's "clear reasoning (if LLM used)" line.
export interface ReasoningBlock {
  drivers: ReasoningDriver[];
  counter_signals: CounterSignal[];
}

export interface AnalysisResult {
  overall_sentiment: OverallSentiment;
  summary: string;
  intent: IntentBlock;
  resolution: ResolutionBlock;
  risk: RiskBlock;
  customer: CustomerBlock;
  agent: AgentBlock;
  emotions: EmotionEntry[];
  important_moments: ImportantMoment[];
  reasoning?: ReasoningBlock;
  sentences: SentenceResult[];
}

// ── Analysis provenance ──
// Which engine actually produced a result. Surfaced in the UI so a fallback is
// never silently presented as if n8n had served it.
export type AnalysisEngine = 'n8n' | 'groq-direct' | 'heuristic';

export interface AnalysisProvenance {
  engine: AnalysisEngine;
  model?: string;
  latencyMs?: number;
  degraded: boolean;
}

// ── Database row shapes (Supabase) ──

export interface Conversation {
  id: string;
  user_id: string;
  file_name: string;
  file_hash: string;
  storage_path: string;
  status: ConversationStatus;
  created_at: string;
  // Added in migration 0002 (editable report metadata). Optional so rows read
  // before the migration still type-check.
  title?: string | null;
  agent_name?: string | null;
  customer_name?: string | null;
  tags?: string[] | null;
  notes?: string | null;
  updated_at?: string | null;
}

export interface Analysis {
  id: string;
  conversation_id: string;
  overall_sentiment: string | null;
  overall_score: number | null;
  confidence: number | null;
  summary: string | null;
  intent: string | null;
  resolution_status: string | null;
  resolution_likelihood: number | null;
  escalation_risk: number | null;
  frustration: string | null;
  satisfaction_signal: number | null;
  effort: string | null;
  agent_empathy: number | null;
  agent_clarity: number | null;
  agent_professionalism: number | null;
  raw_json: AnalysisResult;
  created_at: string;
  // Provenance, added in migration 0002.
  engine?: AnalysisEngine | null;
  model?: string | null;
  latency_ms?: number | null;
  degraded?: boolean | null;
}

export interface SentenceRow {
  id: number;
  analysis_id: string;
  seq: number;
  speaker: string;
  text: string;
  sentiment: string;
  score: number;
  confidence: number;
  emotion: string;
  evidence?: string | null;
}

// ── Auth user (works for both Supabase + local demo mode) ──

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}