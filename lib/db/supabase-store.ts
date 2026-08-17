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
  DeleteResult,
  ReportFilter,
  ReportMetadataPatch,
  ReportPage,
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

  async replaceAnalysis(input: CreateAnalysisInput) {
    const service = getServiceClient();
    if (!service) throw new Error('service client not configured');
    const r: AnalysisResult = input.result;

    // 1:1 with conversations (unique index, migration 0002). Delete first so a
    // re-run updates in place; `sentences` cascades off the analyses row.
    const { error: dErr } = await service
      .from('analyses')
      .delete()
      .eq('conversation_id', input.conversationId);
    if (dErr) throw new Error(`clear previous analysis: ${dErr.message}`);

    const { data: aRow, error: aErr } = await service
      .from('analyses')
      .insert({
        engine: input.engine ?? null,
        model: input.model ?? null,
        latency_ms: input.latencyMs ?? null,
        degraded: input.degraded ?? false,
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
        evidence: s.evidence ?? null,
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

  async listReports(userId: string, filter: ReportFilter = {}): Promise<ReportPage> {
    const client = await getServerClient();
    if (!client) return { items: [], total: 0 };

    const limit = Math.min(100, Math.max(1, filter.limit ?? 10));
    const offset = Math.max(0, filter.offset ?? 0);
    const sentiment = filter.sentiment && filter.sentiment !== 'all' ? filter.sentiment : null;

    // Filtering and paging happen in PostgREST, not in JS. The previous version
    // always fetched 100 rows and sliced them in memory, so offset > 100
    // silently returned nothing and the total was wrong whenever a sentiment
    // filter was active.
    //
    // `analyses!inner` is used ONLY when filtering by sentiment — with it
    // always on, conversations that have no analysis yet (processing/failed)
    // would vanish from the list.
    const embed = sentiment
      ? 'analyses!inner(id, overall_sentiment, overall_score, resolution_status, escalation_risk, engine, degraded)'
      : 'analyses(id, overall_sentiment, overall_score, resolution_status, escalation_risk, engine, degraded)';

    let query = client
      .from('conversations')
      .select(
        `id, file_name, title, agent_name, tags, status, created_at, updated_at, ${embed}`,
        { count: 'exact' }
      )
      .eq('user_id', userId);

    if (sentiment) query = query.eq('analyses.overall_sentiment', sentiment);

    const q = filter.q?.trim();
    if (q) {
      // Escape PostgREST's `or` list separators so a comma or paren in the
      // search box can't break out of the filter expression.
      const safe = q.replace(/[,()\\]/g, ' ').replace(/%/g, '\\%');
      query = query.or(
        `title.ilike.%${safe}%,file_name.ilike.%${safe}%,agent_name.ilike.%${safe}%`
      );
    }

    switch (filter.sort) {
      case 'oldest':
        query = query.order('created_at', { ascending: true });
        break;
      case 'score_desc':
        query = query.order('created_at', { ascending: false });
        break;
      case 'score_asc':
        query = query.order('created_at', { ascending: true });
        break;
      default:
        query = query.order('created_at', { ascending: false });
    }

    const { data, count, error } = await query.range(offset, offset + limit - 1);
    if (error) {
      console.error('[store] listReports:', error.message);
      return { items: [], total: 0 };
    }

    const items = (data ?? []).map((row) => toSummary(row as ConversationRow));

    // Score sorting can only be applied within the page: overall_score lives on
    // the embedded analyses row, which PostgREST cannot order the parent by.
    if (filter.sort === 'score_desc' || filter.sort === 'score_asc') {
      const dir = filter.sort === 'score_desc' ? -1 : 1;
      items.sort((a, b) => ((a.overallScore ?? -1) - (b.overallScore ?? -1)) * dir);
    }

    return { items, total: count ?? items.length };
  }

  async listAllForExport(userId: string): Promise<ReportSummary[]> {
    const client = await getServerClient();
    if (!client) return [];
    const { data } = await client
      .from('conversations')
      .select(
        'id, file_name, title, agent_name, tags, status, created_at, updated_at, analyses(id, overall_sentiment, overall_score, resolution_status, escalation_risk, engine, degraded)'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1000);
    return (data ?? []).map((row) => toSummary(row as ConversationRow));
  }

  async updateConversationMeta(
    userId: string,
    conversationId: string,
    patch: ReportMetadataPatch
  ): Promise<Conversation | null> {
    const client = await getServerClient();
    if (!client) return null;

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.agentName !== undefined) update.agent_name = patch.agentName;
    if (patch.customerName !== undefined) update.customer_name = patch.customerName;
    if (patch.tags !== undefined) update.tags = patch.tags;
    if (patch.notes !== undefined) update.notes = patch.notes;

    // The `user_id` predicate is belt-and-braces on top of RLS: it keeps the
    // ownership check explicit at the call site.
    const { data, error } = await client
      .from('conversations')
      .update(update)
      .eq('id', conversationId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`update metadata: ${error.message}`);
    return (data as Conversation | null) ?? null;
  }

  async deleteConversations(userId: string, ids: string[]): Promise<DeleteResult> {
    const client = await getServerClient();
    if (!client || ids.length === 0) return { deleted: 0, storagePaths: [] };

    // Read the blob paths before the rows disappear.
    const { data: owned } = await client
      .from('conversations')
      .select('id, storage_path')
      .eq('user_id', userId)
      .in('id', ids);
    const rows = (owned ?? []) as Array<{ id: string; storage_path: string }>;
    if (rows.length === 0) return { deleted: 0, storagePaths: [] };

    const { error } = await client
      .from('conversations')
      .delete()
      .eq('user_id', userId)
      .in(
        'id',
        rows.map((r) => r.id)
      );
    if (error) throw new Error(`delete conversations: ${error.message}`);

    // analyses + sentences go with them via `on delete cascade`.
    return {
      deleted: rows.length,
      storagePaths: rows.map((r) => r.storage_path).filter(Boolean),
    };
  }
}

// ── row → ReportSummary ──
interface ConversationRow {
  id: string;
  file_name: string;
  title: string | null;
  agent_name: string | null;
  tags: string[] | null;
  status: ConversationStatus;
  created_at: string;
  updated_at: string | null;
  analyses:
    | Array<{
        id: string;
        overall_sentiment: string | null;
        overall_score: number | null;
        resolution_status: string | null;
        escalation_risk: number | null;
        engine: string | null;
        degraded: boolean | null;
      }>
    | null;
}

function toSummary(r: ConversationRow): ReportSummary {
  const a = r.analyses && r.analyses[0];
  return {
    conversationId: r.id,
    analysisId: a?.id ?? null,
    fileName: r.file_name,
    title: r.title ?? null,
    agentName: r.agent_name ?? null,
    tags: r.tags ?? [],
    status: r.status,
    overallSentiment: (a?.overall_sentiment as SentimentLabel) ?? null,
    overallScore: a?.overall_score ?? null,
    resolutionStatus: a?.resolution_status ?? null,
    escalationRisk: a?.escalation_risk ?? null,
    engine: a?.engine ?? null,
    degraded: a?.degraded ?? false,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
  };
}

let instance: SupabaseStore | null = null;
export function getSupabaseStore(): Store {
  if (!instance) instance = new SupabaseStore();
  return instance;
}