'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Download,
  FileJson,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toaster';
import { ConfirmDialog } from '@/components/reports/confirm-dialog';
import { EditReportDialog, type ReportMeta } from '@/components/reports/edit-report-dialog';

// The per-report action menu: edit metadata, re-run the analysis, export, delete.
export function ReportActions({
  conversationId,
  fileName,
  meta,
  hasAnalysis,
  onChanged,
  redirectAfterDelete = false,
}: {
  conversationId: string;
  fileName: string;
  meta: ReportMeta;
  hasAnalysis: boolean;
  onChanged?: () => void;
  /** Detail page deletes navigate away; list deletes just refresh in place. */
  redirectAfterDelete?: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  function refresh() {
    router.refresh();
    onChanged?.();
  }

  async function rerun() {
    setRerunning(true);
    const t = toast.loading('Re-running analysis…');
    try {
      const res = await fetch(`/api/reports/${conversationId}/rerun`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? 'Re-run failed.', { id: t });
        return;
      }
      const via =
        data.engine === 'n8n'
          ? `n8n → ${data.model}`
          : data.engine === 'groq-direct'
            ? 'direct Groq fallback'
            : 'heuristic fallback';
      toast.success(
        `Re-analyzed via ${via} in ${((data.latencyMs ?? 0) / 1000).toFixed(1)}s.`,
        { id: t }
      );
      refresh();
    } catch {
      toast.error('Could not reach the server.', { id: t });
    } finally {
      setRerunning(false);
    }
  }

  async function remove() {
    const res = await fetch(`/api/reports/${conversationId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data?.error ?? 'Could not delete this report.');
      return;
    }
    toast.success('Report deleted.');
    if (redirectAfterDelete) {
      router.push('/reports');
      router.refresh();
    } else {
      refresh();
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="Report actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit details
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={rerun} disabled={rerunning}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            {rerunning ? 'Re-running…' : 'Re-run analysis'}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Plain links, not fetch+blob: the response carries
              Content-Disposition, so the browser saves it directly. */}
          <DropdownMenuItem asChild disabled={!hasAnalysis}>
            <a href={`/api/reports/${conversationId}/export?format=json`}>
              <FileJson className="mr-2 h-3.5 w-3.5" />
              Export JSON
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild disabled={!hasAnalysis}>
            <a href={`/api/reports/${conversationId}/export?format=csv`}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Export sentences CSV
            </a>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => setDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editOpen && (
        <EditReportDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          conversationId={conversationId}
          fileName={fileName}
          initial={meta}
          onSaved={refresh}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this report?"
        description={
          <>
            <span className="font-medium text-foreground">
              {meta.title || fileName}
            </span>{' '}
            and its analysis, sentence breakdown and stored transcript will be
            permanently removed. This cannot be undone.
          </>
        }
        onConfirm={remove}
      />
    </>
  );
}
