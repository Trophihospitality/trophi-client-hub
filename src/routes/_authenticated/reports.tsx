import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Download, Info, X } from 'lucide-react';
import { getReportDataFn, type ReportData } from '@/lib/reports.functions';
import { listAwardsFn, grantAwardFn, type Award } from '@/lib/awards.functions';
import { useAuth } from '@/store/userStore';
import { JOURNEY_STATUSES } from '@/lib/statusConfig';
import { downloadCsv } from '@/lib/csv';
import {
  CrmLeaderboard,
  OnboardingLeaderboard,
  RecentAwardsStrip,
  currentAndPreviousPeriods,
  indexAwardsByRecipient,
  type CrmLbRow,
  type OnbLbRow,
} from '@/components/leaderboards/Leaderboards';

export const Route = createFileRoute('/_authenticated/reports')({
  component: ReportsPage,
});

// ============================================================
// REPORTS — CRM Pipeline + Onboarding funnel/throughput
// Admin + Manager only. Read-only.
// ============================================================

type PresetKey = 'this_month' | 'last_month' | 'this_quarter' | 'ytd' | 'custom';

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function pct(num: number, den: number): string {
  if (!den) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}
function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

function presetRange(preset: PresetKey): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === 'this_month') return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (preset === 'last_month') return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  if (preset === 'this_quarter') {
    const qStart = Math.floor(m / 3) * 3;
    return { from: iso(new Date(y, qStart, 1)), to: iso(new Date(y, qStart + 3, 0)) };
  }
  if (preset === 'ytd') return { from: iso(new Date(y, 0, 1)), to: iso(now) };
  return { from: iso(new Date(y, m, 1)), to: iso(now) };
}

const PRE_APPROVED = new Set(JOURNEY_STATUSES.filter((s) => s !== 'Approved' && s !== 'Signed'));

