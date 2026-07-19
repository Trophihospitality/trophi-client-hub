import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Send, Clock, AlertTriangle } from 'lucide-react';
import { listOnboardingFn, type OnboardingListRow } from '@/lib/onboarding.functions';

function money(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function businessHoursSince(iso: string | null): number {
  if (!iso) return 0;
  const start = new Date(iso);
  const end = new Date();
  let hours = 0;
  const cur = new Date(start);
  while (cur < end) {
    const day = cur.getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) {
      const nextHour = new Date(cur.getTime() + 60 * 60 * 1000);
      const cap = nextHour > end ? end : nextHour;
      hours += (cap.getTime() - cur.getTime()) / (60 * 60 * 1000);
    }
    cur.setHours(cur.getHours() + 1);
  }
  return Math.round(hours);
}

function StepChip({ row }: { row: OnboardingListRow }) {
  const actor = row.currentStepActor;
  const cls =
    actor === 'system'
      ? 'bg-muted text-muted-foreground'
      : actor === 'client'
      ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
      : 'bg-[hsl(var(--trophi-gold))]/15 text-[hsl(var(--trophi-gold))]';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      Step {row.currentStep} of 16: {row.currentStepName}
    </span>
  );
}

function ElapsedBadge({ started, waitingOn }: { started: string | null; waitingOn: string }) {
  if (!started) return <span className="text-xs text-muted-foreground">—</span>;
  const hrs = businessHoursSince(started);
  const threshold = waitingOn === 'client' ? 48 : waitingOn === 'trophi' ? 24 : Infinity;
  const overdue = hrs >= threshold;
  const days = Math.floor(hrs / 24);
  const label = days >= 1 ? `${days}d ${hrs % 24}h` : `${hrs}h`;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${overdue ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
      {overdue && <AlertTriangle className="h-3 w-3" />}
      <Clock className="h-3 w-3" />
      {label}
    </span>
  );
}

type Filter = 'all' | 'client' | 'trophi' | 'overdue' | 'incoming';

export default function Onboarding() {
  const navigate = useNavigate();
  const listFn = useServerFn(listOnboardingFn);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['onboarding-list'],
    queryFn: () => listFn(),
  });
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === 'client') return r.waitingOn === 'client';
      if (filter === 'trophi') return r.waitingOn === 'trophi';
      if (filter === 'incoming') return r.incoming;
      if (filter === 'overdue') {
        const hrs = businessHoursSince(r.currentStepStartedAt);
        const threshold = r.waitingOn === 'client' ? 48 : r.waitingOn === 'trophi' ? 24 : Infinity;
        return hrs >= threshold;
      }
      return true;
    });
  }, [rows, filter]);

  const hasIncoming = rows.some((r) => r.incoming);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Onboarding</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Approved clients arrive here automatically. Sixteen-step workflow across sales, specialists, and account managers.
        </p>
      </div>
      <div className="gold-rule w-24" />

      <div className="flex flex-wrap gap-2">
        {([
          ['all', 'All'],
          ['client', 'Waiting on client'],
          ['trophi', 'Waiting on Trophi'],
          ['overdue', 'Overdue'],
          ...(hasIncoming ? [['incoming', 'Incoming (specialist preview)']] as const : []),
        ] as const).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setFilter(v as Filter)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === v
                ? 'border-[hsl(var(--trophi-gold))] bg-[hsl(var(--trophi-gold))]/10 text-[hsl(var(--trophi-gold))]'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-20 text-center">
          <Send className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            No onboardings match this filter. Set a client's journey status to Approved in the CRM to start onboarding.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Brands</th>
                <th className="px-4 py-3 text-center">Loc.</th>
                <th className="px-4 py-3">Current Step</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">In step</th>
                <th className="px-4 py-3">Point of contact</th>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3 text-right">$/loc/mo</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Specialist</th>
                <th className="px-4 py-3">Acct Mgr</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr
                  key={r.businessId}
                  onClick={() => !r.incoming && navigate({ to: '/onboarding/$businessId', params: { businessId: r.businessId } })}
                  className={`transition-colors ${r.incoming ? 'opacity-70' : 'cursor-pointer hover:bg-muted/20'}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.company}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.businessId}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.brands.join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-center">{r.activeLocations}</td>
                  <td className="px-4 py-3"><StepChip row={r} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(r.startedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs">{formatDate(r.currentStepStartedAt)}</div>
                    <ElapsedBadge started={r.currentStepStartedAt} waitingOn={r.waitingOn} />
                  </td>
                  <td className="px-4 py-3">
                    <div>{r.contactName || '—'}</div>
                    <div className="text-xs text-muted-foreground">{r.contactEmail}</div>
                  </td>
                  <td className="px-4 py-3">{r.packageType}</td>
                  <td className="px-4 py-3 text-right">{money(r.budget)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.salesPersonName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.specialistName ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.accountManagerName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
