import 'server-only';
import type {
  Analysis,
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
  status: ConversationStatus;
  overallSentiment: SentimentLabel | null;
  overallScore: number | null;
  resolutionStatus: string | null;
  escalationRisk: number | null;
  createdAt: string;
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
}

export interface AnalysisDetail {
  analysis: Analysis;
  sentences: SentenceRow[];
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

  createAnalysis(input: CreateAnalysisInput): Promise<Analysis>;
  getAnalysisDetail(conversationId: string): Promise<AnalysisDetail | null>;

  listReports(
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<ReportSummary[]>;
  countReports(userId: string): Promise<number>;
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