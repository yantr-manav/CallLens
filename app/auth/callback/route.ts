import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// ── GET /auth/callback — completes Supabase's email-confirmation redirect ──
//
// When "Confirm email" is enabled, Supabase emails a link that bounces the user
// back to the project's Site URL carrying a one-time PKCE code:
//
//     http://localhost:3000/auth/callback?code=<uuid>
//
// That code is NOT a session. It has to be exchanged for one, and the resulting
// auth cookies written onto the response — otherwise the user lands on a page
// with a `?code=` in the address bar and is still signed out, which is exactly
// what was happening before this route existed.
//
// Supabase also uses this same redirect for password-recovery and magic links,
// so the exchange is handled in one place.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get('code');

  // Supabase reports failures as query params rather than a non-2xx response.
  const authError = searchParams.get('error_description') ?? searchParams.get('error');

  // Only same-origin relative paths — never redirect to an attacker-supplied
  // absolute URL, and never to '//host' (a protocol-relative URL).
  const requested = searchParams.get('next');
  const next =
    requested && requested.startsWith('/') && !requested.startsWith('//')
      ? requested
      : '/dashboard';

  if (authError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(authError)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        'That confirmation link is missing its code. Request a new one.'
      )}`
    );
  }

  const supabase = await getServerClient();
  if (!supabase) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('Auth service unavailable.')}`
    );
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Most common cause: the link was already used, or it expired.
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        'That confirmation link is invalid or has already been used. Sign in, or request a new link.'
      )}`
    );
  }

  // getServerClient()'s setAll() has written the sb-* cookies onto the outgoing
  // response, so the redirect lands already authenticated.
  return NextResponse.redirect(`${origin}${next}`);
}
