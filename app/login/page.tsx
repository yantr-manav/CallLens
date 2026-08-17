import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { modeSummary } from '@/lib/config';
import { LoginForm } from '@/components/auth/login-form';
import { Activity } from 'lucide-react';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string; registered?: string; email?: string };
}) {
  // Same-origin absolute paths only. `next` already starts with '/', so the old
  // `/${next}` produced '//dashboard' — which browsers read as a
  // protocol-relative URL (i.e. an open redirect).
  const next = searchParams.next;
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  const user = await getCurrentUser();
  if (user) redirect(dest);

  const lines = modeSummary();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">CallLens</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conversation Intelligence
          </p>
        </div>

        {/* Handed over by the sign-up form once the account is created. */}
        {searchParams.registered && !searchParams.error && (
          <p
            role="status"
            className="mb-4 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
          >
            Account created. Sign in to continue.
          </p>
        )}

        {searchParams.error && (
          <p
            role="alert"
            className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {searchParams.error}
          </p>
        )}

        <LoginForm next={searchParams.next} initialEmail={searchParams.email} />

        <p className="mt-4 text-center text-sm text-muted-foreground">
          New to CallLens?{' '}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>

        <div className="mt-6 space-y-1 text-center">
          {lines.map((l) => (
            <p key={l} className="text-xs text-muted-foreground/70">
              {l}
            </p>
          ))}
        </div>
      </div>
    </main>
  );
}