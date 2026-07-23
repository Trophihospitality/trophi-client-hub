import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, Clock, User as UserIcon } from 'lucide-react';
import type { OnboardingListRow } from '@/lib/onboarding.functions';

// Onboarding pipeline board — 16 sequential step columns.
// NAVIGATE-AND-VISUALIZE ONLY. Steps are gated by the engine, so no
// drag-to-change (unlike the CRM pipeline). Cards click through to detail.

interface Props {
  rows: OnboardingListRow[];
}

const STEP_COUNT = 16;

function businessHoursSince(iso: string | null): number {
  if (!iso) return 0;
  const start = new Date(iso);
  const end = new Date();
  let hours = 0;
  const cur = new Date(start);
  while (cur < end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      const next = new Date(cur.getTime() + 60 * 60 * 1000);
      const cap = next > end ? end : next;
      hours += (cap.getTime() - cur.getTime()) / (60 * 60 * 1000);
    }
    cur.setHours(cur.getHours() + 1);
  }
  return Math.round(hours);
}

function daysLabel(hrs: number) {
  const days = Math.floor(hrs / 24);
  return days >= 1 ? `${days}d ${hrs % 24}h` : `${hrs}h`;
}

export function OnboardingPipeline({ rows }: Props) {
  const navigate = useNavigate();

  const byStep = useMemo(() => {
    const map = new Map<number, OnboardingListRow[]>();
    for (let i = 1; i <= STEP_COUNT; i++) map.set(i, []);
    rows.forEach((r) => {
      const list = map.get(r.currentStep);
      if (list) list.push(r);
    });
    return map;
  }, [rows]);

  // Derive step names from the first row that touches each step; fall back to number.
  const stepNames = useMemo(() => {
    const names = new Map<number, string>();
    rows.forEach((r) => {
      if (!names.has(r.currentStep)) names.set(r.currentStep, r.currentStepName);
    });
    return names;
  }, [rows]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
      {Array.from({ length: STEP_COUNT }, (_, i) => i + 1).map((step) => {
        const col = byStep.get(step) ?? [];
        return (
          <div key={step} className="flex w-64 shrink-0 flex-col rounded-xl border bg-secondary/40">
            <div className="px-3 pt-3 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-muted-foreground">Step {step}</span>
                <span className="text-xs text-muted-foreground">{col.length}</span>
              </div>
              <div className="mt-0.5 text-sm font-medium leading-tight">
                {stepNames.get(step) ?? '—'}
              </div>
            </div>
            <div className="flex-1 space-y-2 px-2 pb-2 min-h-[80px]">
              {col.map((r) => {
                const hrs = businessHoursSince(r.currentStepStartedAt);
                const threshold =
                  r.waitingOn === 'client' ? 48 : r.waitingOn === 'trophi' ? 24 : Infinity;
                const overdue = hrs >= threshold;
                const clickable = !r.incoming;
                return (
                  <div
                    key={r.businessId}
                    onClick={() =>
                      clickable &&
                      navigate({
                        to: '/onboarding/$businessId',
                        params: { businessId: r.businessId },
                      })
                    }
                    className={`rounded-lg border bg-card p-3 shadow-sm transition-shadow ${
                      clickable ? 'cursor-pointer hover:shadow-md' : 'opacity-70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium leading-tight">{r.company}</span>
                      {overdue && (
                        <span title={`In step ${daysLabel(hrs)} — over ${threshold}h`}>
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--status-restrictions))]" />
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {r.businessId}
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {r.currentStepStartedAt ? daysLabel(hrs) : '—'}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.specialistName && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                          <UserIcon className="h-2.5 w-2.5" />
                          {r.specialistName.split(' ')[0]}
                        </span>
                      )}
                      {r.accountManagerName && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                          <UserIcon className="h-2.5 w-2.5" />
                          {r.accountManagerName.split(' ')[0]}
                        </span>
                      )}
                      {!r.specialistName && !r.accountManagerName && (
                        <span className="text-[10px] text-muted-foreground">Unassigned</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
