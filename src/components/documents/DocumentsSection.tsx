import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Download, FileText, FolderClosed, Lock, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  listClientDocumentsFn, getDocumentSignedUrlFn, syncSignedPdfsFn,
  type DocumentContractItem, type DocumentFileItem,
} from '@/lib/documents.functions';

// ============================================================
// DOCUMENTS SECTION
// Reused by Trophi CRM/Onboarding views and the client portal.
// The server function enforces client vs staff visibility;
// `mode="client"` here only tweaks copy/headers.
// ============================================================

function formatBytes(n: number | null): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function DocumentsSection({
  businessId, mode = 'staff',
}: { businessId: string; mode?: 'staff' | 'client' }) {
  const list = useServerFn(listClientDocumentsFn);
  const sign = useServerFn(getDocumentSignedUrlFn);
  const sync = useServerFn(syncSignedPdfsFn);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['client-documents', businessId],
    queryFn: () => list({ data: { businessId } }),
    enabled: !!businessId,
  });

  const syncM = useMutation({
    mutationFn: () => sync({ data: { businessId } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['client-documents', businessId] });
      const n = Array.isArray(r) ? r.filter((x) => !x.error).length : 0;
      toast.success(`Synced ${n} document${n === 1 ? '' : 's'} from PandaDoc`);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Sync failed'),
  });

  const open = async (bucket: 'contracts' | 'payment' | 'client-attachments', path: string) => {
    try {
      const r = await sign({ data: { bucket, path } });
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not open document');
    }
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading documents…</div>;
  if (error) return <div className="text-sm text-destructive">Could not load documents.</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {mode === 'staff' && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => syncM.mutate()}
            disabled={syncM.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${syncM.isPending ? 'animate-spin' : ''}`} />
            {syncM.isPending ? 'Syncing…' : 'Re-sync signed PDFs'}
          </button>
        </div>
      )}
      <ContractsCard
        items={data.contracts} businessId={businessId} mode={mode}
        onOpen={(p) => open('contracts', p)}
      />

      <FilesCard
        title="Contracts (other files)"
        folder="contracts"
        items={data.files.contracts}
        onOpen={(p) => open('contracts', p)}
        emptyHint="No additional files in this folder."
      />

      <FilesCard
        title="Forms"
        folder="forms"
        items={data.files.forms}
        onOpen={(p) => open('client-attachments', p)}
        emptyHint="No forms uploaded yet."
      />

      <FilesCard
        title="Assets"
        folder="assets"
        items={data.files.assets}
        onOpen={(p) => open('client-attachments', p)}
        emptyHint="No brand assets uploaded yet."
      />

      {mode === 'staff' ? (
        <FilesCard
          title="Payment (Trophi only)"
          folder="payment"
          restricted
          items={data.files.payment}
          onOpen={(p) => open('payment', p)}
          emptyHint="No payment documents on file."
        />
      ) : null}
    </div>
  );
}

function ContractsCard({
  items, businessId, mode, onOpen,
}: {
  items: DocumentContractItem[]; businessId: string; mode: 'staff' | 'client';
  onOpen: (path: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-trophi-ink">
          <FileText className="h-4 w-4 text-[hsl(var(--trophi-gold))]" /> Contracts
        </div>
        <div className="text-[11px] font-mono text-muted-foreground">{businessId}</div>
      </div>
      {items.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          {mode === 'client'
            ? 'No signed contracts are available yet. Your Trophi team will share them here once executed.'
            : 'No contracts on file for this client yet.'}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted">
            <tr>
              <th className="px-4 py-2">Document</th>
              <th className="px-4 py-2">Business ID</th>
              <th className="px-4 py-2">Executed</th>
              <th className="px-4 py-2">Locations</th>
              <th className="px-4 py-2 text-right">Size</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((c) => {
              const executed = c.status === 'document.completed';
              return (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.documentName}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.kindLabel} · <span className="capitalize">{c.status.replace('document.', '')}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{c.businessId}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(c.executedAt)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {c.locationIds.length ? c.locationIds.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{formatBytes(c.fileSize)}</td>
                  <td className="px-4 py-3 text-right">
                    {executed && c.storagePath ? (
                      <button
                        onClick={() => onOpen(c.storagePath!)}
                        className="inline-flex items-center gap-1 text-xs text-[hsl(var(--trophi-gold))] hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> View / Download
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not yet available</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FilesCard({
  title, folder, items, onOpen, emptyHint, restricted,
}: {
  title: string; folder: string; items: DocumentFileItem[];
  onOpen: (path: string) => void; emptyHint: string; restricted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-trophi-ink">
          {restricted
            ? <Lock className="h-4 w-4 text-muted-foreground" />
            : <FolderClosed className="h-4 w-4 text-muted-foreground" />}
          {title}
          <span className="text-[11px] font-mono text-muted-foreground">/{folder}/</span>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">{emptyHint}</div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((f) => (
            <li key={f.storagePath} className="flex items-center justify-between px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">{f.name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(f.size)} · {formatDate(f.updatedAt)}
                </div>
              </div>
              <button
                onClick={() => onOpen(f.storagePath)}
                className="inline-flex items-center gap-1 text-xs text-[hsl(var(--trophi-gold))] hover:underline"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
