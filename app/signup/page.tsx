import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { SignupForm } from '@/components/auth/signup-form';
import { Activity } from 'lucide-react';

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">CallLens</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your account — credentials are stored in the database.
          </p>
        </div>

        <SignupForm />
      </div>
    </main>
  );
}
