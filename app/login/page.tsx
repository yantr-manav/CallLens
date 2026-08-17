import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { modeSummary } from '@/lib/config';
import { LoginForm } from '@/components/auth/login-form';
import { Activity } from 'lucide-react';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const user = await getCurrentUser();
  if (user) redirect(searchParams.next ? `/${searchParams.next}` : '/dashboard');

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

        <LoginForm next={searchParams.next} />

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