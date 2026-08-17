-- 0002 — report metadata (CRUD), analysis provenance, and the 1:1 guarantee.
--
-- Safe to re-run: every statement is idempotent.

begin;

-- ── Editable report metadata ──────────────────────────────────────────────
-- Backs the rename / tag / annotate half of the reports CRUD.
alter table public.conversations
  add column if not exists title          text,
  add column if not exists agent_name     text,
  add column if not exists customer_name  text,
  add column if not exists tags           text[] not null default '{}',
  add column if not exists notes          text,
  add column if not exists updated_at     timestamptz not null default now();

-- ── Analysis provenance ───────────────────────────────────────────────────
-- Which engine actually produced this row: 'n8n' (orchestrated, the primary
-- path), 'groq-direct' (in-app fallback) or 'heuristic' (no LLM available).
-- Surfaced in the UI so a fallback is never silently presented as if n8n had
-- served it.
alter table public.analyses
  add column if not exists engine     text,
  add column if not exists model      text,
  add column if not exists latency_ms integer,
  add column if not exists degraded   boolean not null default false;

-- Per-sentence justification. It was already captured in raw_json but never
-- given a column, so the sentence table could not render it.
alter table public.sentences
  add column if not exists evidence text;

-- ── Enforce one analysis per conversation ─────────────────────────────────
-- getAnalysisDetail() uses .maybeSingle(), which ERRORS when more than one row
-- matches. Without this constraint, re-running an analysis would insert a
-- second row and leave that report permanently unreadable.
-- De-duplicate first (keeping the newest), or the index creation fails.
delete from public.analyses a
  using public.analyses b
 where a.conversation_id = b.conversation_id
   and a.created_at < b.created_at;

-- Tie-break for rows sharing an identical created_at.
delete from public.analyses a
  using public.analyses b
 where a.conversation_id = b.conversation_id
   and a.created_at = b.created_at
   and a.ctid < b.ctid;

create unique index if not exists analyses_conversation_uniq
  on public.analyses (conversation_id);

-- ── Indexes for the reports list ──────────────────────────────────────────
create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);

-- Backfill updated_at for rows that predate the column.
update public.conversations
   set updated_at = created_at
 where updated_at is null;

commit;

-- ── RLS note (no new policies required) ───────────────────────────────────
-- conversations already has `for all using (auth.uid() = user_id) with check
-- (...)`, so an owner can UPDATE metadata and DELETE their own rows through the
-- normal (anon-key) client. analyses and sentences are SELECT-only, but both
-- reference conversations with `on delete cascade`, so deleting a conversation
-- removes them without needing a DELETE policy. Re-run still writes analyses
-- via the service client, exactly as createAnalysis already did.
