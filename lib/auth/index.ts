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
    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes('disabled') || m.includes('provider')) {
        return {
          ok: false,
          error:
            'Email sign-in is disabled in your Supabase project. Enable Authentication → Providers → Email.',
        };
      }
      return { ok: false, error: 'Invalid email or password.' };
    }
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

// Self-service account creation — credentials are stored by Supabase Auth
// (auth.users) and the profiles row is auto-created by the on_auth_user_created
// trigger (supabase/migrations/0001_init.sql). When email confirmation is
// enabled on the project, signUp returns needsConfirmation and the user must
// confirm before the first sign-in.
export async function signUpUser(
  name: string,
  email: string,
  password: string,
  /**
   * Public origin of the running app, e.g. http://localhost:3000. Used to build
   * the confirmation-link destination. Without it Supabase falls back to the
   * project's Site URL, which is the bare origin — the one-time code then lands
   * on `/` where nothing redeems it.
   */
  origin?: string
): Promise<{ ok: boolean; error?: string; needsConfirmation?: boolean }> {
  if (mode.supabaseConfigured) {
    const client = await getServerClient();
    if (!client) return { ok: false, error: 'Auth service unavailable.' };
    const { data, error } = await client.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: { full_name: name.trim() },
        ...(origin ? { emailRedirectTo: `${origin}/auth/callback` } : {}),
      },
    });
    if (error) {
      // Map common Supabase errors to friendly, actionable messages.
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already been registered')) {
        return { ok: false, error: 'An account with this email already exists. Sign in instead.' };
      }
      if (msg.includes('password')) {
        return { ok: false, error: 'Password must be at least 8 characters.' };
      }
      if (msg.includes('disabled') || msg.includes('provider')) {
        return {
          ok: false,
          error:
            'Email sign-in is disabled in your Supabase project. Enable Authentication → Providers → Email.',
        };
      }
      if (
        msg.includes('email') ||
        msg.includes('send') ||
        msg.includes('rate') ||
        msg.includes('confirm')
      ) {
        return {
          ok: false,
          error:
            "Email confirmation is enabled but the email couldn't be sent. In Supabase, turn OFF 'Confirm email' (Authentication → Providers → Email), or configure SMTP, then retry.",
        };
      }
      return { ok: false, error: 'Could not create the account. Please try again.' };
    }
    const created = data.user?.created_at != null;
    const session = data.session != null;
    if (created && !session) {
      return { ok: true, needsConfirmation: true };
    }
    return { ok: true };
  }
  return {
    ok: false,
    error: 'Account creation is only available when Supabase is configured.',
  };
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