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

export const env = {
  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  n8nWebhookUrl: required('N8N_WEBHOOK_URL'),
  n8nWebhookSecret: required('N8N_WEBHOOK_SECRET'),

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
  upstashConfigured: Boolean(env.upstashRedisUrl && env.upstashRedisToken),
};

// A human-readable banner so the developer always knows which mode is live.
export function modeSummary(): string[] {
  const lines: string[] = [];
  lines.push(mode.supabaseConfigured ? 'Supabase: LIVE' : 'Supabase: local demo');
  lines.push(mode.n8nConfigured ? 'n8n: LIVE' : 'n8n: local mock analyzer');
  if (!mode.supabaseConfigured)
    lines.push(`Demo user: ${env.demoUserEmail} / ${env.demoUserPassword}`);
  return lines;
}