import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env, mode } from '@/lib/config';

// RLS-enforced client bound to the current request cookies. Use for reads and
// for conversation rows (RLS allows the owning user to insert/update their rows).
export async function getServerClient() {
  if (!mode.supabaseConfigured) return null;
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(
        toSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>
      ) {
        try {
          toSet.forEach(({ name, value, options }) =>
            store.set(name, value, options as never)
          );
        } catch {
          // Called from a Server Component where cookies are read-only — safe to ignore.
        }
      },
    },
  });
}

// Service-role client — bypasses RLS. Used ONLY in API routes to insert
// analyses + sentences (which have select-only policies) and never touches
// the browser. Fails loudly if not configured.
export function getServiceClient(): SupabaseClient | null {
  if (!mode.supabaseConfigured || !mode.serviceKeyConfigured) return null;
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}