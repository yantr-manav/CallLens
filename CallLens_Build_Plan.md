# CallLens — Conversation Intelligence
### Complete Build, Architecture & Deployment Plan (Zero-Cost Stack)

> Rename freely — "CallLens" is just a working name so the product feels real instead of "Sentiment Analyzer v1".

---

## 1. Executive Summary

You are building a small, real product: upload a `.txt` call transcript → an n8n-orchestrated LLM pipeline analyzes it → a clean dashboard shows sentiment, emotion, KPIs, and reasoning.

**Non-negotiables from the assignment PDF (all covered below):**
- Next.js frontend, deployable on Vercel
- Basic auth, `.txt` upload, results dashboard
- Overall sentiment (Positive/Negative/Neutral) + sentence-level sentiment
- Call-relevant KPIs
- n8n (or agentic tool) as orchestration layer
- AI quality: logical accuracy + reasoning
- Clean architecture: UI → n8n → AI
- Good UX, charts, emotion detection, summary, extra KPIs

**Your constraints layered on top:** Supabase for DB/auth/storage, n8n self-hosted on Docker running 24/7 at **$0 cost**, real security practices, and a UI that reads as *designed by a person*, not scaffolded by an AI template.

---

## 2. Medium-Level System Design Principles Applied

These are the concepts to actually name in your README/interview — evaluators notice when a candidate uses the right vocabulary correctly, not just the right libraries.

| Principle | Where it's applied |
|---|---|
| **Separation of concerns** | UI (Next.js) never talks to AI directly. Orchestration (n8n) never talks to the browser. Each layer has one job. |
| **Contract-first / schema validation at every boundary** | Zod schema for the upload payload, Zod schema for the n8n→Next.js response, JSON Schema for the LLM's structured output. Nothing unvalidated crosses a boundary. |
| **Idempotency** | Each upload gets a content hash (SHA-256 of file bytes). Re-submitting the same file returns the cached analysis instead of re-billing the LLM. |
| **Defense in depth** | HMAC-signed webhook calls + Cloudflare Tunnel (no open inbound ports) + Supabase Row Level Security + short-lived signed URLs for file access. |
| **Fail fast / graceful degradation** | If the LLM call fails after N retries, the UI shows a clear retry state instead of a stuck spinner or a crash. Partial KPI failure (e.g., agent metrics) never blocks the rest of the dashboard. |
| **Backoff + retry** | n8n's LLM node retries with exponential backoff (max 3 attempts) before failing the workflow. |
| **Statelessness of the API layer** | Next.js API routes hold no session state in memory — everything lives in Supabase (Postgres) or signed cookies, so the app can scale horizontally without sticky sessions. |
| **Single source of truth for data** | All persistent state (users, analyses, sentence-level rows) lives in Supabase Postgres — nothing duplicated in n8n or the frontend. |
| **Observability** | Every analysis run gets a `request_id`, logged at: upload → n8n webhook received → LLM call → validation → stored. n8n's execution log becomes your free tracing tool. |
| **Least privilege** | Supabase service-role key never touches the browser. Browser only gets the anon key + RLS. n8n webhook only accepts calls with a valid HMAC signature, not just any POST. |
| **Caching** | Identical transcript hash → skip LLM call, serve stored result. Cuts cost and demonstrates you thought about it. |

---

## 3. Architecture Overview

