import { useRef } from 'react';
import { Paperclip, Download, Trash2 } from 'lucide-react';
import { useCrm } from '@/store/crmStore';
import { Client } from '@/lib/types';
import { uid } from '@/lib/ids';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// ============================================================
// ATTACHMENTS — proposals, contracts, decks per client
// Files are stored as base64 in localStorage for now (2 MB cap
// per file to stay within browser limits). When Supabase is
// connected, upload to Storage and keep only the URL.
// ============================================================

const MAX_FILE_BYTES = 2 * 1024 * 1024;

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

export function AttachmentsSection({ client, actorName, canEdit }: Props) {
  const { addAttachment, removeAttachment } = useCrm();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is too large`, { description: 'Files up to 2 MB are supported in this preview build.' });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        addAttachment(client.businessId, {
          id: uid(),
          fileName: file.name,
          fileType: file.type || 'application/octet-stream',
          fileSize: file.size,
          dataUrl: reader.result as string,
          uploadedBy: actorName,
          uploadedAt: new Date().toISOString(),
        });
        toast.success('Attachment saved', { description: file.name });
      };
      reader.readAsDataURL(file);
    });
    if (inputRef.current) inputRef.current.value = '';
  };

  const download = (att: Client['attachments'][number]) => {
    const a = document.createElement('a');
    a.href = att.dataUrl;
    a.download = att.fileName;
    a.click();
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
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
              Upload file
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
                  <Button
                    size="icon" variant="ghost" className="h-8 w-8"
                    onClick={() => {
                      if (window.confirm(`Remove ${att.fileName}?`)) {
                        removeAttachment(client.businessId, att.id, actorName);
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
