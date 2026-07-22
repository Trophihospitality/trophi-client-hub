import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getLeaderboardDataFn } from '@/lib/awards.functions';
import { useAuth } from '@/store/userStore';
import {
  CrmLeaderboard,
  OnboardingLeaderboard,
  RecentAwardsStrip,
  currentAndPreviousPeriods,
  indexAwardsByRecipient,
} from '@/components/leaderboards/Leaderboards';

// ============================================================
// LEADERBOARDS — visible to ALL internal Trophi roles
// (sales_rep, onboarding_specialist, account_manager, manager, admin).
// Excludes client_admin. Read-only, no CSV, no drill-down.
// ============================================================

export const Route = createFileRoute('/_authenticated/leaderboards')({
  component: LeaderboardsPage,
});

type PresetKey = 'this_month' | 'last_month' | 'this_quarter' | 'ytd' | 'custom';

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

function LeaderboardsPage() {
  const { profile } = useAuth();
  if (profile && profile.role === 'client_admin') {
    throw redirect({ to: '/client-portal' });
  }

  const getData = useServerFn(getLeaderboardDataFn);
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard-data'],
    queryFn: () => getData(),
  });

  const [preset, setPreset] = useState<PresetKey>('this_month');
  const initial = presetRange('this_month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [team, setTeam] = useState('');
  const [role, setRole] = useState('');

  const setPresetAndDates = (p: PresetKey) => {
    setPreset(p);
    if (p !== 'custom') {
      const r = presetRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const periods = useMemo(() => currentAndPreviousPeriods(), []);
  const awardsIndex = useMemo(
    () => (data ? indexAwardsByRecipient(data.awards, periods) : new Map()),
    [data, periods],
  );

  if (isLoading || !data) {
    return <div className="text-sm text-muted-foreground">Loading leaderboards…</div>;
  }

  const teams = Array.from(new Set(data.people.map((p) => p.team).filter(Boolean))) as string[];
  const roles = Array.from(new Set(data.people.filter((p) => p.role !== 'client_admin').map((p) => p.role)));
  const filters = { from, to, team, role };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Leaderboards</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live rankings across sales and onboarding — same numbers your leadership sees.
        </p>
      </div>
      <div className="gold-rule w-24" />

      <RecentAwardsStrip awards={data.awards} people={data.people} />

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Date range</label>
            <select className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={preset} onChange={(e) => setPresetAndDates(e.target.value as PresetKey)}>
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

      <CrmLeaderboard data={data} filters={filters} awardsIndex={awardsIndex} />
      <OnboardingLeaderboard data={data} filters={filters} awardsIndex={awardsIndex} />
    </div>
  );
}