```
                         Browser (user)
                               │
                               ▼
                  ┌─────────────────────────┐
                  │   Vercel — Next.js       │
                  │  UI + Auth guard + API   │
                  │  routes (thin proxy)     │
                  └────────────┬─────────────┘
                        │              │
                        │              │
             Supabase (auth, db,  HTTPS + HMAC-signed
              storage, RLS)          webhook call
                        │              │
                        ▼              ▼
              ┌──────────────┐  ┌─────────────────────────┐
              │  Supabase    │  │  Cloudflare Tunnel       │
              │  Postgres    │  │  (no open ports on VPS)  │
              └──────────────┘  └────────────┬─────────────┘
                                              ▼
                                 ┌─────────────────────────┐
                                 │  Free-tier VM (Oracle)   │
                                 │  Docker                  │
                                 │   └─ n8n container        │
                                 │        (SQLite, persisted│
                                 │         volume)          │
                                 └────────────┬─────────────┘
                                              ▼
                                     LLM API (Gemini free tier)
                                              │
                                              ▼
                                   Structured JSON result
                                              │
                                              ▼
                                 back through tunnel → Vercel
                                              │
                                              ▼
                                    stored in Supabase
                                              │
                                              ▼
                                     rendered on dashboard
```

**Rule that matters most for the "Architecture" KPI:** the browser never sees `N8N_WEBHOOK_URL`. It only ever calls `POST /api/analyze` on your own domain.

---

## 4. Tech Stack (all $0)

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind | Required by assignment, deploys free on Vercel |
| Hosting | Vercel (Hobby plan) | Free, zero-config Next.js deploys |
| Auth + DB + Storage | Supabase (free tier) | Postgres + Auth + Storage in one, generous free tier, real RLS |
| Orchestration | n8n (self-hosted, Docker, community edition) | Free forever when self-hosted, exactly what the assignment asks for |
| Always-on compute | Oracle Cloud **Always Free** VM (1–4 OCPU ARM, up to 24GB RAM) | Genuinely free forever, not a trial — this is the answer to "runs forever at 0 cost" |
| Exposure / HTTPS | Cloudflare Tunnel (`cloudflared`) | Free, no port-forwarding, no domain purchase required if you use a free `*.trycloudflare` named tunnel via a free Cloudflare account + free DNS |
| LLM | Google Gemini API free tier (Flash model) | Free quota, strong structured-output/JSON mode support |
| Charts | Recharts | Lightweight, no bloated dependency |

---

## 5. Zero-Cost "Runs Forever" Infrastructure Plan

**The core idea:** Docker doesn't make anything run forever — an **always-on machine** does. Docker just guarantees the process comes back after a crash or reboot.

### Steps
1. **Create an Oracle Cloud "Always Free" account** and spin up an ARM (Ampere) VM — this tier is free indefinitely, not a 12-month trial. Pick Ubuntu 24.04.
2. **Install Docker + Docker Compose** on the VM.
3. **Run n8n with a restart policy:**

