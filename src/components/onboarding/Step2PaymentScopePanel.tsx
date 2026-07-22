import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Building2, Store, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setPaymentScopeFn } from '@/lib/onboarding.functions';

interface Props {
  businessId: string;
  activeLocations: number;
  currentScope: 'brand' | 'per_location' | null;
  scopeRecordedAt: string | null;
  canEdit: boolean;
}

export function Step2PaymentScopePanel({ businessId, activeLocations, currentScope, scopeRecordedAt, canEdit }: Props) {
  const qc = useQueryClient();
  const setScope = useServerFn(setPaymentScopeFn);
  const [pick, setPick] = useState<'brand' | 'per_location' | null>(currentScope);

  const save = useMutation({
    mutationFn: (v: 'brand' | 'per_location') => setScope({ data: { businessId, paymentScope: v } }),
    onSuccess: () => {
      toast.success('Payment scope saved');
      qc.invalidateQueries({ queryKey: ['onboarding-detail', businessId] });
      qc.invalidateQueries({ queryKey: ['payment-setup-status', businessId] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not save'),
  });

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b border-border px-4 py-3">
        <div className="text-sm font-semibold">Step 2 · Record payment scope</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Decide how payments will be captured. This drives Step 5, where the client enters their payment method(s)
          in Stripe and signs the Payment Authorization. No document is generated at this step.
        </div>
      </div>
      <div className="p-4 space-y-3">
        <ScopeOption
          selected={pick === 'brand'}
          onClick={() => canEdit && setPick('brand')}
          disabled={!canEdit}
          icon={<Building2 className="h-5 w-5" />}
          title="Brand-wide (single payment method)"
          desc="One method covers all active locations. Simplest to set up."
        />
        <ScopeOption
          selected={pick === 'per_location'}
          onClick={() => canEdit && setPick('per_location')}
          disabled={!canEdit}
          icon={<Store className="h-5 w-5" />}
          title={`Per-location (one method per active location · ${activeLocations})`}
          desc="Each location captures its own payment method. Best when locations are owned separately."
        />
        {currentScope && (
          <div className="rounded-md bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Currently set: <strong>{currentScope === 'brand' ? 'Brand-wide' : 'Per-location'}</strong>
            {scopeRecordedAt && <span className="text-muted-foreground">· recorded {new Date(scopeRecordedAt).toLocaleDateString()}</span>}
          </div>
        )}
        {canEdit && (
          <div className="flex justify-end">
            <Button
              onClick={() => pick && save.mutate(pick)}
              disabled={!pick || save.isPending || pick === currentScope}
              className="bg-[hsl(var(--trophi-gold))] text-black hover:brightness-95"
            >
              {save.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : 'Save scope'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ScopeOption({ selected, onClick, disabled, icon, title, desc }: {
  selected: boolean; onClick: () => void; disabled: boolean;
  icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        selected
          ? 'border-[hsl(var(--trophi-gold))] bg-[hsl(var(--trophi-gold))]/5'
          : 'border-border hover:border-foreground/20'
      } ${disabled ? 'opacity-70 cursor-not-allowed' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-[hsl(var(--trophi-gold))]">{icon}</div>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
        </div>
      </div>
    </button>
  );
}
