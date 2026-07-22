import { useMemo, useState } from 'react';
import { Award as AwardIcon, Download, Trophy } from 'lucide-react';
import { downloadCsv } from '@/lib/csv';
import type { LeaderboardData, Award } from '@/lib/awards.functions';
import type {
  ReportClient,
  ReportPerson,
  ReportStatusHistory,
  ReportOnboardingRecord,
  ReportStepProgress,
  ReportStepDefinition,
} from '@/lib/reports.functions';
import { JOURNEY_STATUSES } from '@/lib/statusConfig';

// ============================================================
// LEADERBOARDS (shared between admin Reports and rep-visible /leaderboards).
// Ranked tables + team aggregation view + top-3 medal styling.
// ============================================================

export interface LbFilters { from: string; to: string; team: string; role: string; }

const PRE_APPROVED = new Set(JOURNEY_STATUSES.filter((s) => s !== 'Approved' && s !== 'Signed'));

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function pct(num: number, den: number): number {
  if (!den) return 0;
  return (num / den) * 100;
}
function fmtPct(num: number, den: number): string {
  if (!den) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}
function fmtDays(n: number | null): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return `${n.toFixed(1)}d`;
}
function mean(arr: number[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

// ============================================================
// CRM Leaderboard
// ============================================================

export interface CrmLbRow {
  key: string;
  name: string;
  team: string | null;
  role: string;
  personId?: string;
  signedValue: number;
  signedCount: number;
  approvedValue: number;
  approvedCount: number;
  leadCount: number;
  approvalRate: number;
  signedRate: number;
  conversionRate: number;
  avgApprovedToSigned: number | null;
}

type CrmSortKey = keyof Omit<CrmLbRow, 'key' | 'name' | 'team' | 'role' | 'personId'>;

function buildCrmRows(
  data: LeaderboardData,
  filters: LbFilters,
  mode: 'person' | 'team',
): CrmLbRow[] {
  const fromMs = new Date(filters.from).getTime();
  const toMs = new Date(filters.to).getTime() + 86400000 - 1;
  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= fromMs && t <= toMs;
  };
  const clientsByBiz = new Map(data.clients.map((c) => [c.businessId, c]));
  const peopleById = new Map(data.people.map((p) => [p.id, p]));

  const filteredPeople = data.people.filter((p) => {
    if (p.role === 'client_admin') return false;
    if (filters.team && (p.team ?? '') !== filters.team) return false;
    if (filters.role && p.role !== filters.role) return false;
    return true;
  });
  const filteredIds = new Set(filteredPeople.map((p) => p.id));

  // Accumulate per person
  interface Acc { leads: Set<string>; approved: Set<string>; signed: Set<string>; a2sDays: number[]; }
  const perPerson = new Map<string, Acc>();
  const ensure = (id: string): Acc => {
    let a = perPerson.get(id);
    if (!a) { a = { leads: new Set(), approved: new Set(), signed: new Set(), a2sDays: [] }; perPerson.set(id, a); }
    return a;
  };

  for (const h of data.statusHistory) {
    const c = clientsByBiz.get(h.businessId);
    if (!c || !filteredIds.has(c.salesPersonId)) continue;
    if (!inRange(h.changedAt)) continue;
    const acc = ensure(c.salesPersonId);
    if (PRE_APPROVED.has(h.toStatus as any)) acc.leads.add(h.businessId);
    else if (h.toStatus === 'Approved') acc.approved.add(h.businessId);
    else if (h.toStatus === 'Signed') acc.signed.add(h.businessId);
  }
  // avg days Approved -> Signed for clients whose Signed transition happened in range
  for (const c of data.clients) {
    if (!filteredIds.has(c.salesPersonId)) continue;
    if (c.approvedAt && c.signedAt && inRange(c.signedAt)) {
      ensure(c.salesPersonId).a2sDays.push(Math.max(0, daysBetween(c.approvedAt, c.signedAt)));
    }
  }

  const bucketValue = (biz: Set<string>) => {
    let value = 0;
    for (const id of biz) {
      const c = clientsByBiz.get(id);
      if (c) value += (c.budget ?? 0) * c.activeLocations;
    }
    return value;
  };

  const personRows: CrmLbRow[] = filteredPeople.map((p) => {
    const a = perPerson.get(p.id) ?? { leads: new Set<string>(), approved: new Set<string>(), signed: new Set<string>(), a2sDays: [] };
    const signedValue = bucketValue(a.signed);
    const approvedValue = bucketValue(a.approved);
    return {
      key: p.id,
      personId: p.id,
      name: p.name,
      team: p.team,
      role: p.role,
      signedValue,
      signedCount: a.signed.size,
      approvedValue,
      approvedCount: a.approved.size,
      leadCount: a.leads.size,
      approvalRate: pct(a.approved.size, a.leads.size),
      signedRate: pct(a.signed.size, a.approved.size),
      conversionRate: pct(a.signed.size, a.leads.size),
      avgApprovedToSigned: mean(a.a2sDays),
    };
  });

  if (mode === 'person') return personRows;

  // Team aggregation
  const teamMap = new Map<string, CrmLbRow>();
  for (const r of personRows) {
    const key = r.team ?? '__unassigned__';
    let t = teamMap.get(key);
    if (!t) {
      t = { key, name: r.team ?? 'Unassigned', team: r.team, role: '', signedValue: 0, signedCount: 0, approvedValue: 0, approvedCount: 0, leadCount: 0, approvalRate: 0, signedRate: 0, conversionRate: 0, avgApprovedToSigned: null };
      teamMap.set(key, t);
    }
    t.signedValue += r.signedValue;
    t.signedCount += r.signedCount;
    t.approvedValue += r.approvedValue;
    t.approvedCount += r.approvedCount;
    t.leadCount += r.leadCount;
  }
  // Recompute rates and avg on team level from raw counts (approx)
  const teamRows = Array.from(teamMap.values()).map((t) => ({
    ...t,
    approvalRate: pct(t.approvedCount, t.leadCount),
    signedRate: pct(t.signedCount, t.approvedCount),
    conversionRate: pct(t.signedCount, t.leadCount),
  }));
  // Team-level avg days by pooling all person a2sDays
  const teamDays = new Map<string, number[]>();
  for (const p of filteredPeople) {
    const acc = perPerson.get(p.id);
    if (!acc) continue;
    const key = p.team ?? '__unassigned__';
    const arr = teamDays.get(key) ?? [];
    arr.push(...acc.a2sDays);
    teamDays.set(key, arr);
  }
  for (const t of teamRows) t.avgApprovedToSigned = mean(teamDays.get(t.key) ?? []);
  return teamRows;
}

function rankRows<T extends Record<string, any>>(rows: T[], key: keyof T, dir: 'asc' | 'desc'): T[] {
  return [...rows].sort((a, b) => {
    const av = a[key] ?? -Infinity;
    const bv = b[key] ?? -Infinity;
    if (av === bv) return 0;
    return (av < bv ? -1 : 1) * (dir === 'asc' ? 1 : -1);
  });
}

function medalStyle(rank: number): string {
  if (rank === 1) return 'bg-[hsl(var(--trophi-gold))]/15 text-[hsl(var(--trophi-gold))] font-semibold';
  if (rank === 2) return 'bg-slate-300/40 text-slate-800 font-semibold dark:bg-slate-500/20 dark:text-slate-200';
  if (rank === 3) return 'bg-amber-700/15 text-amber-800 font-semibold dark:text-amber-300';
  return '';
}

const CRM_COLUMNS: { key: CrmSortKey; label: string; format: (r: CrmLbRow) => string; align?: string }[] = [
  { key: 'signedValue', label: 'Signed $', format: (r) => money(r.signedValue), align: 'text-right' },
  { key: 'signedCount', label: 'Signed #', format: (r) => String(r.signedCount), align: 'text-right' },
  { key: 'approvedValue', label: 'Approved $', format: (r) => money(r.approvedValue), align: 'text-right' },
  { key: 'approvedCount', label: 'Approved #', format: (r) => String(r.approvedCount), align: 'text-right' },
  { key: 'leadCount', label: 'Leads #', format: (r) => String(r.leadCount), align: 'text-right' },
  { key: 'approvalRate', label: 'Approval %', format: (r) => fmtPct(r.approvedCount, r.leadCount), align: 'text-right' },
  { key: 'signedRate', label: 'Signed %', format: (r) => fmtPct(r.signedCount, r.approvedCount), align: 'text-right' },
  { key: 'conversionRate', label: 'Conversion %', format: (r) => fmtPct(r.signedCount, r.leadCount), align: 'text-right' },
  { key: 'avgApprovedToSigned', label: 'Avg A→S days', format: (r) => fmtDays(r.avgApprovedToSigned), align: 'text-right' },
];

export function CrmLeaderboard({
  data, filters, showExport, canGrantAward, onGrantAward, awardsIndex,
}: {
  data: LeaderboardData;
  filters: LbFilters;
  showExport?: boolean;
  canGrantAward?: boolean;
  onGrantAward?: (row: CrmLbRow, metricKey: CrmSortKey, metricValue: number) => void;
  awardsIndex?: Map<string, Award[]>;
}) {
  const [mode, setMode] = useState<'person' | 'team'>('person');
  const [sortKey, setSortKey] = useState<CrmSortKey>('signedValue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const rows = useMemo(() => buildCrmRows(data, filters, mode), [data, filters, mode]);
  const ranked = useMemo(() => rankRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);

  const toggleSort = (k: CrmSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  };

  const exportCsv = () => {
    const header = ['Rank', mode === 'team' ? 'Team' : 'Person', 'Team', 'Signed $', 'Signed #', 'Approved $', 'Approved #', 'Leads #', 'Approval %', 'Signed %', 'Conversion %', 'Avg A→S days'];
    const out = ranked.map((r, i) => [
      i + 1, r.name, r.team ?? '',
      r.signedValue, r.signedCount, r.approvedValue, r.approvedCount, r.leadCount,
      fmtPct(r.approvedCount, r.leadCount), fmtPct(r.signedCount, r.approvedCount), fmtPct(r.signedCount, r.leadCount),
      r.avgApprovedToSigned !== null ? r.avgApprovedToSigned.toFixed(1) : '',
    ]);
    downloadCsv(`crm-leaderboard-${mode}.csv`, [header, ...out].map((r) => r.join(',')).join('\n'));
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold">CRM Leaderboard</h2>
          <p className="text-[11px] text-muted-foreground">Ranked by <b>{CRM_COLUMNS.find((c) => c.key === sortKey)?.label}</b> · click any column to re-rank</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
            {(['person','team'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1 ${mode === m ? 'bg-[hsl(var(--trophi-gold))]/15 text-[hsl(var(--trophi-gold))] font-medium' : 'text-muted-foreground hover:bg-muted'}`}>
                {m === 'person' ? 'People' : 'Teams'}
              </button>
            ))}
          </div>
          {showExport && (
            <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">
              <Download className="h-3 w-3" /> CSV
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-left uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-2 w-10 text-center">#</th>
              <th className="px-2 py-2">{mode === 'team' ? 'Team' : 'Person'}</th>
              {mode === 'person' && <th className="px-2 py-2">Team</th>}
              {CRM_COLUMNS.map((c) => (
                <th key={c.key} className={`px-2 py-2 ${c.align ?? ''} cursor-pointer select-none hover:text-foreground ${sortKey === c.key ? 'text-foreground' : ''}`}
                    onClick={() => toggleSort(c.key)}>
                  {c.label}{sortKey === c.key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
              {canGrantAward && mode === 'person' && <th className="px-2 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ranked.length === 0 && (
              <tr><td colSpan={12} className="px-2 py-6 text-center text-muted-foreground">No data for these filters.</td></tr>
            )}
            {ranked.map((r, i) => {
              const rank = i + 1;
              const holdsAward = mode === 'person' && r.personId && awardsIndex?.has(r.personId);
              return (
                <tr key={r.key} className={medalStyle(rank)}>
                  <td className="px-2 py-2 text-center">{rank}</td>
                  <td className="px-2 py-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {r.name}
                      {holdsAward && (
                        <span title={awardsIndex!.get(r.personId!)!.map((a) => `${a.name} · ${a.period}`).join('\n')}>
                          <Trophy className="h-3.5 w-3.5 text-[hsl(var(--trophi-gold))]" />
                        </span>
                      )}
                    </span>
                  </td>
                  {mode === 'person' && <td className="px-2 py-2 text-muted-foreground">{r.team ?? '—'}</td>}
                  {CRM_COLUMNS.map((c) => (
                    <td key={c.key} className={`px-2 py-2 ${c.align ?? ''}`}>{c.format(r)}</td>
                  ))}
                  {canGrantAward && mode === 'person' && (
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => {
                        const col = CRM_COLUMNS.find((c) => c.key === sortKey)!;
                        const val = Number(r[sortKey] ?? 0);
                        onGrantAward?.(r, sortKey, val);
                      }}
                        className="inline-flex items-center gap-1 rounded-md border border-[hsl(var(--trophi-gold))]/40 px-2 py-0.5 text-[11px] text-[hsl(var(--trophi-gold))] hover:bg-[hsl(var(--trophi-gold))]/10">
                        <AwardIcon className="h-3 w-3" /> Grant
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Onboarding Leaderboard
// ============================================================

export interface OnbLbRow {
  key: string;
  name: string;
  team: string | null;
  role: string;
  personId?: string;
  goLives: number;
  goLiveLocations: number;
  currentActive: number;
  avgTotalDays: number | null;
  avgOwnedStepDays: number | null;
  fastestDays: number | null;
  slowestDays: number | null;
}

type OnbSortKey = keyof Omit<OnbLbRow, 'key' | 'name' | 'team' | 'role' | 'personId'>;

const ONB_COLUMNS: { key: OnbSortKey; label: string; format: (r: OnbLbRow) => string; align?: string; speedMetric?: boolean }[] = [
  { key: 'goLives', label: 'Go-Lives', format: (r) => String(r.goLives), align: 'text-right' },
  { key: 'goLiveLocations', label: 'Locations', format: (r) => String(r.goLiveLocations), align: 'text-right' },
  { key: 'currentActive', label: 'Active', format: (r) => String(r.currentActive), align: 'text-right' },
  { key: 'avgTotalDays', label: 'Avg total days', format: (r) => fmtDays(r.avgTotalDays), align: 'text-right', speedMetric: true },
  { key: 'avgOwnedStepDays', label: 'Avg owned step', format: (r) => fmtDays(r.avgOwnedStepDays), align: 'text-right', speedMetric: true },
  { key: 'fastestDays', label: 'Fastest', format: (r) => fmtDays(r.fastestDays), align: 'text-right' },
  { key: 'slowestDays', label: 'Slowest', format: (r) => fmtDays(r.slowestDays), align: 'text-right' },
];

function buildOnbRows(data: LeaderboardData, filters: LbFilters, mode: 'person' | 'team'): OnbLbRow[] {
  const fromMs = new Date(filters.from).getTime();
  const toMs = new Date(filters.to).getTime() + 86400000 - 1;
  const inRange = (iso: string | null | undefined) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= fromMs && t <= toMs;
  };
  const clientsByBiz = new Map(data.clients.map((c) => [c.businessId, c]));
  const recordsByBiz = new Map(data.onboardingRecords.map((r) => [r.businessId, r]));
  const defByStep = new Map(data.stepDefinitions.map((d) => [d.stepNumber, d]));

  const filteredPeople = data.people.filter((p) => {
    if (p.role === 'client_admin') return false;
    if (filters.team && (p.team ?? '') !== filters.team) return false;
    if (filters.role && p.role !== filters.role) return false;
    return true;
  });

  const touchedByPerson = new Map<string, Set<string>>();
  const addTouched = (uid: string | null, biz: string) => {
    if (!uid) return;
    if (!touchedByPerson.has(uid)) touchedByPerson.set(uid, new Set());
    touchedByPerson.get(uid)!.add(biz);
  };
  data.onboardingRecords.forEach((r) => {
    addTouched(r.specialistId, r.businessId);
    addTouched(r.accountManagerId, r.businessId);
    const c = clientsByBiz.get(r.businessId);
    if (c) addTouched(c.salesPersonId, r.businessId);
  });

  const stepDurationsByBiz = new Map<string, { step: number; days: number; completedAt: string }[]>();
  data.stepProgress.forEach((s) => {
    if (s.status !== 'complete' || !s.startedAt || !s.completedAt) return;
    const arr = stepDurationsByBiz.get(s.businessId) ?? [];
    arr.push({ step: s.stepNumber, days: daysBetween(s.startedAt, s.completedAt), completedAt: s.completedAt });
    stepDurationsByBiz.set(s.businessId, arr);
  });

  const totalDurationByBiz = new Map<string, number>();
  data.clients.forEach((c) => {
    const rec = recordsByBiz.get(c.businessId);
    if (c.approvedAt && rec?.wentLiveAt) {
      totalDurationByBiz.set(c.businessId, daysBetween(c.approvedAt, rec.wentLiveAt));
    }
  });

  const personRows: OnbLbRow[] = filteredPeople.map((p) => {
    const touched = touchedByPerson.get(p.id) ?? new Set<string>();
    const goLiveBizzes = Array.from(touched).filter((biz) => {
      const rec = recordsByBiz.get(biz);
      return rec?.wentLiveAt && inRange(rec.wentLiveAt);
    });
    const goLiveLocations = goLiveBizzes.reduce((s, biz) => s + (clientsByBiz.get(biz)?.activeLocations ?? 0), 0);
    const currentlyActive = Array.from(touched).filter((biz) => recordsByBiz.get(biz)?.status === 'active').length;

    const ownedStepDays: number[] = [];
    for (const biz of touched) {
      for (const d of stepDurationsByBiz.get(biz) ?? []) {
        const def = defByStep.get(d.step);
        if (!def) continue;
        const owns =
          (def.actor === 'account_owner' && clientsByBiz.get(biz)?.salesPersonId === p.id)
          || (def.actor === 'specialist' && recordsByBiz.get(biz)?.specialistId === p.id)
          || (def.actor === 'account_manager' && recordsByBiz.get(biz)?.accountManagerId === p.id);
        if (owns) ownedStepDays.push(d.days);
      }
    }
    const totals = goLiveBizzes.map((biz) => totalDurationByBiz.get(biz)).filter((v): v is number => typeof v === 'number');
    return {
      key: p.id, personId: p.id, name: p.name, team: p.team, role: p.role,
      goLives: goLiveBizzes.length,
      goLiveLocations,
      currentActive: currentlyActive,
      avgTotalDays: mean(totals),
      avgOwnedStepDays: mean(ownedStepDays),
      fastestDays: totals.length ? Math.min(...totals) : null,
      slowestDays: totals.length ? Math.max(...totals) : null,
    };
  });

  if (mode === 'person') return personRows;

  const teamMap = new Map<string, OnbLbRow & { _totals: number[]; _steps: number[] }>();
  for (const r of personRows) {
    const key = r.team ?? '__unassigned__';
    let t = teamMap.get(key);
    if (!t) {
      t = { key, name: r.team ?? 'Unassigned', team: r.team, role: '',
        goLives: 0, goLiveLocations: 0, currentActive: 0,
        avgTotalDays: null, avgOwnedStepDays: null, fastestDays: null, slowestDays: null,
        _totals: [], _steps: [] };
      teamMap.set(key, t);
    }
    t.goLives += r.goLives;
    t.goLiveLocations += r.goLiveLocations;
    t.currentActive += r.currentActive;
    if (r.fastestDays !== null) t._totals.push(r.fastestDays, r.slowestDays ?? r.fastestDays);
    if (r.avgTotalDays !== null) t._totals.push(r.avgTotalDays);
    if (r.avgOwnedStepDays !== null) t._steps.push(r.avgOwnedStepDays);
  }
  return Array.from(teamMap.values()).map((t) => ({
    key: t.key, name: t.name, team: t.team, role: t.role,
    goLives: t.goLives, goLiveLocations: t.goLiveLocations, currentActive: t.currentActive,
    avgTotalDays: mean(t._totals),
    avgOwnedStepDays: mean(t._steps),
    fastestDays: t._totals.length ? Math.min(...t._totals) : null,
    slowestDays: t._totals.length ? Math.max(...t._totals) : null,
  }));
}

export function OnboardingLeaderboard({
  data, filters, showExport, canGrantAward, onGrantAward, awardsIndex,
}: {
  data: LeaderboardData;
  filters: LbFilters;
  showExport?: boolean;
  canGrantAward?: boolean;
  onGrantAward?: (row: OnbLbRow, metricKey: OnbSortKey, metricValue: number) => void;
  awardsIndex?: Map<string, Award[]>;
}) {
  const [mode, setMode] = useState<'person' | 'team'>('person');
  const [sortKey, setSortKey] = useState<OnbSortKey>('goLives');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const rows = useMemo(() => buildOnbRows(data, filters, mode), [data, filters, mode]);
  const ranked = useMemo(() => rankRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);
  const speedMetric = ONB_COLUMNS.find((c) => c.key === sortKey)?.speedMetric ?? false;

  const toggleSort = (k: OnbSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'avgTotalDays' || k === 'avgOwnedStepDays' ? 'asc' : 'desc'); }
  };

  const exportCsv = () => {
    const header = ['Rank', mode === 'team' ? 'Team' : 'Person', 'Team', 'Go-Lives', 'Locations', 'Active', 'Avg total days', 'Avg owned step days', 'Fastest', 'Slowest'];
    const out = ranked.map((r, i) => [
      i + 1, r.name, r.team ?? '',
      r.goLives, r.goLiveLocations, r.currentActive,
      r.avgTotalDays !== null ? r.avgTotalDays.toFixed(1) : '',
      r.avgOwnedStepDays !== null ? r.avgOwnedStepDays.toFixed(1) : '',
      r.fastestDays !== null ? r.fastestDays.toFixed(1) : '',
      r.slowestDays !== null ? r.slowestDays.toFixed(1) : '',
    ]);
    downloadCsv(`onboarding-leaderboard-${mode}.csv`, [header, ...out].map((r) => r.join(',')).join('\n'));
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold">Onboarding Leaderboard</h2>
          <p className="text-[11px] text-muted-foreground">Ranked by <b>{ONB_COLUMNS.find((c) => c.key === sortKey)?.label}</b> · click any column to re-rank</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
            {(['person','team'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1 ${mode === m ? 'bg-[hsl(var(--trophi-gold))]/15 text-[hsl(var(--trophi-gold))] font-medium' : 'text-muted-foreground hover:bg-muted'}`}>
                {m === 'person' ? 'People' : 'Teams'}
              </button>
            ))}
          </div>
          {showExport && (
            <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">
              <Download className="h-3 w-3" /> CSV
            </button>
          )}
        </div>
      </div>
      {speedMetric && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
          Speed rankings should be read alongside quality — see fastest/slowest range.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-left uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-2 w-10 text-center">#</th>
              <th className="px-2 py-2">{mode === 'team' ? 'Team' : 'Person'}</th>
              {mode === 'person' && <th className="px-2 py-2">Team</th>}
              {mode === 'person' && <th className="px-2 py-2">Role</th>}
              {ONB_COLUMNS.map((c) => (
                <th key={c.key} className={`px-2 py-2 ${c.align ?? ''} cursor-pointer select-none hover:text-foreground ${sortKey === c.key ? 'text-foreground' : ''}`}
                    onClick={() => toggleSort(c.key)}>
                  {c.label}{sortKey === c.key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
              {canGrantAward && mode === 'person' && <th className="px-2 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ranked.length === 0 && (
              <tr><td colSpan={12} className="px-2 py-6 text-center text-muted-foreground">No data for these filters.</td></tr>
            )}
            {ranked.map((r, i) => {
              const rank = i + 1;
              const holdsAward = mode === 'person' && r.personId && awardsIndex?.has(r.personId);
              return (
                <tr key={r.key} className={medalStyle(rank)}>
                  <td className="px-2 py-2 text-center">{rank}</td>
                  <td className="px-2 py-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {r.name}
                      {holdsAward && (
                        <span title={awardsIndex!.get(r.personId!)!.map((a) => `${a.name} · ${a.period}`).join('\n')}>
                          <Trophy className="h-3.5 w-3.5 text-[hsl(var(--trophi-gold))]" />
                        </span>
                      )}
                    </span>
                  </td>
                  {mode === 'person' && <td className="px-2 py-2 text-muted-foreground">{r.team ?? '—'}</td>}
                  {mode === 'person' && <td className="px-2 py-2 text-muted-foreground">{r.role}</td>}
                  {ONB_COLUMNS.map((c) => (
                    <td key={c.key} className={`px-2 py-2 ${c.align ?? ''}`}>{c.format(r)}</td>
                  ))}
                  {canGrantAward && mode === 'person' && (
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => {
                        const val = Number(r[sortKey] ?? 0);
                        onGrantAward?.(r, sortKey, val);
                      }}
                        className="inline-flex items-center gap-1 rounded-md border border-[hsl(var(--trophi-gold))]/40 px-2 py-0.5 text-[11px] text-[hsl(var(--trophi-gold))] hover:bg-[hsl(var(--trophi-gold))]/10">
                        <AwardIcon className="h-3 w-3" /> Grant
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Awards strip + helpers
// ============================================================

export function currentAndPreviousPeriods(now: Date = new Date()): string[] {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const q = Math.floor((m - 1) / 3) + 1;
  const prevMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const prevQuarter = q === 1 ? { y: y - 1, q: 4 } : { y, q: q - 1 };
  return [
    `${y}-${String(m).padStart(2, '0')}`,
    `${prevMonth.y}-${String(prevMonth.m).padStart(2, '0')}`,
    `${y}-Q${q}`,
    `${prevQuarter.y}-Q${prevQuarter.q}`,
    `${y}`,
    `${y - 1}`,
  ];
}

export function indexAwardsByRecipient(awards: Award[], periods: string[]): Map<string, Award[]> {
  const setP = new Set(periods);
  const map = new Map<string, Award[]>();
  for (const a of awards) {
    if (!setP.has(a.period)) continue;
    const arr = map.get(a.recipientUserId) ?? [];
    arr.push(a);
    map.set(a.recipientUserId, arr);
  }
  return map;
}

export function RecentAwardsStrip({ awards, people, limit = 6 }: { awards: Award[]; people: ReportPerson[]; limit?: number }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const list = awards.slice(0, limit);
  if (!list.length) return null;
  return (
    <div className="rounded-xl border border-[hsl(var(--trophi-gold))]/30 bg-gradient-to-r from-[hsl(var(--trophi-gold))]/8 to-transparent p-4">
      <div className="mb-3 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-[hsl(var(--trophi-gold))]" />
        <h3 className="font-display text-sm font-semibold text-gold-gradient">Recent Awards</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        {list.map((a) => {
          const p = byId.get(a.recipientUserId);
          return (
            <div key={a.id} className="rounded-lg border border-[hsl(var(--trophi-gold))]/30 bg-card px-3 py-2 shadow-sm">
              <div className="text-xs font-semibold text-[hsl(var(--trophi-gold))]">{a.name}</div>
              <div className="text-sm font-medium">{p?.name ?? 'Unknown'}</div>
              <div className="text-[11px] text-muted-foreground">{a.period}{a.metricLabel ? ` · ${a.metricLabel}` : ''}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Re-export types for convenience
export type { LeaderboardData, Award };
export type { CrmSortKey, OnbSortKey };
