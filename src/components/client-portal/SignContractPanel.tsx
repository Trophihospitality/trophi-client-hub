import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { FileText, CheckCircle2, Loader2, PenLine, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getClientContractsFn, createSigningSessionFn } from '@/lib/client-signing.functions';

interface Props {
  businessId: string;
}

const KIND_ORDER = ['msa', 'order_form', 'client_authorization'] as const;

export function SignContractPanel({ businessId }: Props) {
  const qc = useQueryClient();
  const getContracts = useServerFn(getClientContractsFn);
  const createSession = useServerFn(createSigningSessionFn);
  const [openKind, setOpenKind] = useState<string | null>(null);
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['client-contracts', businessId],
    queryFn: () => getContracts({ data: { businessId } }),
    refetchInterval: openKind ? 5000 : 30000,
  });

  const start = useMutation({
    mutationFn: (kind: 'msa' | 'order_form' | 'client_authorization') =>
      createSession({ data: { businessId, kind } }),
    onSuccess: (r, kind) => {
      setSessionUrl(r.sessionUrl);
      setOpenKind(kind);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not start signing session'),
  });

  const close = () => {
    setOpenKind(null);
    setSessionUrl(null);
    qc.invalidateQueries({ queryKey: ['client-contracts', businessId] });
    qc.invalidateQueries({ queryKey: ['client-portal', businessId] });
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading your documents…
      </div>
    );
  }
  if (!data) return null;

  const ordered = KIND_ORDER.map((k) => data.contracts.find((c) => c.kind === k)).filter(Boolean) as typeof data.contracts;

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold">Sign your Trophi documents</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          All signing happens here in the portal. You will not receive external emails.
        </div>
      </div>

      <ul className="divide-y">
        {ordered.map((c) => (
          <li key={c.kind} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              {c.completed
                ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="truncate text-sm font-medium">{c.label}</span>
            </div>
            <div className="flex items-center gap-2">
              {c.completed ? (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                  Signed
                </span>
              ) : c.pandadocDocumentId ? (
                <Button
                  size="sm"
                  onClick={() => start.mutate(c.kind)}
                  disabled={start.isPending}
                  className="bg-[hsl(var(--trophi-gold))] text-black hover:brightness-95"
                >
                  {start.isPending && start.variables === c.kind
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening…</>
                    : <><PenLine className="mr-2 h-4 w-4" /> Sign now</>}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Not ready yet</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {data.allComplete && (
        <div className="border-t bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          All three documents signed. Your Trophi team has been notified.
        </div>
      )}

      {openKind && sessionUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-2 md:p-6">
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <div className="text-sm font-medium">
                Signing: {ordered.find((c) => c.kind === openKind)?.label}
              </div>
              <button
                onClick={close}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close signing dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <iframe
              src={sessionUrl}
              title="PandaDoc signing session"
              className="flex-1 border-0"
              allow="clipboard-write"
            />
            <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
              Session expires in ~15 minutes. Close this window when finished — status updates automatically.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
