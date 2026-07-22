import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { CreditCard, CheckCircle2, Circle, Loader2, AlertTriangle, FileWarning, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getPaymentSetupStatusFn } from '@/lib/payments.functions';
import { getPaymentAuthStatusFn, generatePaymentAuthorizationFn, voidPaymentAuthFn } from '@/lib/payment-auth.functions';

interface Props {
  businessId: string;
  canManage: boolean;
}

export function Step5PaymentStatusPanel({ businessId, canManage }: Props) {
  const qc = useQueryClient();
  const getStatus = useServerFn(getPaymentSetupStatusFn);
  const getAuth = useServerFn(getPaymentAuthStatusFn);
  const generate = useServerFn(generatePaymentAuthorizationFn);
  const voidAuth = useServerFn(voidPaymentAuthFn);

  const { data: setup, isLoading: sl } = useQuery({
    queryKey: ['payment-setup-status', businessId],
    queryFn: () => getStatus({ data: { businessId } }),
    refetchInterval: 15000,
  });
  const { data: auth, isLoading: al } = useQuery({
    queryKey: ['payment-auth-status', businessId],
    queryFn: () => getAuth({ data: { businessId } }),
    refetchInterval: 15000,
  });

  const genM = useMutation({
    // Staff-side manual click is an admin fallback — force regenerate so
    // it always rebuilds cleanly rather than reusing a live doc.
    mutationFn: () => generate({ data: { businessId, intent: 'regenerate' as const } }),
    onSuccess: (r: any) => {
      if (r?.error) toast.error(r.error);
      else toast.success('Payment Authorization generated');
      qc.invalidateQueries({ queryKey: ['payment-auth-status', businessId] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to generate'),
  });
  const voidM = useMutation({
    mutationFn: () => voidAuth({ data: { businessId } }),
    onSuccess: () => { toast.success('Payment Authorization voided'); qc.invalidateQueries({ queryKey: ['payment-auth-status', businessId] }); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to void'),
  });

  if (sl || al) return <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading payment status…</div>;
  if (!setup) return null;

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Step 5 · Payment Authorization</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Scope: <strong>{setup.scope === 'brand' ? 'Brand-wide' : setup.scope === 'per_location' ? 'Per-location' : 'Not set'}</strong>
            {' · '}Captured: <strong>{setup.filled}/{setup.total}</strong>
          </div>
        </div>
        <CreditCard className="h-4 w-4 text-muted-foreground" />
      </div>

      {!setup.scope && (
        <div className="p-4 text-sm text-muted-foreground">
          Waiting on Step 2 — the account owner must record the payment scope before the client can capture methods.
        </div>
      )}

      {setup.scope && (
        <>
          <ul className="divide-y">
            {setup.slots.map((s) => (
              <li key={s.key} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {s.captured
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {s.scope === 'brand' ? 'Brand-wide method' : `${s.locationName ?? s.locationId}`}
                    </div>
                    {s.locationId && <div className="text-xs font-mono text-muted-foreground">{s.locationId}</div>}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.captured
                    ? <><span className="uppercase">{s.captured.methodType === 'us_bank_account' ? 'ACH' : (s.captured.brand ?? 'card')}</span> •••• {s.captured.last4}</>
                    : 'Awaiting client'}
                </div>
              </li>
            ))}
          </ul>

          <div className="border-t px-4 py-3 space-y-2">
            {auth?.errored && (
              <div className="rounded-md bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <div className="font-medium">Document not ready to sign</div>
                  <div>{auth.errorMessage ?? `Empty required fields: ${auth.blankFields.join(', ')}`}</div>
                </div>
              </div>
            )}
            {auth?.completed && (
              <div className="rounded-md bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5" /> Payment Authorization fully executed. Archived to <code>payment/</code>.
              </div>
            )}
            {auth?.exists && !auth.completed && !auth.errored && (
              <div className="rounded-md bg-sky-500/5 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
                {auth.clientSigned ? 'Client has signed — archival pending webhook.' : 'Awaiting client signature.'}
              </div>
            )}
            {!setup.allCaptured && !auth?.completed && (
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                The client must capture all required payment methods in-portal before the Payment Authorization can be generated.
              </div>
            )}
            {canManage && setup.allCaptured && !auth?.completed && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={genM.isPending}
                  onClick={() => genM.mutate()}
                  className="bg-[hsl(var(--trophi-gold))] text-black hover:brightness-95"
                >
                  {genM.isPending
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
                    : auth?.exists ? 'Regenerate Payment Authorization' : 'Generate Payment Authorization'}
                </Button>
                {auth?.exists && !auth.completed && (
                  <Button size="sm" variant="outline" onClick={() => voidM.mutate()} disabled={voidM.isPending}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Void
                  </Button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
