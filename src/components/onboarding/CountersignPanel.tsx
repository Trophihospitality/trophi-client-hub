import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { FileText, CheckCircle2, Loader2, PenLine, X, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getClientContractsFn, createCountersignSessionFn } from '@/lib/client-signing.functions';
import { useAuth } from '@/store/userStore';

interface Props {
  businessId: string;
}

const KIND_ORDER = ['msa', 'order_form', 'client_authorization'] as const;

export function CountersignPanel({ businessId }: Props) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const getContracts = useServerFn(getClientContractsFn);
  const createSession = useServerFn(createCountersignSessionFn);
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
    onError: (e: any) => toast.error(e?.message ?? 'Could not start countersignature session'),
  });

  const close = () => {
    setOpenKind(null);
    setSessionUrl(null);
    qc.invalidateQueries({ queryKey: ['client-contracts', businessId] });
    qc.invalidateQueries({ queryKey: ['onboarding-detail', businessId] });
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading countersignature status…
      </div>
    );
  }
  if (!data) return null;

  const ordered = KIND_ORDER.map((k) => data.contracts.find((c) => c.kind === k)).filter(Boolean) as typeof data.contracts;
  const isDesignatedSigner = !!(
    profile?.email && data.staffSignerEmail &&
    profile.email.toLowerCase() === data.staffSignerEmail.toLowerCase()
  );

  const anyAwaiting = ordered.some((c) => c.clientSigned && !c.staffSigned && !c.errored);

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Trophi countersignature <span className="text-xs font-normal text-muted-foreground">· Step 4</span></div>
          {data.staffSignerEmail && (
            <div className="text-[11px] text-muted-foreground">
              Signer: <span className="font-mono">{data.staffSignerEmail}</span>
            </div>
          )}
        </div>
        {!isDesignatedSigner && data.staffSignerEmail && anyAwaiting && (
          <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            Only {data.staffSignerEmail} can countersign these documents. Sign in as that user to complete.
          </div>
        )}
      </div>

      <ul className="divide-y">
        {ordered.map((c) => {
          const awaiting = c.clientSigned && !c.staffSigned && !c.errored;
          const done = c.completed;
          const notYet = !c.clientSigned && !c.errored;
          return (
            <li key={c.kind} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  : awaiting ? <PenLine className="h-4 w-4 shrink-0 text-[hsl(var(--trophi-gold))]" />
                  : notYet ? <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.label}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Client: {c.clientSigned ? '✓ signed' : '— not signed'} · Trophi: {c.staffSigned ? '✓ signed' : '— not signed'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {done ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    Fully executed
                  </span>
                ) : c.errored ? (
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">
                    Errored
                  </span>
                ) : awaiting ? (
                  <Button
                    size="sm"
                    disabled={start.isPending || !isDesignatedSigner}
                    onClick={() => start.mutate(c.kind)}
                    className="bg-[hsl(var(--trophi-gold))] text-black hover:brightness-95"
                  >
                    {start.isPending && start.variables === c.kind
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening…</>
                      : <><PenLine className="mr-2 h-4 w-4" /> Countersign</>}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Waiting on client</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {data.allComplete && (
        <div className="border-t bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          All three documents fully executed. Step 4 will auto-complete via webhook.
        </div>
      )}

      {openKind && sessionUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-2 md:p-6">
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <div className="text-sm font-medium">
                Countersigning: {ordered.find((c) => c.kind === openKind)?.label}
              </div>
              <button onClick={close} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <iframe
              src={sessionUrl}
              title="PandaDoc countersignature session"
              className="flex-1 border-0"
              allow="clipboard-write"
            />
            <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
              Session expires in ~15 minutes. Close when finished — status updates automatically.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
