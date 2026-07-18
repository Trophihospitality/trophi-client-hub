import { useRef, useState } from 'react';
import { Paperclip, Download, Trash2 } from 'lucide-react';
import { useCrm } from '@/store/crmStore';
import { Client } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useServerFn } from '@tanstack/react-start';
import { signAttachmentUrlFn } from '@/lib/crm.functions';

// Attachments now upload to Supabase Storage bucket 'client-attachments'.
// Path convention: <business_id>/<uuid>-<filename>
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

interface Props {
  client: Client;
  actorName: string;
  canEdit: boolean;
}

export function AttachmentsSection({ client, canEdit }: Props) {
  const { addAttachment, removeAttachment } = useCrm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const signUrl = useServerFn(signAttachmentUrlFn);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_BYTES) {
          toast.error(`${file.name} is too large`, { description: 'Files up to 25 MB are supported.' });
          continue;
        }
        const path = `${client.businessId}/${crypto.randomUUID()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from('client-attachments').upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) { toast.error(upErr.message); continue; }
        await addAttachment(client.businessId, {
          id: '', // set server-side
          fileName: file.name,
          fileType: file.type || 'application/octet-stream',
          fileSize: file.size,
          dataUrl: path,
          storagePath: path,
          uploadedBy: '',
          uploadedAt: new Date().toISOString(),
        } as any);
        toast.success('Attachment saved', { description: file.name });
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const download = async (att: Client['attachments'][number]) => {
    try {
      const res = await signUrl({ data: { attachmentId: att.id } });
      const a = document.createElement('a');
      a.href = res.url; a.download = res.fileName; a.target = '_blank';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e: any) {
      toast.error(e.message ?? 'Could not download');
    }
  };

  return (
    <section className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-[hsl(var(--trophi-gold))]" />
          Attachments ({client.attachments.length})
        </h2>
        {canEdit && (
          <>
            <input ref={inputRef} type="file" multiple className="hidden"
              onChange={(e) => handleFiles(e.target.files)} />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? 'Uploading…' : 'Upload file'}
            </Button>
          </>
        )}
      </div>
      {client.attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No files yet. Upload proposals, contracts, or decks to keep them with the account.
        </p>
      ) : (
        <div className="divide-y">
          {client.attachments.map((att) => (
            <div key={att.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{att.fileName}</div>
                <div className="text-xs text-muted-foreground">
                  {formatSize(att.fileSize)} · {att.uploadedBy} · {new Date(att.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => download(att)} aria-label={`Download ${att.fileName}`}>
                  <Download className="h-4 w-4" />
                </Button>
                {canEdit && (
                  <Button size="icon" variant="ghost" className="h-8 w-8"
                    onClick={() => {
                      if (window.confirm(`Remove ${att.fileName}?`)) {
                        removeAttachment(client.businessId, att.id, '');
                        toast.success('Attachment removed');
                      }
                    }}
                    aria-label={`Remove ${att.fileName}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
