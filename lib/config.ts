// NOTE: intentionally NO 'server-only' import — this module is imported by
// the Edge middleware. Non-NEXT_PUBLIC env vars are stripped from client
// bundles by Next, so no secrets leak to the browser.
// Reads every variable once and exposes typed flags so the rest of the code
// never sprinkles `process.env.X ?` checks. The app auto-selects real
// infrastructure when configured, and a fully-functional local demo mode
// when not — zero code changes to flip between the two.

function required(name: string, fallback = ''): string {
  const v = process.env[name] ?? '';
  return v || fallback;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const env = {
  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  n8nWebhookUrl: required('N8N_WEBHOOK_URL'),
  n8nWebhookSecret: required('N8N_WEBHOOK_SECRET'),

  // Used by the in-app fallback engine only (lib/groq.ts, server-only). The
  // primary path keeps its own copy inside the n8n workflow. NEVER prefix this
  // with NEXT_PUBLIC_ — that would ship the key to the browser.
  groqApiKey: required('GROQ_API_KEY'),

  // Per-engine budgets. The ladder must fit inside maxDuration (60s) with room
  // for storage + DB writes.
  n8nTimeoutMs: num('N8N_TIMEOUT_MS', 12_000),
  // n8n Cloud's free tier can cold-start for 10-20s. Giving the first call of a
  // process a longer budget stops the very first demo upload from silently
  // landing on the fallback and looking like n8n was never wired up.
  n8nColdStartTimeoutMs: num('N8N_COLD_START_TIMEOUT_MS', 22_000),
  groqTimeoutMs: num('GROQ_TIMEOUT_MS', 20_000),

  upstashRedisUrl: required('UPSTASH_REDIS_REST_URL'),
  upstashRedisToken: required('UPSTASH_REDIS_REST_TOKEN'),

  authSecret:
    required('AUTH_SECRET') ||
    // Demo-only fallback. Real deploys always set AUTH_SECRET.
    'calllens-dev-secret-do-not-use-in-production',

  demoUserEmail: required('DEMO_USER_EMAIL', 'demo@calllens.local'),
  demoUserPassword: required('DEMO_USER_PASSWORD', 'calllens'),
  demoUserName: required('DEMO_USER_NAME', 'Demo Analyst'),
};

// Mode flags — single source of truth for "what's wired up".
export const mode = {
  supabaseConfigured: Boolean(env.supabaseUrl && env.supabaseAnonKey),
  serviceKeyConfigured: Boolean(env.supabaseServiceRoleKey),
  n8nConfigured: Boolean(env.n8nWebhookUrl && env.n8nWebhookSecret),
  groqConfigured: Boolean(env.groqApiKey),
  upstashConfigured: Boolean(env.upstashRedisUrl && env.upstashRedisToken),
};

// A human-readable banner so the developer always knows which mode is live.
export function modeSummary(): string[] {
  const lines: string[] = [];
  lines.push(mode.supabaseConfigured ? 'Supabase: LIVE' : 'Supabase: local demo');
  lines.push(mode.n8nConfigured ? 'n8n: LIVE' : 'n8n: local mock analyzer');
  lines.push(
    mode.groqConfigured ? 'Groq fallback: ready' : 'Groq fallback: not configured'
  );
  // Only the account identifier — never the password. This banner renders on
  // the public login page.
  if (!mode.supabaseConfigured) lines.push(`Demo user: ${env.demoUserEmail}`);
  return lines;
}