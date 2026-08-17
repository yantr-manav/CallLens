import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Analysis,
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

// Local demo store — a single JSON file under .local-store/db.json.
// Selected automatically when Supabase isn't configured. Good enough for a
// single-process dev server; real multi-instance deploys use Supabase.

const STORE_DIR = path.join(process.cwd(), '.local-store');
const STORE_FILE = path.join(STORE_DIR, 'db.json');

interface LocalDB {
  conversations: Conversation[];
  analyses: Analysis[];
  sentences: SentenceRow[];
  nextSentenceId: number;
}

const EMPTY: LocalDB = {
  conversations: [],
  analyses: [],
  sentences: [],
  nextSentenceId: 1,
};

let cache: LocalDB | null = null;

async function load(): Promise<LocalDB> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    cache = { ...EMPTY, ...(JSON.parse(raw) as LocalDB) };
  } catch {
    cache = { ...EMPTY };
  }
  return cache;
}

async function persist(db: LocalDB): Promise<void> {
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

class LocalStore implements Store {
  async findConversationByHash(userId: string, fileHash: string) {
    const db = await load();
    return (
      db.conversations.find(
        (c) => c.user_id === userId && c.file_hash === fileHash
      ) ?? null
    );
  }

  async createConversation(input: CreateConversationInput) {
    const db = await load();
    const conv: Conversation = {
      id: randomUUID(),
      user_id: input.userId,
      file_name: input.fileName,
      file_hash: input.fileHash,
      storage_path: input.storagePath,
      status: 'processing',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: [],
    };
    db.conversations.push(conv);
    await persist(db);
    return conv;
  }

  async updateConversationStatus(
    conversationId: string,
    status: ConversationStatus
  ) {
    const db = await load();
    const conv = db.conversations.find((c) => c.id === conversationId);
    if (conv) conv.status = status;
    await persist(db);
  }

  async getConversation(userId: string, conversationId: string) {
    const db = await load();
    return (
      db.conversations.find(
        (c) => c.id === conversationId && c.user_id === userId
      ) ?? null
    );
  }

  async replaceAnalysis(input: CreateAnalysisInput) {
    const db = await load();
    const r = input.result;
    const id = randomUUID();
    const nowISO = new Date().toISOString();

    // Mirror the Supabase 1:1 constraint: drop any prior analysis (and its
    // sentences) so a re-run updates in place instead of accumulating rows.
    const stale = db.analyses.filter((a) => a.conversation_id === input.conversationId);
    if (stale.length > 0) {
      const staleIds = new Set(stale.map((a) => a.id));
      db.analyses = db.analyses.filter((a) => !staleIds.has(a.id));
      db.sentences = db.sentences.filter((s) => !staleIds.has(s.analysis_id));
    }

    const analysis: Analysis = {
      id,
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
      raw_json: r,
      created_at: nowISO,
      engine: input.engine ?? null,
      model: input.model ?? null,
      latency_ms: input.latencyMs ?? null,
      degraded: input.degraded ?? false,
    };
    db.analyses.push(analysis);

    const sentenceRows: SentenceRow[] = r.sentences.map((s) => ({
      id: db.nextSentenceId++,
      analysis_id: id,
      seq: s.seq,
      speaker: s.speaker,
      text: s.text,
      sentiment: s.sentiment,
      score: s.score,
      confidence: s.confidence,
      emotion: s.emotion,
      evidence: s.evidence ?? null,
    }));
    db.sentences.push(...sentenceRows);

    const conv = db.conversations.find((c) => c.id === input.conversationId);
    if (conv) conv.status = 'done';

    await persist(db);
    return analysis;
  }

  async getAnalysisDetail(conversationId: string): Promise<AnalysisDetail | null> {
    const db = await load();
    const analysis = db.analyses.find(
      (a) => a.conversation_id === conversationId
    );
    if (!analysis) return null;
    const sentences = db.sentences
      .filter((s) => s.analysis_id === analysis.id)
      .sort((a, b) => a.seq - b.seq);
    return { analysis, sentences };
  }

  private async summaries(userId: string): Promise<ReportSummary[]> {
    const db = await load();
    return db.conversations
      .filter((c) => c.user_id === userId)
      .map<ReportSummary>((c) => {
        const a = db.analyses.find((an) => an.conversation_id === c.id);
        return {
          conversationId: c.id,
          analysisId: a?.id ?? null,
          fileName: c.file_name,
          title: c.title ?? null,
          agentName: c.agent_name ?? null,
          tags: c.tags ?? [],
          status: c.status,
          overallSentiment: (a?.overall_sentiment as SentimentLabel) ?? null,
          overallScore: a?.overall_score ?? null,
          resolutionStatus: a?.resolution_status ?? null,
          escalationRisk: a?.escalation_risk ?? null,
          engine: a?.engine ?? null,
          degraded: a?.degraded ?? false,
          createdAt: c.created_at,
          updatedAt: c.updated_at ?? c.created_at,
        };
      });
  }

  async listReports(userId: string, filter: ReportFilter = {}): Promise<ReportPage> {
    const limit = Math.min(100, Math.max(1, filter.limit ?? 10));
    const offset = Math.max(0, filter.offset ?? 0);
    let items = await this.summaries(userId);

    if (filter.sentiment && filter.sentiment !== 'all') {
      items = items.filter((r) => r.overallSentiment === filter.sentiment);
    }
    const q = filter.q?.trim().toLowerCase();
    if (q) {
      items = items.filter((r) =>
        [r.title, r.fileName, r.agentName]
          .filter((v): v is string => Boolean(v))
          .some((v) => v.toLowerCase().includes(q))
      );
    }

    switch (filter.sort) {
      case 'oldest':
        items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        break;
      case 'score_desc':
        items.sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1));
        break;
      case 'score_asc':
        items.sort((a, b) => (a.overallScore ?? -1) - (b.overallScore ?? -1));
        break;
      default:
        items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    // Count BEFORE slicing so pagination reflects the filtered total.
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  async listAllForExport(userId: string): Promise<ReportSummary[]> {
    const items = await this.summaries(userId);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateConversationMeta(
    userId: string,
    conversationId: string,
    patch: ReportMetadataPatch
  ): Promise<Conversation | null> {
    const db = await load();
    const conv = db.conversations.find(
      (c) => c.id === conversationId && c.user_id === userId
    );
    if (!conv) return null;
    if (patch.title !== undefined) conv.title = patch.title;
    if (patch.agentName !== undefined) conv.agent_name = patch.agentName;
    if (patch.customerName !== undefined) conv.customer_name = patch.customerName;
    if (patch.tags !== undefined) conv.tags = patch.tags;
    if (patch.notes !== undefined) conv.notes = patch.notes;
    conv.updated_at = new Date().toISOString();
    await persist(db);
    return conv;
  }

  async deleteConversations(userId: string, ids: string[]): Promise<DeleteResult> {
    const db = await load();
    const target = db.conversations.filter(
      (c) => c.user_id === userId && ids.includes(c.id)
    );
    if (target.length === 0) return { deleted: 0, storagePaths: [] };

    const convIds = new Set(target.map((c) => c.id));
    const analysisIds = new Set(
      db.analyses.filter((a) => convIds.has(a.conversation_id)).map((a) => a.id)
    );

    db.conversations = db.conversations.filter((c) => !convIds.has(c.id));
    db.analyses = db.analyses.filter((a) => !convIds.has(a.conversation_id));
    db.sentences = db.sentences.filter((s) => !analysisIds.has(s.analysis_id));
    await persist(db);

    return {
      deleted: target.length,
      storagePaths: target.map((c) => c.storage_path).filter(Boolean),
    };
  }
}

let instance: LocalStore | null = null;
export function getLocalStore(): Store {
  if (!instance) instance = new LocalStore();
  return instance;
}