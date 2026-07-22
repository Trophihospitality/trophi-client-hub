import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import {
  listUsersFn, createTrophiUserFn,
  setUserActiveFn, type AppRole, type AppUser,
} from '@/lib/users.functions';
import { useAuth } from '@/store/userStore';
import { formatPhone, formatPhoneInput } from '@/lib/phone';
import { Plus, Search } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/users/trophi')({
  component: TrophiUsersPage,
});

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'sales_rep', label: 'Sales Rep' },
  { value: 'onboarding_specialist', label: 'Onboarding Specialist' },
  { value: 'account_manager', label: 'Account Manager' },
];

function useIsSpiro() {
  const { profile } = useAuth();
  return (profile?.email ?? '').toLowerCase() === 'spiro@trophihospitality.com';
}

function TrophiUsersPage() {
  const isSpiro = useIsSpiro();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listUsers = useServerFn(listUsersFn);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

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
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Trophi Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trophi employees. Click a row for the full employee profile. Only Spiro (Employee 01) can create or modify Trophi users.
        </p>
      </div>

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
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={7}>Loading…</td></tr>}
            {filtered.map((u) => (
              <tr
                key={u.id}
                className="hover:bg-muted/20 cursor-pointer"
                onClick={() => navigate({ to: '/users/trophi/$userId', params: { userId: u.id } })}
              >
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {u.employeeId !== null ? String(u.employeeId).padStart(2, '0') : '—'}
                </td>
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.phone ? formatPhone(u.phone) : '—'}</td>
                <td className="px-4 py-3 capitalize text-muted-foreground">{u.role.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.team ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    u.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
                  }`}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr><td className="px-4 py-6 text-muted-foreground text-center" colSpan={7}>No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <AddTrophiUserDialog onClose={() => setShowAdd(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['users'] })} />}
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold mb-4">New Trophi User</h2>
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
// keep unused-suppressed exports to satisfy TS if referenced elsewhere
export type { AppUser };
export { setUserActiveFn };
