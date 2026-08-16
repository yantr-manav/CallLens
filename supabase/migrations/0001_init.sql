-- CallLens — initial schema (run in Supabase SQL editor, or `supabase db push`)
-- Mirrors §6 of the build plan. RLS is non-negotiable.

-- extensions ---------------------------------------------------------------
create extension if not exists "pgcrypto";

-- profiles: extends auth.users ---------------------------------------------
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text,
  created_at timestamptz default now()
);

-- auto-create a profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- conversations: one row per uploaded transcript --------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  file_name text not null,
  file_hash text not null,
  storage_path text not null,
  status text default 'pending' check (status in ('pending','processing','done','failed')),
  created_at timestamptz default now(),
  unique (user_id, file_hash)
);

create index if not exists conversations_user_created_idx
  on public.conversations (user_id, created_at desc);

-- analyses: 1:1 with conversation ------------------------------------------
create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  overall_sentiment text,
  overall_score int,
  confidence numeric,
  summary text,
  intent text,
  resolution_status text,
  resolution_likelihood int,
  escalation_risk int,
  frustration text,
  satisfaction_signal int,
  effort text,
  agent_empathy int,
  agent_clarity int,
  agent_professionalism int,
  raw_json jsonb not null,
  created_at timestamptz default now()
);

create index if not exists analyses_conversation_idx
  on public.analyses (conversation_id);

-- sentences: one row per analyzed sentence ---------------------------------
create table if not exists public.sentences (
  id bigint generated always as identity primary key,
  analysis_id uuid references public.analyses(id) on delete cascade not null,
  seq int not null,
  speaker text,
  text text not null,
  sentiment text,
  score int,
  confidence numeric,
  emotion text
);

create index if not exists sentences_analysis_seq_idx
  on public.sentences (analysis_id, seq);

-- Row Level Security -------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.analyses enable row level security;
alter table public.sentences enable row level security;
alter table public.profiles enable row level security;

-- conversations: owner may do everything to their own rows
drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- analyses: owner can read; writes happen via the service-role key in API
drop policy if exists "own analyses select" on public.analyses;
create policy "own analyses select" on public.analyses
  for select using (
    conversation_id in (select id from public.conversations where user_id = auth.uid())
  );

-- sentences: owner can read
drop policy if exists "own sentences select" on public.sentences;
create policy "own sentences select" on public.sentences
  for select using (
    analysis_id in (
      select a.id from public.analyses a
      join public.conversations c on c.id = a.conversation_id
      where c.user_id = auth.uid()
    )
  );

-- profiles: owner can read/update their own
drop policy if exists "own profile select" on public.profiles;
create policy "own profile select" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Storage bucket: 'transcripts' (private) ----------------------------------
insert into storage.buckets (id, name, public)
values ('transcripts', 'transcripts', false)
on conflict (id) do nothing;

-- Only the owner may CRUD objects under their own user_id/ prefix.
drop policy if exists "transcripts own read" on storage.objects;
create policy "transcripts own read" on storage.objects
  for select using (
    bucket_id = 'transcripts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "transcripts own insert" on storage.objects;
create policy "transcripts own insert" on storage.objects
  for insert with check (
    bucket_id = 'transcripts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "transcripts own update" on storage.objects;
create policy "transcripts own update" on storage.objects
  for update using (
    bucket_id = 'transcripts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "transcripts own delete" on storage.objects;
create policy "transcripts own delete" on storage.objects
  for delete using (
    bucket_id = 'transcripts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );