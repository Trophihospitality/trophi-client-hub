import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { CreditCard, CheckCircle2, Loader2, X, Plus } from 'lucide-react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { getPaymentSetupStatusFn, createSetupIntentFn } from '@/lib/payments.functions';
import { getPaymentAuthStatusFn, generatePaymentAuthorizationFn, createPaymentAuthSessionFn } from '@/lib/payment-auth.functions';

interface Props { businessId: string; }

// Cache per-publishable-key. Stripe.js recommends a single loadStripe call.
const stripeCache = new Map<string, Promise<Stripe | null>>();
function getStripePromise(pk: string): Promise<Stripe | null> {
  let p = stripeCache.get(pk);
  if (!p) { p = loadStripe(pk); stripeCache.set(pk, p); }
  return p;
}

interface OpenSlot {
  key: string;
  scope: 'brand' | 'location';
  locationId: string | null;
  label: string;
  clientSecret: string;
  publishableKey: string;
}

export function PaymentSetupPanel({ businessId }: Props) {
  const qc = useQueryClient();
  const getStatus = useServerFn(getPaymentSetupStatusFn);
  const getAuth = useServerFn(getPaymentAuthStatusFn);
  const createIntent = useServerFn(createSetupIntentFn);
  const generateAuth = useServerFn(generatePaymentAuthorizationFn);
  const createAuthSession = useServerFn(createPaymentAuthSessionFn);

  const [open, setOpen] = useState<OpenSlot | null>(null);
  const [authSessionUrl, setAuthSessionUrl] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['payment-setup-status', businessId],
    queryFn: () => getStatus({ data: { businessId } }),
    refetchInterval: open || authSessionUrl ? 5000 : 20000,
  });
  const { data: auth } = useQuery({
    queryKey: ['payment-auth-status', businessId],
    queryFn: () => getAuth({ data: { businessId } }),
    refetchInterval: authSessionUrl ? 5000 : 20000,
  });

  const startSlot = useMutation({
    mutationFn: async (slot: { key: string; scope: 'brand' | 'location'; locationId: string | null; label: string }) => {
      const res = await createIntent({
        data: { businessId, scope: slot.scope, locationId: slot.locationId },
      });
      return { ...slot, clientSecret: res.clientSecret, publishableKey: res.publishableKey };
    },
    onSuccess: (r) => setOpen(r),
    onError: (e: any) => toast.error(e?.message ?? 'Could not start payment capture'),
  });

  const generateM = useMutation({
    mutationFn: () => generateAuth({ data: { businessId } }),
    onSuccess: (r: any) => {
      if (r?.error) toast.error(r.error);
      else toast.success('Authorization ready to sign');
      qc.invalidateQueries({ queryKey: ['payment-auth-status', businessId] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not generate'),
  });

  const openSignSession = useMutation({
    mutationFn: () => createAuthSession({ data: { businessId } }),
    onSuccess: (r) => setAuthSessionUrl(r.sessionUrl),
    onError: (e: any) => toast.error(e?.message ?? 'Could not open signing session'),
  });

  const closeSetup = () => {
    setOpen(null);
    qc.invalidateQueries({ queryKey: ['payment-setup-status', businessId] });
  };
  const closeSign = () => {
    setAuthSessionUrl(null);
    qc.invalidateQueries({ queryKey: ['payment-auth-status', businessId] });
    qc.invalidateQueries({ queryKey: ['client-portal', businessId] });
  };

  if (isLoading) return <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</div>;
  if (!status) return null;

  if (!status.scope) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Your Trophi account owner is still setting up your payment scope. Check back shortly.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold">Capture payment method{status.total > 1 ? 's' : ''}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {status.scope === 'brand'
            ? 'Add one payment method that covers all your locations.'
            : `Add one payment method per active location (${status.total} total).`}
          {' '}Card numbers and bank details are stored by Stripe — we only see the last 4 digits.
        </div>
      </div>

      <ul className="divide-y">
        {status.slots.map((s) => {
          const label = s.scope === 'brand' ? 'Brand-wide method' : `${s.locationName ?? s.locationId}`;
          return (
            <li key={s.key} className="flex items-center justify-between px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                {s.captured
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  : <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{label}</div>
                  {s.locationId && <div className="text-[11px] font-mono text-muted-foreground">{s.locationId}</div>}
                  {s.captured && (
                    <div className="text-xs text-muted-foreground">
                      <span className="uppercase">{s.captured.methodType === 'us_bank_account' ? 'ACH' : (s.captured.brand ?? 'Card')}</span>
                      {' '}•••• {s.captured.last4}
                    </div>
                  )}
                </div>
              </div>
              {!s.captured && (
                <Button
                  size="sm"
                  disabled={startSlot.isPending}
                  onClick={() => startSlot.mutate({ key: s.key, scope: s.scope, locationId: s.locationId, label })}
                  className="bg-[hsl(var(--trophi-gold))] text-black hover:brightness-95"
                >
                  {startSlot.isPending && startSlot.variables?.key === s.key
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening…</>
                    : <><Plus className="mr-2 h-4 w-4" /> Add payment</>}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-t px-4 py-3 space-y-2">
        {auth?.errored && (
          <div className="rounded-md bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            The authorization document isn't ready. Your Trophi team has been notified — you don't need to do anything.
          </div>
        )}
        {status.allCaptured && !auth?.exists && (
          <Button
            className="w-full bg-[hsl(var(--trophi-gold))] text-black hover:brightness-95"
            disabled={generateM.isPending}
            onClick={() => generateM.mutate()}
          >
            {generateM.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing…</> : 'Continue to authorization'}
          </Button>
        )}
        {auth?.exists && !auth.completed && !auth.errored && (
          <Button
            className="w-full bg-[hsl(var(--trophi-gold))] text-black hover:brightness-95"
            disabled={openSignSession.isPending || auth.clientSigned}
            onClick={() => openSignSession.mutate()}
          >
            {auth.clientSigned
              ? <><CheckCircle2 className="mr-2 h-4 w-4" /> Signed — awaiting Trophi archival</>
              : openSignSession.isPending
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening…</>
                : 'Sign Payment Authorization'}
          </Button>
        )}
        {auth?.completed && (
          <div className="rounded-md bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Payment Authorization fully executed. Thank you!
          </div>
        )}
      </div>

      {open && (
        <Modal title={`Add payment — ${open.label}`} onClose={closeSetup}>
          <StripeSetupForm slot={open} onDone={closeSetup} />
        </Modal>
      )}
      {authSessionUrl && (
        <Modal title="Sign Payment Authorization" onClose={closeSign}>
          <iframe
            src={authSessionUrl}
            title="Payment Authorization signing"
            className="h-full w-full border-0"
            allow="clipboard-write"
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-2 md:p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <div className="text-sm font-medium">{title}</div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

function StripeSetupForm({ slot, onDone }: { slot: OpenSlot; onDone: () => void }) {
  const stripePromise = useMemo(() => getStripePromise(slot.publishableKey), [slot.publishableKey]);
  return (
    <div className="p-4">
      <Elements stripe={stripePromise} options={{ clientSecret: slot.clientSecret, appearance: { theme: 'stripe' } }}>
        <StripeInner onDone={onDone} />
      </Elements>
    </div>
  );
}

function StripeInner({ onDone }: { onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Guard against submits before Elements has mounted.
  useEffect(() => { setErr(null); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true); setErr(null);
    try {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (error) { setErr(error.message ?? 'Payment setup failed'); return; }
      if (setupIntent && (setupIntent.status === 'succeeded' || setupIntent.status === 'processing')) {
        toast.success('Payment method captured. Confirming with Stripe…');
        onDone();
      } else {
        setErr(`Unexpected status: ${setupIntent?.status ?? 'unknown'}`);
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Payment setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      {err && <div className="rounded-md bg-red-500/5 px-3 py-2 text-xs text-red-700">{err}</div>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={submitting}>Cancel</Button>
        <Button type="submit" disabled={!stripe || submitting} className="bg-[hsl(var(--trophi-gold))] text-black hover:brightness-95">
          {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : 'Save payment method'}
        </Button>
      </div>
    </form>
  );
}
