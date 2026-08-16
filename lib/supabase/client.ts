'use client';

import { createBrowserClient } from '@supabase/ssr';
import { env, mode } from '@/lib/config';

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserClient() {
  if (!mode.supabaseConfigured) return null;
  if (cached) return cached;
  cached = createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
  return cached;
}

// Type alias so callers can reference it even in demo mode (it's null then).
export type BrowserClient = NonNullable<ReturnType<typeof getBrowserClient>>;