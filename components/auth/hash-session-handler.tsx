'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getBrowserClient } from '@/lib/supabase/client';

// ── Completes Supabase redirects that arrive in the URL *hash* ──
//
// Supabase finishes an email confirmation in one of two shapes:
//
//   ?code=<uuid>                 PKCE  → redeemed server-side by /auth/callback
//   #access_token=…&refresh_token=…    implicit → ONLY visible to the browser
//
// A fragment is never transmitted to the server, so no route handler or
// middleware can see the second form — it needs client-side JS. Without this,
// a user clicking a confirmation link lands on the page still signed out, with
// a wall of token text in the address bar.
//
// createBrowserClient (@supabase/ssr) persists the session to cookies rather
// than localStorage, so the server picks it up on the very next request.
export function HashSessionHandler() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;

    const params = new URLSearchParams(hash.slice(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const errorDescription =
      params.get('error_description') ?? params.get('error');

    if (!accessToken && !errorDescription) return;

    // Strip the tokens from the address bar before doing anything else, so they
    // don't linger in history or get copy-pasted into a bug report.
    const clean = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', clean);

    if (errorDescription) {
      router.replace(`/login?error=${encodeURIComponent(errorDescription)}`);
      return;
    }

    const supabase = getBrowserClient();
    if (!supabase || !accessToken || !refreshToken) {
      router.replace(
        `/login?error=${encodeURIComponent(
          'Could not complete sign-in from that link. Please sign in manually.'
        )}`
      );
      return;
    }

    setBusy(true);
    void supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          router.replace(
            `/login?error=${encodeURIComponent(
              'That link has expired. Please sign in, or request a new one.'
            )}`
          );
          return;
        }
        router.replace('/dashboard');
        router.refresh();
      })
      .finally(() => setBusy(false));
  }, [router]);

  if (!busy) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="flex items-center gap-3 text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Confirming your account…
      </div>
    </div>
  );
}
