import { createFileRoute, redirect, Link, useRouterState } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import {
  listUsersFn, setUserRoleFn, setUserTeamFn, createTrophiUserFn,
  setUserActiveFn, listRoleHistoryFn, type AppRole, type AppUser,
} from '@/lib/users.functions';
import {
  listClientUsersFn, createClientUserFn, updateClientUserFn, resendClientInviteFn,
  type ClientUser, type ClientPermission,
} from '@/lib/client-users.functions';
import { listClients } from '@/lib/crm.functions';
import { useAuth } from '@/store/userStore';
import { formatPhone, formatPhoneInput } from '@/lib/phone';
import { Plus, RefreshCcw, History, Search } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/users')({
  component: UsersPage,
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (s.tab === 'client' ? 'client' : 'trophi') as 'trophi' | 'client',
  }),
});

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'sales_rep', label: 'Sales Rep' },
  { value: 'onboarding_specialist', label: 'Onboarding Specialist' },
  { value: 'account_manager', label: 'Account Manager' },
];

const PERM_OPTIONS: { value: ClientPermission; label: string }[] = [
  { value: 'admin_full', label: 'Admin (full)' },
  { value: 'leadership', label: 'Leadership' },
  { value: 'manager', label: 'Manager' },
];

function useIsSpiro() {
  const { profile } = useAuth();
  // Spiro = employee_id 1. Profile in userStore may not expose this; we approximate via email OR let the server enforce.
  return (profile?.email ?? '').toLowerCase() === 'spiro@trophihospitality.com';
}

function UsersPage() {
  const { profile } = useAuth();
  const { tab } = Route.useSearch();
  if (profile && profile.role !== 'admin') {
    throw redirect({ to: '/crm' });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">User Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage Trophi employees and client portal users. Only Spiro (Employee 01) can create or modify Trophi users.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        <TabLink to="/users" search={{ tab: 'trophi' }} active={tab === 'trophi'}>Trophi Users</TabLink>
        <TabLink to="/users" search={{ tab: 'client' }} active={tab === 'client'}>Client Users</TabLink>
      </div>

      {tab === 'trophi' ? <TrophiUsersTab /> : <ClientUsersTab />}
    </div>
  );
}

function TabLink({ to, search, active, children }: { to: string; search: any; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      search={search}
      className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? 'border-[hsl(var(--trophi-gold))] text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </Link>
  );
}

/* ================================================================
   Trophi Users Tab
   ================================================================ */