function ReportsPage() {
  const { profile } = useAuth();
  if (profile && profile.role !== 'admin' && profile.role !== 'manager') {
    throw redirect({ to: '/crm' });
  }

  const getReports = useServerFn(getReportDataFn);
  const listAwards = useServerFn(listAwardsFn);
  const { data, isLoading } = useQuery({
    queryKey: ['reports-data'],
    queryFn: () => getReports(),
  });
  const { data: awards = [] } = useQuery({
    queryKey: ['awards'],
    queryFn: () => listAwards(),
  });

  const [preset, setPreset] = useState<PresetKey>('this_month');
  const initial = presetRange('this_month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [personId, setPersonId] = useState<string>('');
  const [team, setTeam] = useState<string>('');
  const [role, setRole] = useState<string>('');
  const [tab, setTab] = useState<'crm' | 'onboarding' | 'leaderboards'>('crm');
  const [grantSeed, setGrantSeed] = useState<GrantSeed | null>(null);

  const setPresetAndDates = (p: PresetKey) => {
    setPreset(p);
    if (p !== 'custom') {
      const r = presetRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const filters = useMemo(() => ({ from, to, personId, team, role }), [from, to, personId, team, role]);

  if (isLoading || !data) {
    return <div className="text-sm text-muted-foreground">Loading reports…</div>;
  }

  const teams = Array.from(new Set(data.people.map((p) => p.team).filter(Boolean))) as string[];
  const roles = Array.from(new Set(data.people.map((p) => p.role)));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            CRM pipeline and onboarding funnel analytics. Read-only.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          Status history before <b>{data.backfillCutoff}</b> is reconstructed from the activity timeline; timestamps and actors may be approximate.
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Date range</label>
            <select
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={preset}
              onChange={(e) => setPresetAndDates(e.target.value as PresetKey)}
            >
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="this_quarter">This quarter</option>
              <option value="ytd">Year to date</option>
              <option value="custom">Custom…</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
            <input type="date" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={from} onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
            <input type="date" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={to} onChange={(e) => { setTo(e.target.value); setPreset('custom'); }} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Person</label>
            <select className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">All people</option>
              {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Team</label>
            <select className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">All teams</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Role</label>
            <select className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">All roles</option>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        {(['crm', 'onboarding', 'leaderboards'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === k
                ? 'border-[hsl(var(--trophi-gold))] text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            {k === 'crm' ? 'CRM Pipeline' : k === 'onboarding' ? 'Onboarding' : 'Leaderboards'}
          </button>
        ))}
      </div>

      {tab === 'crm' && <CrmReport data={data} filters={filters} />}
      {tab === 'onboarding' && <OnboardingReport data={data} filters={filters} />}
      {tab === 'leaderboards' && (
        <LeaderboardsTab
          data={data}
          awards={awards}
          filters={filters}
          isAdmin={profile?.role === 'admin'}
          onGrant={setGrantSeed}
        />
      )}
      {grantSeed && (
        <GrantAwardDialog
          seed={grantSeed}
          people={data.people}
          onClose={() => setGrantSeed(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// Leaderboards tab (admin/manager Reports view)
// ============================================================

interface GrantSeed {
  personId: string;
  personName: string;
  metricKey: string;
  metricLabel: string;
  metricValue: number;
}

function LeaderboardsTab({
  data, awards, filters, isAdmin, onGrant,
}: {
  data: ReportData;
  awards: Award[];
  filters: Filters;
  isAdmin: boolean;
  onGrant: (seed: GrantSeed) => void;
}) {
  const lbData = useMemo(() => ({
    people: data.people,
    clients: data.clients,
    statusHistory: data.statusHistory,
    onboardingRecords: data.onboardingRecords,
    stepProgress: data.stepProgress,
    stepDefinitions: data.stepDefinitions,
    awards,
    viewerRole: 'admin' as const,
    backfillCutoff: data.backfillCutoff,
  }), [data, awards]);
  const lbFilters = { from: filters.from, to: filters.to, team: filters.team, role: filters.role };
  const periods = useMemo(() => currentAndPreviousPeriods(), []);
  const awardsIndex = useMemo(() => indexAwardsByRecipient(awards, periods), [awards, periods]);

  const CRM_LABELS: Record<string, string> = {
    signedValue: 'Signed $', signedCount: 'Signed #', approvedValue: 'Approved $',
    approvedCount: 'Approved #', leadCount: 'Leads #', approvalRate: 'Approval %',
    signedRate: 'Signed %', conversionRate: 'Conversion %', avgApprovedToSigned: 'Avg A→S days',
  };
  const ONB_LABELS: Record<string, string> = {
    goLives: 'Go-Lives', goLiveLocations: 'Locations', currentActive: 'Active',
    avgTotalDays: 'Avg total days', avgOwnedStepDays: 'Avg owned step', fastestDays: 'Fastest', slowestDays: 'Slowest',
  };

  return (
    <div className="space-y-6">
      <RecentAwardsStrip awards={awards} people={data.people} />
      <CrmLeaderboard
        data={lbData}
        filters={lbFilters}
        showExport
        canGrantAward={isAdmin}
        awardsIndex={awardsIndex}
        onGrantAward={(row: CrmLbRow, key, val) => onGrant({
          personId: row.personId!, personName: row.name,
          metricKey: `crm.${String(key)}`, metricLabel: CRM_LABELS[String(key)] ?? String(key),
          metricValue: val,
        })}
      />
      <OnboardingLeaderboard
        data={lbData}
        filters={lbFilters}
        showExport
        canGrantAward={isAdmin}
        awardsIndex={awardsIndex}
        onGrantAward={(row: OnbLbRow, key, val) => onGrant({
          personId: row.personId!, personName: row.name,
          metricKey: `onb.${String(key)}`, metricLabel: ONB_LABELS[String(key)] ?? String(key),
          metricValue: val,
        })}
      />
    </div>
  );
}

// ============================================================
// Grant Award dialog (admin only)
// ============================================================

function GrantAwardDialog({
  seed, people, onClose,
}: {
  seed: GrantSeed;
  people: ReportData['people'];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const grantFn = useServerFn(grantAwardFn);
  const [name, setName] = useState('');
  const [periodType, setPeriodType] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');
  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [period, setPeriod] = useState(defaultPeriod);
  const [recipientId, setRecipientId] = useState(seed.personId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Award name required'); return; }
    setSaving(true); setError(null);
    try {
      await grantFn({ data: {
        name: name.trim(), periodType, period: period.trim(), recipientUserId: recipientId,
        metricKey: seed.metricKey, metricLabel: seed.metricLabel, metricValue: seed.metricValue,
      } });
      await qc.invalidateQueries({ queryKey: ['awards'] });
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to grant award');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold">Grant award</h3>
            <p className="text-xs text-muted-foreground">Prefilled from current leaderboard.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Award name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Top Closer"
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Period type</label>
              <select value={periodType} onChange={(e) => setPeriodType(e.target.value as any)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Period</label>
              <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-07 · 2026-Q3 · 2026"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Recipient</label>
            <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              {people.filter((p) => p.role !== 'client_admin').map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs">
            <div className="text-muted-foreground">Metric snapshot</div>
            <div className="font-medium">{seed.metricLabel}: <span className="text-[hsl(var(--trophi-gold))]">{seed.metricValue.toLocaleString()}</span></div>
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
            <button type="submit" disabled={saving}
              className="rounded-md bg-[hsl(var(--trophi-gold))] px-3 py-1.5 text-sm font-medium text-black hover:opacity-90 disabled:opacity-60">
              {saving ? 'Granting…' : 'Grant award'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// CRM report
// ============================================================

interface Filters { from: string; to: string; personId: string; team: string; role: string; }

function filterPeople(data: ReportData, f: Filters) {
  return data.people.filter((p) => {
    if (f.personId && p.id !== f.personId) return false;
    if (f.team && p.team !== f.team) return false;
    if (f.role && p.role !== f.role) return false;
    return true;
  });
}

function CrmReport({ data, filters }: { data: ReportData; filters: Filters }) {
  const people = filterPeople(data, filters);
  const personIds = new Set(people.map((p) => p.id));
  const clientsByBiz = new Map(data.clients.map((c) => [c.businessId, c]));
  const ownedBiz = new Set(
    data.clients.filter((c) => personIds.has(c.salesPersonId)).map((c) => c.businessId),
  );
  const fromMs = new Date(filters.from).getTime();
  const toMs = new Date(filters.to).getTime() + 86400000 - 1;

  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= fromMs && t <= toMs;
  };

  // Distinct businessIds that entered any pre-Approved status in range.
  const leadBiz = new Set<string>();
  const approvedBiz = new Set<string>();
  const signedBiz = new Set<string>();
  for (const h of data.statusHistory) {
    if (!ownedBiz.has(h.businessId)) continue;
    if (!inRange(h.changedAt)) continue;
    if (PRE_APPROVED.has(h.toStatus as any)) leadBiz.add(h.businessId);
    else if (h.toStatus === 'Approved') approvedBiz.add(h.businessId);
    else if (h.toStatus === 'Signed') signedBiz.add(h.businessId);
  }

  const bucketMetrics = (biz: Set<string>) => {
    let locations = 0;
    let value = 0;
    for (const id of biz) {
      const c = clientsByBiz.get(id);
      if (!c) continue;
      locations += c.activeLocations;
      value += (c.budget ?? 0) * c.activeLocations;
    }
    return { brands: biz.size, locations, value };
  };

  const L = bucketMetrics(leadBiz);
  const A = bucketMetrics(approvedBiz);
  const S = bucketMetrics(signedBiz);

  const exportFunnel = () => {
    const rows = [
      ['Tier', 'Brands', 'Locations', 'Monthly $'],
      ['Potential Leads', L.brands, L.locations, L.value],
      ['Approved', A.brands, A.locations, A.value],
      ['Signed', S.brands, S.locations, S.value],
      [],
      ['Rate', 'Brand %', 'Dollar %'],
      ['Approval', pct(A.brands, L.brands), pct(A.value, L.value)],
      ['Signed', pct(S.brands, A.brands), pct(S.value, A.value)],
      ['Overall conversion', pct(S.brands, L.brands), pct(S.value, L.value)],
    ];
    downloadCsv('crm-funnel.csv', rows.map((r) => r.join(',')).join('\n'));
  };

  // Time-in-status: per client, walk history and compute duration per status.
  // Include ALL history (not filtered by ownership) filtered by ownership only.
  const historyByBiz = new Map<string, typeof data.statusHistory>();
  for (const h of data.statusHistory) {
    if (!ownedBiz.has(h.businessId)) continue;
    const arr = historyByBiz.get(h.businessId) ?? [];
    arr.push(h);
    historyByBiz.set(h.businessId, arr);
  }
  // Sort per biz
  for (const arr of historyByBiz.values()) arr.sort((a, b) => a.changedAt.localeCompare(b.changedAt));

  const durationsByStatusByPerson = new Map<string, Map<string, number[]>>();
  const durationsByStatus = new Map<string, number[]>();
  const now = Date.now();
  for (const [biz, arr] of historyByBiz) {
    const client = clientsByBiz.get(biz);
    if (!client) continue;
    const owner = client.salesPersonId;
    for (let i = 0; i < arr.length; i++) {
      const cur = arr[i];
      const next = arr[i + 1];
      const status = cur.toStatus;
      const endMs = next ? new Date(next.changedAt).getTime() : now;
      const days = Math.max(0, (endMs - new Date(cur.changedAt).getTime()) / 86400000);
      if (!durationsByStatus.has(status)) durationsByStatus.set(status, []);
      durationsByStatus.get(status)!.push(days);
      if (!durationsByStatusByPerson.has(owner)) durationsByStatusByPerson.set(owner, new Map());
      const pm = durationsByStatusByPerson.get(owner)!;
      if (!pm.has(status)) pm.set(status, []);
      pm.get(status)!.push(days);
    }
  }

  const teamAvgByStatus = new Map<string, number>();
  JOURNEY_STATUSES.forEach((s) => teamAvgByStatus.set(s, mean(durationsByStatus.get(s) ?? [])));

  const exportTIS = () => {
    const header = ['Person', ...JOURNEY_STATUSES.map((s) => `${s} avg`), ...JOURNEY_STATUSES.map((s) => `${s} median`)];
    const rows: (string | number)[][] = [header];
    for (const p of people) {
      const pm = durationsByStatusByPerson.get(p.id) ?? new Map();
      const avgs = JOURNEY_STATUSES.map((s) => (pm.get(s)?.length ? mean(pm.get(s)!).toFixed(1) : ''));
      const meds = JOURNEY_STATUSES.map((s) => (pm.get(s)?.length ? median(pm.get(s)!).toFixed(1) : ''));
      rows.push([p.name, ...avgs, ...meds]);
    }
    rows.push(['Team avg', ...JOURNEY_STATUSES.map((s) => teamAvgByStatus.get(s)!.toFixed(1)), ...JOURNEY_STATUSES.map((s) => median(durationsByStatus.get(s) ?? []).toFixed(1))]);
    downloadCsv('crm-time-in-status.csv', rows.map((r) => r.join(',')).join('\n'));
  };

  // Per-salesperson funnel
  const perPerson = people.map((p) => {
    const bizIds = new Set(data.clients.filter((c) => c.salesPersonId === p.id).map((c) => c.businessId));
    const L1 = new Set<string>();
    const A1 = new Set<string>();
    const S1 = new Set<string>();
    for (const h of data.statusHistory) {
      if (!bizIds.has(h.businessId)) continue;
      if (!inRange(h.changedAt)) continue;
      if (PRE_APPROVED.has(h.toStatus as any)) L1.add(h.businessId);
      else if (h.toStatus === 'Approved') A1.add(h.businessId);
      else if (h.toStatus === 'Signed') S1.add(h.businessId);
    }
    return { person: p, L: bucketMetrics(L1), A: bucketMetrics(A1), S: bucketMetrics(S1) };
  });

  const exportPerPerson = () => {
    const rows: (string | number)[][] = [[
      'Person', 'Team', 'Role',
      'Leads brands', 'Leads locations', 'Leads $',
      'Approved brands', 'Approved locations', 'Approved $',
      'Signed brands', 'Signed locations', 'Signed $',
      'Approval % brands', 'Approval % $',
      'Signed % brands', 'Signed % $',
      'Conversion % brands', 'Conversion % $',
    ]];
    for (const r of perPerson) {
      rows.push([
        r.person.name, r.person.team ?? '', r.person.role,
        r.L.brands, r.L.locations, r.L.value,
        r.A.brands, r.A.locations, r.A.value,
        r.S.brands, r.S.locations, r.S.value,
        pct(r.A.brands, r.L.brands), pct(r.A.value, r.L.value),
        pct(r.S.brands, r.A.brands), pct(r.S.value, r.A.value),
        pct(r.S.brands, r.L.brands), pct(r.S.value, r.L.value),
      ]);
    }
    downloadCsv('crm-per-salesperson.csv', rows.map((r) => r.join(',')).join('\n'));
  };

  return (
    <div className="space-y-6">
      {/* Funnel summary */}
      <Section title="Funnel summary" onExport={exportFunnel}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FunnelCard label="Potential Leads" tint="hsl(var(--status-mql))" m={L} />
          <FunnelCard label="Approved" tint="hsl(var(--status-approved))" m={A} />
          <FunnelCard label="Signed" tint="hsl(var(--status-signed))" m={S} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <RateCard label="Approval rate" bp={pct(A.brands, L.brands)} dp={pct(A.value, L.value)} />
          <RateCard label="Signed rate" bp={pct(S.brands, A.brands)} dp={pct(S.value, A.value)} />
          <RateCard label="Overall conversion" bp={pct(S.brands, L.brands)} dp={pct(S.value, L.value)} />
        </div>
      </Section>

      {/* Time in status */}
      <Section title="Time in status (days)" onExport={exportTIS}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Person</th>
                {JOURNEY_STATUSES.map((s) => <th key={s} className="px-2 py-2 text-right">{s}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {people.map((p) => {
                const pm = durationsByStatusByPerson.get(p.id) ?? new Map<string, number[]>();
                return (
                  <tr key={p.id}>
                    <td className="px-2 py-2 font-medium">{p.name}</td>
                    {JOURNEY_STATUSES.map((s) => {
                      const arr = pm.get(s) ?? [];
                      if (!arr.length) return <td key={s} className="px-2 py-2 text-right text-muted-foreground">—</td>;
                      const avg = mean(arr);
                      const med = median(arr);
                      const teamAvg = teamAvgByStatus.get(s) ?? 0;
                      const bottleneck = teamAvg > 0 && avg > teamAvg * 1.5;
                      return (
                        <td key={s} className={`px-2 py-2 text-right ${bottleneck ? 'bg-amber-100 text-amber-900 font-medium' : ''}`}>
                          {avg.toFixed(1)} <span className="text-muted-foreground">({med.toFixed(1)})</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr className="bg-muted/20 font-medium">
                <td className="px-2 py-2">Team avg (median)</td>
                {JOURNEY_STATUSES.map((s) => {
                  const arr = durationsByStatus.get(s) ?? [];
                  return (
                    <td key={s} className="px-2 py-2 text-right">
                      {arr.length ? `${mean(arr).toFixed(1)} (${median(arr).toFixed(1)})` : '—'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Cells shaded amber are &gt;1.5× the team average — potential bottleneck. Format: avg (median).</p>
      </Section>

      {/* Per-salesperson funnel */}
      <Section title="Per-salesperson funnel" onExport={exportPerPerson}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Person</th>
                <th className="px-2 py-2">Team</th>
                <th className="px-2 py-2 text-right">Leads</th>
                <th className="px-2 py-2 text-right">Approved</th>
                <th className="px-2 py-2 text-right">Signed</th>
                <th className="px-2 py-2 text-right">Approval%</th>
                <th className="px-2 py-2 text-right">Signed%</th>
                <th className="px-2 py-2 text-right">Conversion%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {perPerson.map((r) => (
                <tr key={r.person.id}>
                  <td className="px-2 py-2 font-medium">{r.person.name}</td>
                  <td className="px-2 py-2 text-muted-foreground">{r.person.team ?? '—'}</td>
                  <td className="px-2 py-2 text-right">{r.L.brands} · {money(r.L.value)}</td>
                  <td className="px-2 py-2 text-right">{r.A.brands} · {money(r.A.value)}</td>
                  <td className="px-2 py-2 text-right">{r.S.brands} · {money(r.S.value)}</td>
                  <td className="px-2 py-2 text-right">{pct(r.A.brands, r.L.brands)}</td>
                  <td className="px-2 py-2 text-right">{pct(r.S.brands, r.A.brands)}</td>
                  <td className="px-2 py-2 text-right">{pct(r.S.brands, r.L.brands)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function FunnelCard({ label, tint, m }: { label: string; tint: string; m: { brands: number; locations: number; value: number } }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tint }} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold" style={{ color: tint }}>{m.brands}</div>
      <div className="mt-1 text-sm text-muted-foreground">{m.locations} location{m.locations === 1 ? '' : 's'}</div>
      <div className="mt-1 text-sm font-medium">{money(m.value)}/mo</div>
    </div>
  );
}
function RateCard({ label, bp, dp }: { label: string; bp: string; dp: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-baseline justify-between">
        <div><div className="text-lg font-semibold">{bp}</div><div className="text-[11px] text-muted-foreground">by brand</div></div>
        <div><div className="text-lg font-semibold">{dp}</div><div className="text-[11px] text-muted-foreground">by dollar</div></div>
      </div>
    </div>
  );
}
function Section({ title, onExport, children }: { title: string; onExport?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">{title}</h2>
        {onExport && (
          <button onClick={onExport} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">
            <Download className="h-3 w-3" /> CSV
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ============================================================
// Onboarding report
// ============================================================

function OnboardingReport({ data, filters }: { data: ReportData; filters: Filters }) {
  const people = filterPeople(data, filters);
  const personIds = new Set(people.map((p) => p.id));
  const clientsByBiz = new Map(data.clients.map((c) => [c.businessId, c]));
  const recordsByBiz = new Map(data.onboardingRecords.map((r) => [r.businessId, r]));

  const fromMs = new Date(filters.from).getTime();
  const toMs = new Date(filters.to).getTime() + 86400000 - 1;
  const inRange = (iso: string | null | undefined) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= fromMs && t <= toMs;
  };

  // For each person, figure out which brands they touched.
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

  // Step durations by biz
  const stepDurationsByBiz = new Map<string, { step: number; days: number; completedAt: string; startedAt: string; completedBy: string | null }[]>();
  data.stepProgress.forEach((s) => {
    if (s.status !== 'complete' || !s.startedAt || !s.completedAt) return;
    const arr = stepDurationsByBiz.get(s.businessId) ?? [];
    arr.push({
      step: s.stepNumber,
      days: daysBetween(s.startedAt, s.completedAt),
      completedAt: s.completedAt,
      startedAt: s.startedAt,
      completedBy: s.completedBy,
    });
    stepDurationsByBiz.set(s.businessId, arr);
  });

  const defByStep = new Map(data.stepDefinitions.map((d) => [d.stepNumber, d]));

  // Total onboarding duration by biz (Approved -> Go Live)
  const totalDurationByBiz = new Map<string, number>();
  data.clients.forEach((c) => {
    const rec = recordsByBiz.get(c.businessId);
    if (c.approvedAt && rec?.wentLiveAt) {
      totalDurationByBiz.set(c.businessId, daysBetween(c.approvedAt, rec.wentLiveAt));
    }
  });

  // Per-person throughput
  const throughput = people.map((p) => {
    const touched = touchedByPerson.get(p.id) ?? new Set<string>();
    const completedInRange = Array.from(touched).filter((biz) => {
      const rec = recordsByBiz.get(biz);
      return rec?.wentLiveAt && inRange(rec.wentLiveAt);
    });
    const currentlyActive = Array.from(touched).filter((biz) => recordsByBiz.get(biz)?.status === 'active').length;

    // Average days per step for steps this role owns
    const stepDurations: number[] = [];
    for (const biz of touched) {
      const arr = stepDurationsByBiz.get(biz) ?? [];
      for (const d of arr) {
        const def = defByStep.get(d.step);
        if (!def) continue;
        const ownsStep = (def.actor === 'account_owner' && clientsByBiz.get(biz)?.salesPersonId === p.id)
          || (def.actor === 'specialist' && recordsByBiz.get(biz)?.specialistId === p.id)
          || (def.actor === 'account_manager' && recordsByBiz.get(biz)?.accountManagerId === p.id);
        if (ownsStep) stepDurations.push(d.days);
      }
    }

    const totals = Array.from(touched).map((biz) => totalDurationByBiz.get(biz)).filter((v): v is number => typeof v === 'number');
    return {
      person: p,
      completed: completedInRange.length,
      active: currentlyActive,
      avgStepDays: stepDurations.length ? mean(stepDurations) : null,
      avgTotalDays: totals.length ? mean(totals) : null,
      fastest: totals.length ? Math.min(...totals) : null,
      slowest: totals.length ? Math.max(...totals) : null,
    };
  });

  const exportThroughput = () => {
    const rows: (string | number)[][] = [[
      'Person', 'Role', 'Team', 'Completed (period)', 'Active', 'Avg days/step (owned)', 'Avg total (days)', 'Fastest', 'Slowest',
    ]];
    for (const r of throughput) {
      rows.push([
        r.person.name, r.person.role, r.person.team ?? '',
        r.completed, r.active,
        r.avgStepDays !== null ? r.avgStepDays.toFixed(1) : '',
        r.avgTotalDays !== null ? r.avgTotalDays.toFixed(1) : '',
        r.fastest !== null ? r.fastest.toFixed(1) : '',
        r.slowest !== null ? r.slowest.toFixed(1) : '',
      ]);
    }
    downloadCsv('onboarding-throughput.csv', rows.map((r) => r.join(',')).join('\n'));
  };

  // Step bottleneck view — restrict to steps completed within the period.
  const stepAgg = data.stepDefinitions.map((def) => {
    const durations: number[] = [];
    for (const arr of stepDurationsByBiz.values()) {
      for (const d of arr) {
        if (d.step !== def.stepNumber) continue;
        if (!inRange(d.completedAt)) continue;
        durations.push(d.days);
      }
    }
    return {
      step: def.stepNumber,
      name: def.name,
      actor: def.actor,
      count: durations.length,
      avg: durations.length ? mean(durations) : 0,
      median: durations.length ? median(durations) : 0,
    };
  });
  const avgSorted = [...stepAgg].filter((s) => s.count).sort((a, b) => b.avg - a.avg).slice(0, 3);
  const slowestSet = new Set(avgSorted.map((s) => s.step));

  const clientAvg = mean(stepAgg.filter((s) => s.actor === 'client' && s.count).map((s) => s.avg));
  const trophiAvg = mean(stepAgg.filter((s) => s.actor !== 'client' && s.actor !== 'system' && s.count).map((s) => s.avg));

  const exportBottleneck = () => {
    const rows: (string | number)[][] = [['Step', 'Name', 'Actor', 'Completed count', 'Avg days', 'Median days']];
    for (const s of stepAgg) rows.push([s.step, s.name, s.actor, s.count, s.avg.toFixed(1), s.median.toFixed(1)]);
    downloadCsv('onboarding-step-bottleneck.csv', rows.map((r) => r.join(',')).join('\n'));
  };

  return (
    <div className="space-y-6">
      <Section title="Per-person throughput" onExport={exportThroughput}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Person</th>
                <th className="px-2 py-2">Role</th>
                <th className="px-2 py-2">Team</th>
                <th className="px-2 py-2 text-right">Completed</th>
                <th className="px-2 py-2 text-right">Active</th>
                <th className="px-2 py-2 text-right">Avg step days</th>
                <th className="px-2 py-2 text-right">Avg total</th>
                <th className="px-2 py-2 text-right">Fastest</th>
                <th className="px-2 py-2 text-right">Slowest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {throughput.map((r) => (
                <tr key={r.person.id}>
                  <td className="px-2 py-2 font-medium">{r.person.name}</td>
                  <td className="px-2 py-2 text-muted-foreground">{r.person.role}</td>
                  <td className="px-2 py-2 text-muted-foreground">{r.person.team ?? '—'}</td>
                  <td className="px-2 py-2 text-right">{r.completed}</td>
                  <td className="px-2 py-2 text-right">{r.active}</td>
                  <td className="px-2 py-2 text-right">{r.avgStepDays !== null ? r.avgStepDays.toFixed(1) : '—'}</td>
                  <td className="px-2 py-2 text-right">{r.avgTotalDays !== null ? r.avgTotalDays.toFixed(1) : '—'}</td>
                  <td className="px-2 py-2 text-right">{r.fastest !== null ? r.fastest.toFixed(1) : '—'}</td>
                  <td className="px-2 py-2 text-right">{r.slowest !== null ? r.slowest.toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Fastest/slowest columns surface outliers alongside averages — review unusually fast completions for quality.
        </p>
      </Section>

      <Section title="Step bottlenecks" onExport={exportBottleneck}>
        <div className="mb-3 flex gap-4 text-xs">
          <div className="rounded-md bg-muted/40 px-3 py-2">Client-side avg: <b>{clientAvg.toFixed(1)}d</b></div>
          <div className="rounded-md bg-muted/40 px-3 py-2">Trophi-side avg: <b>{trophiAvg.toFixed(1)}d</b></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2 w-10">#</th>
                <th className="px-2 py-2">Step</th>
                <th className="px-2 py-2">Actor</th>
                <th className="px-2 py-2 text-right">Completions</th>
                <th className="px-2 py-2 text-right">Avg days</th>
                <th className="px-2 py-2 text-right">Median</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stepAgg.map((s) => {
                const slow = slowestSet.has(s.step);
                return (
                  <tr key={s.step} className={slow ? 'bg-amber-50' : ''}>
                    <td className="px-2 py-2 text-muted-foreground">{s.step}</td>
                    <td className="px-2 py-2 font-medium">{s.name}</td>
                    <td className="px-2 py-2 text-muted-foreground">{s.actor}</td>
                    <td className="px-2 py-2 text-right">{s.count}</td>
                    <td className={`px-2 py-2 text-right ${slow ? 'text-amber-900 font-semibold' : ''}`}>{s.count ? s.avg.toFixed(1) : '—'}</td>
                    <td className="px-2 py-2 text-right">{s.count ? s.median.toFixed(1) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
