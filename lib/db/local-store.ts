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
  ReportSummary,
  Store,
} from '@/lib/db/store';
import { mode } from '@/lib/config';

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

  async createAnalysis(input: CreateAnalysisInput) {
    const db = await load();
    const r = input.result;
    const id = randomUUID();
    const nowISO = new Date().toISOString();

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
    };
    db.analyses.push(analysis);

    const sentenceRows: SentenceRow[] = r.sentences.map((s) => ({
      id: db!.nextSentenceId++,
      analysis_id: id,
      seq: s.seq,
      speaker: s.speaker,
      text: s.text,
      sentiment: s.sentiment,
      score: s.score,
      confidence: s.confidence,
      emotion: s.emotion,
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

  async listReports(userId: string, limit = 10, offset = 0) {
    const db = await load();
    const userConvs = db.conversations
      .filter((c) => c.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const slice = userConvs.slice(offset, offset + limit);
    return slice.map<ReportSummary>((c) => {
      const a = db.analyses.find((an) => an.conversation_id === c.id);
      return {
        conversationId: c.id,
        analysisId: a?.id ?? null,
        fileName: c.file_name,
        status: c.status,
        overallSentiment: (a?.overall_sentiment as SentimentLabel) ?? null,
        overallScore: a?.overall_score ?? null,
        resolutionStatus: a?.resolution_status ?? null,
        escalationRisk: a?.escalation_risk ?? null,
        createdAt: c.created_at,
      };
    });
  }

  async countReports(userId: string) {
    const db = await load();
    return db.conversations.filter((c) => c.user_id === userId).length;
  }
}

let instance: LocalStore | null = null;
export function getLocalStore(): Store {
  if (!instance) instance = new LocalStore();
  return instance;
}

// Suppress unused-import warning in configs where mode isn't read here directly.
void mode;