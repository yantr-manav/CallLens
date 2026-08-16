import { requireUser } from '@/lib/auth';
import { AppShell } from '@/components/layout/app-shell';
import { UploadZone } from '@/components/analyze/upload-zone';

export const dynamic = 'force-dynamic';

export default async function AnalyzePage() {
  const user = await requireUser();
  return (
    <AppShell user={user}>
      <UploadZone />
    </AppShell>
  );
}