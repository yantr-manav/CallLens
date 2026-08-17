import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { env, mode } from '@/lib/config';
import {
  SESSION_COOKIE,
  verifySessionCookie,
} from '@/lib/auth/session';

// Guards app pages. API routes enforce auth themselves (defense in depth).
const PROTECTED = ['/dashboard', '/analyze', '/reports'];

async function isAuthenticated(req: NextRequest): Promise<boolean> {
  if (mode.supabaseConfigured) {
    let authed = false;
    const res = NextResponse.next({ request: { headers: req.headers } });
    const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(
          toSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>
        ) {
          toSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options as never);
          });
        },
      },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    authed = Boolean(user);
    return authed;
  }
  const session = await verifySessionCookie(
    req.cookies.get(SESSION_COOKIE)?.value
  );
  return session !== null;
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // ── Supabase confirmation-link safety net ──
  // Supabase redirects email confirmations to the project's *Site URL*, which
  // by default is the bare origin — so the one-time PKCE code arrives as
  // `/?code=<uuid>` and nothing exchanges it. The user ends up staring at the
  // landing page, still signed out, with `?code=` in the address bar.
  // Forward any stray code to the route that actually redeems it, so this works
  // even if the Supabase "Redirect URLs" allow-list hasn't been updated.
  if (pathname === '/' && searchParams.has('code')) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth/callback';
    return NextResponse.redirect(url);
  }

  // The callback route must reach its handler to set the session cookies.
  if (pathname.startsWith('/auth/')) return NextResponse.next();

  const isProtected = PROTECTED.some((p) =>
    pathname === p || pathname.startsWith(p + '/')
  );
  const isLogin = pathname === '/login' || pathname === '/signup';

  if (!isProtected && !isLogin) return NextResponse.next();

  const authed = await isAuthenticated(req);

  if (isLogin && authed) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  if (isProtected && !authed) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Only run the guard on relevant paths — skip static + api.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};