```yaml
# docker-compose.yml
services:
  n8n:
    image: n8nio/n8n:latest
    restart: unless-stopped
    environment:
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
      - N8N_HOST=0.0.0.0
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=${WEBHOOK_URL}
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_ADMIN_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_ADMIN_PASSWORD}
      - GENERIC_TIMEZONE=Asia/Kolkata
    volumes:
      - n8n_data:/home/node/.n8n
    ports:
      - "127.0.0.1:5678:5678"   # only local — Cloudflare Tunnel exposes it, not the internet directly

volumes:
  n8n_data:
```

   - `restart: unless-stopped` → container survives crashes and VM reboots.
   - Port bound to `127.0.0.1` only — **no open inbound port on the public internet**, which is a real security win most candidates skip.
   - SQLite (n8n's default) is enough here — you don't need a separate Postgres for n8n itself, since your actual application data lives in Supabase. One less moving part = better system design, not worse.

4. **Expose it with Cloudflare Tunnel (free, no domain purchase needed):**
   - Create a free Cloudflare account, add `cloudflared` on the VM, authenticate, create a **named tunnel** (persists across restarts, unlike quick tunnels).
   - Cloudflare gives you free DNS + automatic HTTPS termination — no Caddy/Nginx cert management needed.
   - Result: `https://n8n.yourname.workers.dev`-style stable URL, or your own free/cheap domain if you have one, pointed at the tunnel.
5. **Enable n8n's basic auth** on the editor itself (env vars above) so nobody but you can open the workflow editor.
6. **Set the webhook node to require a header-based secret** (see §8.5) — this is separate from the editor login and protects the actual API endpoint.

This gives you a genuinely $0/month, always-on, crash-resistant, publicly reachable n8n instance with no open firewall ports.

---

## 6. Database Design (Supabase / Postgres)

Use Supabase Auth for login (email + password is "basic auth" per the assignment, but production-grade — stronger than a hardcoded `.env` credential pair, and free).

```sql
-- profiles: extends Supabase's built-in auth.users
create table profiles (
  id uuid references auth.users(id) primary key,
  full_name text,
  created_at timestamptz default now()
);

-- one row per uploaded transcript
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  file_name text not null,
  file_hash text not null,          -- sha256, used for idempotency/caching
  storage_path text not null,       -- Supabase Storage object path
  status text default 'pending',    -- pending | processing | done | failed
  created_at timestamptz default now(),
  unique (user_id, file_hash)
);

-- one row per analysis result (1:1 with conversation, kept separate for clean schema evolution)
create table analyses (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) not null,
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
  raw_json jsonb not null,          -- full structured LLM output, source of truth
  created_at timestamptz default now()
);

-- one row per sentence — powers the sentence-level table + timeline chart
create table sentences (
  id bigint generated always as identity primary key,
  analysis_id uuid references analyses(id) not null,
  seq int not null,
  speaker text,
  text text not null,
  sentiment text,
  score int,
  confidence numeric,
  emotion text
);

create index on sentences (analysis_id, seq);
create index on conversations (user_id, created_at desc);
```

### Row Level Security (non-negotiable)

```sql
alter table conversations enable row level security;
alter table analyses enable row level security;
alter table sentences enable row level security;

create policy "own conversations" on conversations
  for all using (auth.uid() = user_id);

create policy "own analyses" on analyses
  for select using (
    conversation_id in (select id from conversations where user_id = auth.uid())
  );

create policy "own sentences" on sentences
  for select using (
    analysis_id in (
      select a.id from analyses a
      join conversations c on c.id = a.conversation_id
      where c.user_id = auth.uid()
    )
  );
```

Storage bucket: `transcripts` (private), with a policy that only lets a user read/write their own `user_id/` prefix. Files are fetched via short-lived signed URLs, never public links.

---

## 7. Authentication & Security Checklist

- Supabase Auth (email/password) — password hashing, session, refresh tokens all handled for you; satisfies "basic auth is fine" while being real auth.
- Next.js middleware guards `/dashboard`, `/analyze`, `/reports/*` — unauthenticated users redirect to `/login`; authenticated users hitting `/login` redirect to `/dashboard`.
- **Never** expose `SUPABASE_SERVICE_ROLE_KEY` or `N8N_WEBHOOK_SECRET` to the client — only in Vercel server environment variables, read solely inside API routes.
- **Webhook signing:** Next.js signs each request to n8n with `HMAC-SHA256(body, N8N_WEBHOOK_SECRET)` in an `X-Signature` header; n8n's first node validates it and rejects anything that doesn't match — stops randoms from ever hitting your LLM even if they guess the URL.
- File validation server-side (never trust client-side checks alone): extension `.txt`, MIME type, size ≤ 2MB, non-empty, valid UTF-8.
- Rate limiting on `/api/analyze` — Upstash Redis free tier, sliding window, e.g. 10 requests/hour/user. Prevents cost blowups on the free LLM quota.
- Security headers via `next.config.js`: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- Cookies: `httpOnly`, `secure`, `sameSite=lax` (Supabase SSR helpers do this by default).
- `.env.local` and any secret files are git-ignored — see §13.
- No stack traces or raw error objects ever rendered to the user.

---

## 8. Backend Deep Dive — How the Sentiment Analyzer Actually Works

This is the part evaluators will probe hardest, so it needs to be airtight.

### 8.1 Upload → Normalize pipeline

```
Browser
  │  POST multipart file to /api/analyze
  ▼
Next.js API route
  │  1. Auth check (session)
  │  2. Validate file (type/size/non-empty/UTF-8)
  │  3. Compute SHA-256 hash
  │  4. Check Supabase: does a conversation with this hash+user already
  │     have a completed analysis? → if yes, return cached result (idempotency)
  │  5. Upload raw file to Supabase Storage
  │  6. Insert `conversations` row, status = 'processing'
  │  7. Call n8n webhook (HMAC-signed) with { conversation_id, text, file_name }
  ▼
n8n workflow (see 8.3)
  ▼
Next.js receives structured JSON, validates with Zod
  │  8. Insert `analyses` row + bulk-insert `sentences` rows
  │  9. Update conversation status = 'done'
  ▼
Frontend polls /api/analyze/status/:id (or Supabase Realtime subscription)
  → redirects to /reports/[id] when done
```

### 8.2 Handling Different Transcript `.txt` Formats — This Is the Hard Part

Real call transcripts arrive in wildly different shapes. Your **normalization layer** must detect the format and convert everything into one canonical turn-based structure before it reaches the LLM. This is what separates a toy demo from something that actually works.

Formats to explicitly support and test:

| Format | Example | Detection strategy |
|---|---|---|
| **Labeled dialogue** | `Customer: I've been waiting three days.`<br>`Agent: I understand the frustration.` | Regex: line starts with a short capitalized token + colon (`^([A-Za-z ]{2,20}):\s`). Most common — try first. |
| **Timestamped transcript** | `[00:01:23] Agent: Let me check that.` | Regex: leading `[hh:mm:ss]` or `hh:mm:ss —` before the speaker label. Strip timestamp, keep for the "key moments" timeline. |
| **Caption-style (SRT/VTT-like)** | Numbered blocks with time ranges and text on separate lines | Detect numeric index lines + `-->` time ranges; merge each block into one utterance. |
| **CSV/TSV-in-.txt export** | `timestamp,speaker,text` per line from a call-center tool | Detect a consistent delimiter (`,` or `\t`) across >80% of lines; parse as columns. |
| **Unlabeled alternating turns** | Plain lines, no speaker names, conversation clearly alternates | No reliable regex signal → fall back to LLM-based turn segmentation: ask the model to infer alternating `unknown_1`/`unknown_2` speakers rather than guessing "agent" vs "customer" (never invent identity — matches the assignment's "don't fabricate" rule). |
| **Single unbroken paragraph** | One block of prose describing/containing the call | Sentence-boundary split (simple NLP: punctuation + capitalization heuristics) → treat each sentence as an utterance, speaker = `unknown`. |

**Normalization algorithm (runs inside the Next.js API route, before the file ever reaches n8n — keeps n8n's job purely "analyze", not "guess file format"):**

1. Try each format detector in order of specificity (timestamped → labeled → CSV → caption → fallback).
2. Whichever detector matches ≥ 80% of non-empty lines wins.
3. Output a canonical array: `[{ seq, speaker, text, timestamp? }]`.
4. If no detector clears the 80% threshold, mark the whole transcript as `unlabeled_prose` and let the LLM do sentence segmentation itself (with a stricter prompt instruction to never invent speaker identity).
5. This canonical array is what actually gets sent to n8n — not the raw file — so the LLM prompt and JSON schema never have to special-case file formats.

### 8.3 n8n Workflow — `CALLLENS_ANALYZE_CONVERSATION`

```
Webhook (POST, HMAC-validated)
   ↓
Validate Input (payload shape, size, non-empty)
   ↓
Set Node — build the prompt from canonical turns
   ↓
LLM Node (Gemini, JSON mode / structured output schema enforced)
   ↓
Structured Output Validation (n8n's built-in schema check)
   ↓
IF invalid → retry LLM node (max 2 retries, exponential backoff)
   ↓
Respond to Webhook (200 + JSON, or 4xx/5xx with a clear error code)
```

Keep it a **deterministic pipeline, not an autonomous agent** — there's no tool selection or multi-step planning needed here, so an "AI Agent" node would be over-engineering. Naming this correctly in your README ("workflow, not agent") signals technical maturity.

### 8.4 What the LLM Must Return (enforced JSON Schema, not free text)

```json
{
  "overall_sentiment": { "label": "positive", "score": 72, "confidence": 0.89 },
  "summary": "max 3 sentences",
  "intent": { "category": "billing", "description": "short text" },
  "resolution": { "status": "resolved", "likelihood": 84 },
  "risk": { "escalation": 18 },
  "customer": { "frustration": "medium", "satisfaction": 76, "effort": "low" },
  "agent": { "empathy": 88, "clarity": 81, "professionalism": 92 },
  "emotions": [{ "label": "frustrated", "intensity": 68 }],
  "important_moments": [{ "seq": 3, "speaker": "customer", "event": "reports issue" }],
  "sentences": [
    { "seq": 1, "speaker": "customer", "text": "...", "sentiment": "negative", "score": 22, "confidence": 0.81, "emotion": "frustrated", "evidence": "short quote < 25 words" }
  ]
}
```

Hard rules baked into the system prompt (carried over from the assignment's own guidance — these are what make the AI Quality score high):
- Classify sentiment from **meaning/context**, not keyword matching (e.g. "I am not unhappy" ≠ automatically negative).
- Any metric without transcript evidence → `null`, never guessed.
- `agent.*` fields are `null` unless an agent is clearly identifiable.
- No chain-of-thought exposed — only short, evidence-backed explanations.
- All enums restricted to a fixed allowed-value list (prevents the dashboard from ever rendering an unexpected label).

### 8.5 Webhook Security Detail

```
Next.js:
  signature = HMAC_SHA256(JSON.stringify(payload), N8N_WEBHOOK_SECRET)
  header:  X-Signature: <signature>

n8n (first node, "Validate Input"):
  recompute HMAC on the received body with the same secret
  reject (401) on mismatch, before any LLM cost is incurred
```

### 8.6 Failure Modes Handled Explicitly

| Failure | User-facing message |
|---|---|
| File not `.txt` | "Only `.txt` files are supported." |
| Empty file | "This file doesn't contain any readable text." |
| >2MB | "File exceeds the 2 MB limit." |
| n8n unreachable | "Analysis service is temporarily unavailable. Please try again." |
| LLM call fails after retries | "We couldn't complete the analysis. Your file was not modified." |
| LLM returns invalid JSON | "The analysis returned an unexpected result. Please retry." |
| Rate limit hit | "You've reached the analysis limit for now — try again shortly." |

---

## 9. API Design (Next.js)

| Route | Method | Purpose |
|---|---|---|
| `/api/analyze` | POST | Accepts file, runs §8.1 pipeline, kicks off n8n call |
| `/api/analyze/status/[id]` | GET | Poll job status (or use Supabase Realtime instead) |
| `/api/reports` | GET | List user's past analyses |
| `/api/reports/[id]` | GET | Full analysis detail |
| `/api/n8n-callback` | POST | (Alternative to synchronous response) n8n posts result back here when done — useful if LLM latency is long; protected by the same HMAC scheme |

---

## 10. Frontend UI/UX — Page-by-Page

**Design language:** think Linear / Stripe dashboard / Intercom — restrained, off-white background, white cards, dark charcoal text, one accent color, 1px borders, 8px radius, compact type, generous whitespace. Explicitly avoid: gradients, glassmorphism, robot/brain icons, glowing borders, purple "AI" theming, giant hero sections, decorative emojis. Every element should look like it exists because it's useful, not because a template put it there.

### `/login`
**Looks like:** centered card, product name + tagline, email field, password field, one "Sign in" button. No marketing copy, no illustration.
**Works:** Supabase Auth email/password sign-in; inline validation errors ("Invalid email or password") — never a raw error object.
**Flow:** unauthenticated user lands here first → on success, redirect to `/dashboard`. Already-authenticated users hitting `/login` bounce straight to `/dashboard`.

### `/dashboard` (Overview)
**Looks like:** left sidebar (logo, Overview/Analyze/Reports links, divider, user email + logout) + main panel with a page title, one-line description, a primary "Analyze conversation" button, and a compact table of recent analyses (filename, sentiment badge, resolution badge, risk badge, date).
**Works:** table reads from `/api/reports` (last 10), each row links to `/reports/[id]`.
**Flow:** entry point after login; single clear CTA drives users to `/analyze`.

### `/analyze`
**Looks like:** a single upload card — drag-and-drop zone or "Browse files" button, format hint ("TXT • Max 2MB"). After selecting: filename, size, a "ready" checkmark, and an "Analyze conversation" button.
**Works:** client-side pre-validation (extension/size) for instant feedback, then real validation happens server-side regardless. On submit, shows a staged progress list (File received → Parsed → Evaluating sentiment → Extracting KPIs → Preparing insights) reflecting real backend stages, not a fake spinner.
**Flow:** on completion, auto-redirects to `/reports/[id]`.

### `/reports/[id]` (Results Dashboard — the core screen)
**Looks like, top to bottom:**
1. Header: filename + "analyzed [time]" + "New analysis" button.
2. Compact KPI row (4 small cards): Overall Sentiment, Resolution, Escalation Risk, Customer Satisfaction — each with a value, one-line interpretation, and confidence where relevant.
3. Sentiment distribution — simple horizontal bar chart (Positive/Neutral/Negative %).
4. Sentiment timeline — line chart of sentiment score across sentence sequence, so you can see the conversation's arc.
5. Emotion signals — compact horizontal bars, only for emotions actually detected (never pad with zero-value rows).
6. Conversation summary (max 3 sentences) + "Key moments" list (up to 6, each with a sequence reference).
7. "Why this analysis?" — short reasoning paragraph + 1–2 short evidence quotes (never full chain-of-thought).
8. Sentence-level table — Speaker / Text / Sentiment / Emotion / Confidence, filterable by All/Positive/Neutral/Negative, long text truncates with a popover.
9. Customer Experience / Resolution / Agent Quality detail cards — showing "Not enough evidence" text instead of a fake number wherever the API returned `null`.

**Flow:** this is where the evaluator spends the most time — it needs to visually communicate "I understood the requirements" within 5 seconds of loading (KPI row + charts above the fold), then reward deeper scrolling with sentence-level rigor and reasoning.

### `/reports` (list)
**Looks like:** same table pattern as the dashboard's recent-analyses widget, but full history with pagination and a sentiment filter.

**Global user flow:**
```
Sign in → Overview → Analyze → (upload + wait) → Results dashboard
                ↑                                        │
                └──────────── Reports list ←──────────────┘
```

---

## 11. Folder Structure

```
calllens/
├── app/
│   ├── login/page.tsx
│   ├── dashboard/page.tsx
│   ├── analyze/page.tsx
│   ├── reports/page.tsx
│   ├── reports/[id]/page.tsx
│   ├── api/
│   │   ├── analyze/route.ts
│   │   ├── analyze/status/[id]/route.ts
│   │   └── reports/route.ts
│   ├── layout.tsx
│   └── middleware.ts          # auth guard
├── components/
│   ├── dashboard/
│   ├── analysis/
│   ├── charts/
│   ├── upload/
│   └── ui/
├── lib/
│   ├── supabase/ (client.ts, server.ts)
│   ├── normalize.ts           # §8.2 format detection
│   ├── n8n.ts                 # signed webhook caller
│   ├── validation.ts          # Zod schemas
│   └── types.ts
├── n8n/
│   └── CALLLENS_ANALYZE_CONVERSATION.json   # exported workflow
├── infra/
│   ├── docker-compose.yml
│   └── cloudflared-config.yml
├── samples/
│   ├── labeled-dialogue.txt
│   ├── timestamped-call.txt
│   ├── unlabeled-prose.txt
│   └── csv-style-export.txt
├── .env.example
├── .gitignore
└── README.md
```

---

## 12. `.gitignore`

```gitignore
# dependencies
node_modules/
.pnp/
.pnp.js

# next.js
.next/
out/
build/

# env & secrets
.env
.env.local
.env.*.local
infra/*.env

# n8n local data (never commit workflow credentials/data dumps)
n8n_data/
infra/n8n_data/

# supabase local
.supabase/

# vercel
.vercel

# logs
*.log
npm-debug.log*

# OS/editor
.DS_Store
.idea/
.vscode/
*.swp

# testing
coverage/
```

---

## 13. Environment Variables (`.env.example`)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# n8n
N8N_WEBHOOK_URL=
N8N_WEBHOOK_SECRET=

# Rate limiting (Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# LLM (used inside n8n, not the frontend)
GEMINI_API_KEY=
```

Never commit real values — Vercel env vars (Production/Preview scoped) hold the frontend side; the VM's own `infra/.env` (chmod 600, git-ignored) holds n8n's side.

---

## 14. Implementation Timeline (realistic, assignment-pressure pace)

| Day | Focus |
|---|---|
| 1 | Supabase project + schema + RLS + Auth wiring; Next.js scaffold + login/middleware |
| 2 | Upload flow + file validation + normalization layer (§8.2) with all sample formats tested |
| 3 | Oracle VM + Docker + n8n + Cloudflare Tunnel live; webhook HMAC round-trip working end-to-end with a dummy response |
| 4 | Real LLM prompt + JSON schema in n8n; Zod validation on the Next.js side; store results in Supabase |
| 5 | Results dashboard UI — KPI cards, charts, sentence table, reasoning section |
| 6 | Reports list, polish, error states, responsive pass, rate limiting |
| 7 | Sample transcripts, README (with Mermaid architecture diagram), manual evaluation write-up, deploy + smoke test end-to-end on Vercel with laptop off |

---

## 15. Manual Evaluation (put real numbers in the README, never invented ones)

1. Manually label 8–10 sample transcripts yourself (mix of formats from §8.2) for overall sentiment.
2. Run them through the pipeline, record agreement:
   - Overall sentiment agreement: `x/10`
   - Sentence-level sentiment agreement (spot-check ~5 sentences per transcript): `x%`
   - Resolution classification agreement: `x/10`
3. Document 2–3 disagreement cases with your read on *why* the model got it wrong (e.g., sarcasm, ambiguous close). This shows evaluators you understand model limitations, which usually scores higher than a suspiciously clean 100%.

---

## 16. Final Submission Checklist

- [ ] Login / logout / protected routes work
- [ ] `.txt` upload validated client + server side, all sample formats from §8.2 parse correctly
- [ ] n8n workflow live on VM, survives a manual container restart and a VM reboot
- [ ] Webhook rejects unsigned requests (test with a bad signature)
- [ ] Overall + sentence-level sentiment, emotions, summary, intent, resolution, escalation risk, agent metrics (with correct `null` handling) all render
- [ ] Charts (distribution + timeline + emotion bars) render correctly on a real result
- [ ] Idempotency: re-uploading the same file returns the cached result instantly
- [ ] Rate limiting triggers correctly under repeated rapid uploads
- [ ] All error states (§8.6) tested by deliberately triggering them
- [ ] Responsive check on mobile width
- [ ] No secrets in git history — run a final `git log -p | grep -i key` sanity check
- [ ] README complete: overview, architecture (Mermaid diagram), why n8n, why this LLM, KPI definitions, env vars, local setup, VPS setup, deployment steps, evaluation numbers, known limitations, future improvements
- [ ] `n8n/CALLLENS_ANALYZE_CONVERSATION.json` exported and committed
- [ ] Full demo works with your laptop completely powered off
