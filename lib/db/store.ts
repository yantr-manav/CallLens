import 'server-only';
import type {
  Analysis,
  AnalysisEngine,
  AnalysisResult,
  Conversation,
  ConversationStatus,
  SentenceRow,
  SentimentLabel,
} from '@/lib/types';

// Joined summary the dashboard / reports list needs in one query.
export interface ReportSummary {
  conversationId: string;
  analysisId: string | null;
  fileName: string;
  title: string | null;
  agentName: string | null;
  tags: string[];
  status: ConversationStatus;
  overallSentiment: SentimentLabel | null;
  overallScore: number | null;
  resolutionStatus: string | null;
  escalationRisk: number | null;
  engine: string | null;
  degraded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationInput {
  userId: string;
  fileName: string;
  fileHash: string;
  storagePath: string;
}

export interface CreateAnalysisInput {
  conversationId: string;
  result: AnalysisResult; // validated structured output
  engine?: AnalysisEngine;
  model?: string;
  latencyMs?: number;
  degraded?: boolean;
}

export interface AnalysisDetail {
  analysis: Analysis;
  sentences: SentenceRow[];
}

export type ReportSort = 'newest' | 'oldest' | 'score_desc' | 'score_asc';

export interface ReportFilter {
  limit?: number;
  offset?: number;
  sentiment?: 'all' | SentimentLabel;
  /** Free-text match across title, file name and agent name. */
  q?: string;
  sort?: ReportSort;
}

/** One page of reports plus the total matching the same filter. */
export interface ReportPage {
  items: ReportSummary[];
  total: number;
}

export interface ReportMetadataPatch {
  title?: string | null;
  agentName?: string | null;
  customerName?: string | null;
  tags?: string[];
  notes?: string | null;
}

export interface DeleteResult {
  deleted: number;
  storagePaths: string[];
}

// Single contract both backends implement. API routes never know which one
// is live — they just call `getStore()` and get a concrete implementation.
export interface Store {
  findConversationByHash(
    userId: string,
    fileHash: string
  ): Promise<Conversation | null>;

  createConversation(input: CreateConversationInput): Promise<Conversation>;
  updateConversationStatus(
    conversationId: string,
    status: ConversationStatus
  ): Promise<void>;
  getConversation(
    userId: string,
    conversationId: string
  ): Promise<Conversation | null>;

  /**
   * Writes the analysis for a conversation, REPLACING any existing one.
   * Must be a replace rather than an insert: `analyses` is 1:1 with
   * `conversations` (unique index added in migration 0002) because
   * getAnalysisDetail() uses .maybeSingle(), which errors on duplicates. This
   * is what makes "re-run analysis" safe.
   */
  replaceAnalysis(input: CreateAnalysisInput): Promise<Analysis>;
  getAnalysisDetail(conversationId: string): Promise<AnalysisDetail | null>;

  listReports(userId: string, filter?: ReportFilter): Promise<ReportPage>;
  /** Every report for the user, unpaginated — used by the CSV export. */
  listAllForExport(userId: string): Promise<ReportSummary[]>;

  updateConversationMeta(
    userId: string,
    conversationId: string,
    patch: ReportMetadataPatch
  ): Promise<Conversation | null>;

  /** Deletes owned conversations and returns the storage paths to clean up. */
  deleteConversations(userId: string, ids: string[]): Promise<DeleteResult>;
}

import { getSupabaseStore } from '@/lib/db/supabase-store';
import { getLocalStore } from '@/lib/db/local-store';
import { mode } from '@/lib/config';

let cached: Store | null = null;

export function getStore(): Store {
  if (cached) return cached;
  cached = mode.supabaseConfigured ? getSupabaseStore() : getLocalStore();
  return cached;
}