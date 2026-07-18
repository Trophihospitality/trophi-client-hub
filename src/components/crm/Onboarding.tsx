import { useNavigate } from '@tanstack/react-router';
import { Send } from 'lucide-react';
import { useCrm } from '@/store/crmStore';
import { SALES_TEAM } from '@/data/seedData';

// ============================================================
// ONBOARDING — receiving queue (placeholder)
// Clients land here automatically when their CRM journey status
// is set to "Approved". The full onboarding workflow is the next
// module to be built.
// ============================================================

export default function Onboarding() {
  const { clients } = useCrm();
  const navigate = useNavigate();
  const queue = clients
    .filter((c) => c.sentToOnboarding)
    .sort((a, b) => (b.onboardingSentAt ?? '').localeCompare(a.onboardingSentAt ?? ''));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Onboarding</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Approved clients arrive here automatically from the CRM.
        </p>
      </div>
      <div className="gold-rule w-24" />

      {queue.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-20 text-center">
          <Send className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            No clients in onboarding yet. Set a client's journey status to
            <span className="font-medium text-[hsl(var(--status-approved))]"> Approved </span>
            in the CRM to start their onboarding.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {queue.map((c) => {
            const owner = SALES_TEAM.find((sp) => sp.id === c.salesPersonId);
            return (
              <button
                key={c.businessId}
                onClick={() => navigate({ to: '/crm/$businessId', params: { businessId: c.businessId } })}
                className="rounded-xl border bg-card p-5 text-left transition-colors hover:border-[hsl(var(--trophi-gold))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{c.businessId}</span>
                  <span className="rounded-full bg-[hsl(var(--status-approved))]/10 px-2 py-0.5 text-xs font-medium text-[hsl(var(--status-approved))]">
                    Ready to onboard
                  </span>
                </div>
                <h3 className="mt-2 font-semibold">{c.company}</h3>
                <p className="text-sm text-muted-foreground">
                  {c.clientType} · {c.locations.length} location{c.locations.length > 1 ? 's' : ''} · {c.packageType}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Sales owner: {owner?.name ?? '—'}
                  {c.onboardingSentAt && ` · Received ${new Date(c.onboardingSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