function TrophiUsersTab() {
  const isSpiro = useIsSpiro();
  const qc = useQueryClient();
  const listUsers = useServerFn(listUsersFn);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [historyFor, setHistoryFor] = useState<AppUser | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => listUsers(),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users ?? [];
    return (users ?? []).filter(u =>
      [u.name, u.email, u.team ?? '', u.role, String(u.employeeId ?? '')].some(v => v.toLowerCase().includes(q))
    );
  }, [users, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees…"
            className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm"
          />
        </div>
        {isSpiro && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--trophi-gold))] px-3.5 py-2 text-sm font-medium text-[hsl(var(--trophi-ink))] hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New Trophi User
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Emp #</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={8}>Loading…</td></tr>}
            {filtered.map((u) => (
              <TrophiRow key={u.id} user={u} canWrite={isSpiro} onHistory={() => setHistoryFor(u)} />
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr><td className="px-4 py-6 text-muted-foreground text-center" colSpan={8}>No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <AddTrophiUserDialog onClose={() => setShowAdd(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['users'] })} />}
      {historyFor && <RoleHistoryDialog user={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function TrophiRow({ user, canWrite, onHistory }: { user: AppUser; canWrite: boolean; onHistory: () => void }) {
  const qc = useQueryClient();
  const setRole = useServerFn(setUserRoleFn);
  const setTeam = useServerFn(setUserTeamFn);
  const setActive = useServerFn(setUserActiveFn);

  const [team, setTeamValue] = useState(user.team ?? '');

  const roleM = useMutation({
    mutationFn: (role: AppRole) => setRole({ data: { targetUserId: user.id, role } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Role updated'); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });
  const teamM = useMutation({
    mutationFn: (v: string) => setTeam({ data: { targetUserId: user.id, team: v.trim() || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Team updated'); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });
  const activeM = useMutation({
    mutationFn: (v: boolean) => setActive({ data: { targetUserId: user.id, isActive: v } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Status updated'); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  return (
    <tr className="hover:bg-muted/20">
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
        {user.employeeId !== null ? String(user.employeeId).padStart(2, '0') : '—'}
      </td>
      <td className="px-4 py-3 font-medium">{user.name}</td>
      <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
      <td className="px-4 py-3 text-muted-foreground">{user.phone ? formatPhone(user.phone) : '—'}</td>
      <td className="px-4 py-3">
        <select
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
          value={user.role === 'client_admin' ? 'sales_rep' : user.role}
          disabled={!canWrite || roleM.isPending}
          onChange={(e) => roleM.mutate(e.target.value as AppRole)}
        >
          {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        <input
          className="w-40 rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
          placeholder="—"
          value={team}
          disabled={!canWrite || teamM.isPending}
          onChange={(e) => setTeamValue(e.target.value)}
          onBlur={() => { if ((team ?? '') !== (user.team ?? '')) teamM.mutate(team); }}
        />
      </td>
      <td className="px-4 py-3">
        <button
          disabled={!canWrite || activeM.isPending}
          onClick={() => activeM.mutate(!user.isActive)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium disabled:opacity-60 ${
            user.isActive
              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {user.isActive ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td className="px-4 py-3 text-right">
        <button onClick={onHistory} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <History className="h-3.5 w-3.5" /> History
        </button>
      </td>
    </tr>
  );
}

function AddTrophiUserDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const createUser = useServerFn(createTrophiUserFn);
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    role: 'sales_rep' as AppRole, team: '', hireDate: new Date().toISOString().slice(0, 10),
  });
  const m = useMutation({
    mutationFn: () => createUser({ data: {
      firstName: form.firstName, lastName: form.lastName,
      email: form.email, phone: form.phone || null, role: form.role,
      team: form.team || null, hireDate: form.hireDate,
    } as any }),
    onSuccess: () => { toast.success('User invited — check email to activate'); onSaved(); onClose(); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to create user'),
  });

  const canSubmit = form.firstName && form.lastName && form.email && form.role && form.hireDate;

  return (
    <Modal onClose={onClose} title="New Trophi User">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name *"><Input value={form.firstName} onChange={v => setForm({ ...form, firstName: v })} /></Field>
        <Field label="Last name *"><Input value={form.lastName} onChange={v => setForm({ ...form, lastName: v })} /></Field>
        <Field label="Email *" className="col-span-2"><Input type="email" value={form.email} onChange={v => setForm({ ...form, email: v })} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={v => setForm({ ...form, phone: formatPhoneInput(v) })} /></Field>
        <Field label="Team"><Input value={form.team} onChange={v => setForm({ ...form, team: v })} /></Field>
        <Field label="Role *">
          <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as AppRole })}>
            {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Hire date *"><Input type="date" value={form.hireDate} onChange={v => setForm({ ...form, hireDate: v })} /></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-input px-3.5 py-2 text-sm">Cancel</button>
        <button
          disabled={!canSubmit || m.isPending}
          onClick={() => m.mutate()}
          className="rounded-md bg-[hsl(var(--trophi-gold))] px-3.5 py-2 text-sm font-medium text-[hsl(var(--trophi-ink))] disabled:opacity-60"
        >
          {m.isPending ? 'Inviting…' : 'Send invite'}
        </button>
      </div>
    </Modal>
  );
}

function RoleHistoryDialog({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const list = useServerFn(listRoleHistoryFn);
  const { data, isLoading } = useQuery({
    queryKey: ['role-history', user.id],
    queryFn: () => list({ data: { targetUserId: user.id } }),
  });
  return (
    <Modal onClose={onClose} title={`Role history — ${user.name}`}>
      {isLoading && <div className="py-6 text-sm text-muted-foreground">Loading…</div>}
      {!isLoading && (data ?? []).length === 0 && (
        <div className="py-6 text-sm text-muted-foreground">No prior role changes recorded.</div>
      )}
      <ul className="divide-y divide-border">
        {(data ?? []).map(r => (
          <li key={r.id} className="flex items-center justify-between py-2.5 text-sm">
            <span className="font-medium capitalize">{r.role.replace('_', ' ')}</span>
            <span className="text-muted-foreground">
              {r.startedOn} → {r.endedOn ?? 'present'}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ================================================================
   Client Users Tab
   ================================================================ */
function ClientUsersTab() {
  const list = useServerFn(listClientUsersFn);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data: users, isLoading } = useQuery({
    queryKey: ['client-users'],
    queryFn: () => list(),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users ?? [];
    return (users ?? []).filter(u =>
      [`${u.firstName} ${u.lastName}`, u.email, u.businessName ?? '', u.businessId].some(v => v.toLowerCase().includes(q))
    );
  }, [users, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search client users…"
            className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--trophi-gold))] px-3.5 py-2 text-sm font-medium text-[hsl(var(--trophi-ink))] hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New Client User
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Locations</th>
              <th className="px-4 py-3">Permission</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && <tr><td colSpan={7} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>}
            {filtered.map(u => <ClientUserRow key={u.id} user={u} />)}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No client users yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <AddClientUserDialog onClose={() => setShowAdd(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['client-users'] })} />}
    </div>
  );
}

function ClientUserRow({ user }: { user: ClientUser }) {
  const qc = useQueryClient();
  const update = useServerFn(updateClientUserFn);
  const resend = useServerFn(resendClientInviteFn);
  const updateM = useMutation({
    mutationFn: (patch: { permissionLevel?: ClientPermission; status?: 'invited' | 'active' | 'inactive' }) =>
      update({ data: { id: user.id, ...patch } as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['client-users'] }); toast.success('Updated'); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });
  const resendM = useMutation({
    mutationFn: () => resend({ data: { id: user.id } }),
    onSuccess: () => toast.success('Invite resent'),
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const statusColor =
    user.status === 'active' ? 'bg-emerald-100 text-emerald-700'
    : user.status === 'invited' ? 'bg-amber-100 text-amber-700'
    : 'bg-muted text-muted-foreground';

  return (
    <tr className="hover:bg-muted/20">
      <td className="px-4 py-3 font-medium">{user.firstName} {user.lastName}</td>
      <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
      <td className="px-4 py-3">
        <div className="text-sm">{user.businessName ?? '—'}</div>
        <div className="text-xs text-muted-foreground font-mono">{user.businessId}</div>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {user.locationIds.length === 0 ? 'All' : `${user.locationIds.length} location${user.locationIds.length === 1 ? '' : 's'}`}
      </td>
      <td className="px-4 py-3">
        <select
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={user.permissionLevel}
          disabled={updateM.isPending}
          onChange={e => updateM.mutate({ permissionLevel: e.target.value as ClientPermission })}
        >
          {PERM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}>{user.status}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-2">
          {user.status === 'invited' && (
            <button
              onClick={() => resendM.mutate()}
              disabled={resendM.isPending}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCcw className="h-3.5 w-3.5" /> Resend
            </button>
          )}
          <button
            onClick={() => updateM.mutate({ status: user.status === 'inactive' ? 'active' : 'inactive' })}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {user.status === 'inactive' ? 'Reactivate' : 'Deactivate'}
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddClientUserDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const listClientsFn2 = useServerFn(listClients);
  const create = useServerFn(createClientUserFn);
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: () => listClientsFn2() });

  const [form, setForm] = useState({
    businessId: '', firstName: '', lastName: '', email: '', phone: '',
    permissionLevel: 'admin_full' as ClientPermission, locationIds: [] as string[],
    sendInvite: true,
  });
  const selectedClient = (clients ?? []).find((c: any) => c.businessId === form.businessId);
  const locations = selectedClient?.locations ?? [];

  const m = useMutation({
    mutationFn: () => create({ data: {
      businessId: form.businessId, firstName: form.firstName, lastName: form.lastName,
      email: form.email, phone: form.phone || null,
      permissionLevel: form.permissionLevel, locationIds: form.locationIds,
      sendInvite: form.sendInvite,
    } as any }),
    onSuccess: () => { toast.success('Client user created'); onSaved(); onClose(); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const canSubmit = form.businessId && form.firstName && form.lastName && form.email && form.permissionLevel;

  return (
    <Modal onClose={onClose} title="New Client User">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client *" className="col-span-2">
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.businessId}
            onChange={e => setForm({ ...form, businessId: e.target.value, locationIds: [] })}
          >
            <option value="">Select a client…</option>
            {(clients ?? []).map((c: any) => (
              <option key={c.businessId} value={c.businessId}>{c.company} ({c.businessId})</option>
            ))}
          </select>
        </Field>
        <Field label="First name *"><Input value={form.firstName} onChange={v => setForm({ ...form, firstName: v })} /></Field>
        <Field label="Last name *"><Input value={form.lastName} onChange={v => setForm({ ...form, lastName: v })} /></Field>
        <Field label="Email *" className="col-span-2"><Input type="email" value={form.email} onChange={v => setForm({ ...form, email: v })} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={v => setForm({ ...form, phone: formatPhoneInput(v) })} /></Field>
        <Field label="Permission *">
          <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.permissionLevel} onChange={e => setForm({ ...form, permissionLevel: e.target.value as ClientPermission })}>
            {PERM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {locations.length > 0 && (
          <Field label="Location access (leave empty for all)" className="col-span-2">
            <div className="rounded-md border border-input p-2 max-h-40 overflow-y-auto space-y-1">
              {locations.map((loc: any) => (
                <label key={loc.locationId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.locationIds.includes(loc.locationId)}
                    onChange={e => {
                      const set = new Set(form.locationIds);
                      if (e.target.checked) set.add(loc.locationId); else set.delete(loc.locationId);
                      setForm({ ...form, locationIds: Array.from(set) });
                    }}
                  />
                  <span>{loc.name} <span className="text-xs text-muted-foreground font-mono">{loc.locationId}</span></span>
                </label>
              ))}
            </div>
          </Field>
        )}
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.sendInvite} onChange={e => setForm({ ...form, sendInvite: e.target.checked })} />
          Send invite email now
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-input px-3.5 py-2 text-sm">Cancel</button>
        <button
          disabled={!canSubmit || m.isPending}
          onClick={() => m.mutate()}
          className="rounded-md bg-[hsl(var(--trophi-gold))] px-3.5 py-2 text-sm font-medium text-[hsl(var(--trophi-ink))] disabled:opacity-60"
        >
          {m.isPending ? 'Saving…' : 'Create user'}
        </button>
      </div>
    </Modal>
  );
}

/* ================================================================
   Shared UI atoms
   ================================================================ */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
function Input({ value, onChange, type = 'text' }: { value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    />
  );
}
