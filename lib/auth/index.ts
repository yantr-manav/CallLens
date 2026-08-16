import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env, mode } from '@/lib/config';
import { getServerClient } from '@/lib/supabase/server';
import type { AuthUser } from '@/lib/types';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTS,
  createSessionCookie,
  verifySessionCookie,
} from '@/lib/auth/session';

// Unified auth API used by server components, route handlers and server
// actions. Identical surface regardless of whether Supabase or local demo
// mode is active — that's the whole point of the abstraction.

export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();

  if (mode.supabaseConfigured) {
    const client = await getServerClient();
    if (!client) return null;
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return null;
    return {
      id: user.id,
      email: user.email ?? '',
      name:
        (user.user_metadata?.full_name as string | undefined) ?? user.email ?? '',
    };
  }

  // Local demo mode — verify our HMAC cookie.
  const session = await verifySessionCookie(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return { id: session.sub, email: session.email, name: session.name };
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function signInUser(
  email: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  const store = await cookies();
  const cleanEmail = email.trim().toLowerCase();

  if (mode.supabaseConfigured) {
    const client = await getServerClient();
    if (!client) return { ok: false, error: 'Auth service unavailable.' };
    const { error } = await client.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    if (error) return { ok: false, error: 'Invalid email or password.' };
    return { ok: true };
  }

  // Local demo mode — single configured demo user.
  if (
    cleanEmail === env.demoUserEmail.toLowerCase() &&
    password === env.demoUserPassword
  ) {
    const cookie = await createSessionCookie({
      sub: 'demo-user-0000-0000-0000-000000000000',
      email: cleanEmail,
      name: env.demoUserName,
      provider: 'demo',
    });
    store.set(SESSION_COOKIE, cookie, SESSION_COOKIE_OPTS);
    return { ok: true };
  }
  return { ok: false, error: 'Invalid email or password.' };
}

export async function signOutUser(): Promise<void> {
  const store = await cookies();
  if (mode.supabaseConfigured) {
    const client = await getServerClient();
    if (client) await client.auth.signOut();
  }
  store.delete(SESSION_COOKIE);
  // Also clear any supabase cookies from a prior session.
  for (const c of store.getAll()) {
    if (c.name.startsWith('sb-')) store.delete(c.name);
  }
}

// Re-exported so callers don't need to know which file lives where.
export { SESSION_COOKIE, verifySessionCookie } from '@/lib/auth/session';