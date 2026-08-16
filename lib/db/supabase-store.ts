import 'server-only';
import type {
  Analysis,
  AnalysisResult,
  Conversation,
  ConversationStatus,
  SentenceRow,
  SentimentLabel,
} from '@/lib/types';
import type {
  AnalysisDetail,
  CreateAnalysisInput,
  CreateConversationInput,
  ReportSummary,
  Store,
} from '@/lib/db/store';
import { getServerClient, getServiceClient } from '@/lib/supabase/server';

class SupabaseStore implements Store {
  async findConversationByHash(userId: string, fileHash: string) {
    const client = await getServerClient();
    if (!client) return null;
    const { data, error } = await client
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('file_hash', fileHash)
      .maybeSingle();
    if (error) return null;
    return (data as Conversation | null) ?? null;
  }

  async createConversation(input: CreateConversationInput) {
    const client = await getServerClient();
    if (!client) throw new Error('Supabase not configured');
    const { data, error } = await client
      .from('conversations')
      .insert({
        user_id: input.userId,
        file_name: input.fileName,
        file_hash: input.fileHash,
        storage_path: input.storagePath,
        status: 'processing',
      })
      .select('*')
      .single();
    if (error) throw new Error(`insert conversation: ${error.message}`);
    return data as Conversation;
  }

  async updateConversationStatus(conversationId: string, status: ConversationStatus) {
    // Service client avoids RLS edge cases (no WITH CHECK on the policy).
    const client = getServiceClient();
    if (!client) throw new Error('service client not configured');
    const { error } = await client
      .from('conversations')
      .update({ status })
      .eq('id', conversationId);
    if (error) throw new Error(`update status: ${error.message}`);
  }

  async getConversation(userId: string, conversationId: string) {
    const client = await getServerClient();
    if (!client) return null;
    const { data } = await client
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();
    return (data as Conversation | null) ?? null;
  }

  async createAnalysis(input: CreateAnalysisInput) {
    const service = getServiceClient();
    if (!service) throw new Error('service client not configured');
    const r: AnalysisResult = input.result;
    const { data: aRow, error: aErr } = await service
      .from('analyses')
      .insert({
        conversation_id: input.conversationId,
        overall_sentiment: r.overall_sentiment.label,
        overall_score: r.overall_sentiment.score,
        confidence: r.overall_sentiment.confidence,
        summary: r.summary,
        intent: r.intent.description,
        resolution_status: r.resolution.status,
        resolution_likelihood: r.resolution.likelihood,
        escalation_risk: r.risk.escalation,
        frustration: r.customer.frustration,
        satisfaction_signal: r.customer.satisfaction,
        effort: r.customer.effort,
        agent_empathy: r.agent.empathy,
        agent_clarity: r.agent.clarity,
        agent_professionalism: r.agent.professionalism,
        raw_json: r as unknown as Record<string, unknown>,
      })
      .select('*')
      .single();
    if (aErr || !aRow) throw new Error(`insert analysis: ${aErr?.message}`);
    const analysis = aRow as Analysis;

    if (r.sentences.length > 0) {
      const rows = r.sentences.map((s) => ({
        analysis_id: analysis.id,
        seq: s.seq,
        speaker: s.speaker,
        text: s.text,
        sentiment: s.sentiment,
        score: s.score,
        confidence: s.confidence,
        emotion: s.emotion,
      }));
      const { error: sErr } = await service.from('sentences').insert(rows);
      if (sErr) throw new Error(`insert sentences: ${sErr.message}`);
    }

    await this.updateConversationStatus(input.conversationId, 'done');
    return analysis;
  }

  async getAnalysisDetail(conversationId: string): Promise<AnalysisDetail | null> {
    const client = await getServerClient();
    if (!client) return null;
    const { data: aRow } = await client
      .from('analyses')
      .select('*')
      .eq('conversation_id', conversationId)
      .maybeSingle();
    if (!aRow) return null;
    const analysis = aRow as Analysis;
    const { data: sRows } = await client
      .from('sentences')
      .select('*')
      .eq('analysis_id', analysis.id)
      .order('seq', { ascending: true });
    const sentences = (sRows ?? []) as SentenceRow[];
    return { analysis, sentences };
  }

  async listReports(userId: string, limit = 10, offset = 0) {
    const client = await getServerClient();
    if (!client) return [];
    const from = offset;
    const to = offset + limit - 1;
    const { data } = await client
      .from('conversations')
      .select(
        'id, file_name, status, created_at, analyses:analyses(id, overall_sentiment, overall_score, resolution_status, escalation_risk)'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);
    const rows = (data ?? []) as Array<{
      id: string;
      file_name: string;
      status: ConversationStatus;
      created_at: string;
      analyses: Array<{
        id: string;
        overall_sentiment: string | null;
        overall_score: number | null;
        resolution_status: string | null;
        escalation_risk: number | null;
      }> | null;
    }>;
    return rows.map<ReportSummary>((r) => {
      const a = r.analyses && r.analyses[0];
      return {
        conversationId: r.id,
        analysisId: a?.id ?? null,
        fileName: r.file_name,
        status: r.status,
        overallSentiment: (a?.overall_sentiment as SentimentLabel) ?? null,
        overallScore: a?.overall_score ?? null,
        resolutionStatus: a?.resolution_status ?? null,
        escalationRisk: a?.escalation_risk ?? null,
        createdAt: r.created_at,
      };
    });
  }

  async countReports(userId: string) {
    const client = await getServerClient();
    if (!client) return 0;
    const { count } = await client
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    return count ?? 0;
  }
}

let instance: SupabaseStore | null = null;
export function getSupabaseStore(): Store {
  if (!instance) instance = new SupabaseStore();
  return instance;
}