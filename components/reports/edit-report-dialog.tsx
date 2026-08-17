'use client';

import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toaster';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ReportMeta {
  title: string | null;
  agentName: string | null;
  customerName: string | null;
  tags: string[];
  notes: string | null;
}

const MAX_TAGS = 10;

export function EditReportDialog({
  open,
  onOpenChange,
  conversationId,
  fileName,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  fileName: string;
  initial: ReportMeta;
  onSaved?: () => void;
}) {
  const [title, setTitle] = useState(initial.title ?? '');
  const [agentName, setAgentName] = useState(initial.agentName ?? '');
  const [customerName, setCustomerName] = useState(initial.customerName ?? '');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [tags, setTags] = useState<string[]>(initial.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);

  function addTag() {
    const t = tagDraft.trim().slice(0, 24);
    if (!t) return;
    if (tags.length >= MAX_TAGS) {
      toast.error(`Up to ${MAX_TAGS} tags.`);
      return;
    }
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setTagDraft('');
      return;
    }
    setTags((prev) => [...prev, t]);
    setTagDraft('');
  }

  function onTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !tagDraft && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  async function save() {
    setSaving(true);
    try {
      // Send empty strings rather than omitting keys: the server maps '' to
      // null, which is how a field gets cleared.
      const res = await fetch(`/api/reports/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, agentName, customerName, notes, tags }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? 'Could not save changes.');
        return;
      }
      toast.success('Report details saved.');
      onOpenChange(false);
      onSaved?.();
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit report details</DialogTitle>
          <DialogDescription>
            Annotate <span className="font-medium">{fileName}</span>. These fields
            are yours — they never change the analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="rp-title">Title</Label>
            <Input
              id="rp-title"
              value={title}
              maxLength={120}
              placeholder={fileName}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rp-agent">Agent</Label>
              <Input
                id="rp-agent"
                value={agentName}
                maxLength={80}
                placeholder="e.g. Marcus"
                onChange={(e) => setAgentName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-customer">Customer</Label>
              <Input
                id="rp-customer"
                value={customerName}
                maxLength={80}
                placeholder="e.g. Priya"
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-tags">Tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <Badge key={t} variant="secondary" className="gap-1 pr-1">
                  {t}
                  <button
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                    className="rounded-sm p-0.5 hover:bg-background/60"
                    aria-label={`Remove tag ${t}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <Input
              id="rp-tags"
              value={tagDraft}
              maxLength={24}
              placeholder="Type a tag and press Enter"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={onTagKeyDown}
              onBlur={addTag}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-notes">Analyst notes</Label>
            <textarea
              id="rp-notes"
              value={notes}
              maxLength={2000}
              rows={4}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context the transcript doesn't capture…"
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
