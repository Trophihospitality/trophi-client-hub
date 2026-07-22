import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import {
  listClientUsersFn, createClientUserFn, updateClientUserFn, resendClientInviteFn,
  adminResetAndReinviteFn,
  type ClientUser, type ClientPermission,
} from '@/lib/client-users.functions';
import { listClients } from '@/lib/crm.functions';
import { formatPhoneInput } from '@/lib/phone';
import { useAuth } from '@/store/userStore';
import { Plus, RefreshCcw, Search, AlertTriangle } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/users/client-users')({
  component: ClientUsersPage,
});

const PERM_OPTIONS: { value: ClientPermission; label: string }[] = [
  { value: 'admin_full', label: 'Admin (full)' },
  { value: 'leadership', label: 'Leadership' },
  { value: 'manager', label: 'Manager' },
];

function ClientUsersPage() {
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
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Client Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Client portal accounts with per-business permission and location scope.
        </p>
      </div>

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

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function InviteStatusCell({ user }: { user: ClientUser }) {
  const s = user.inviteStatus;
  const cfg =
    s === 'accepted' ? { label: 'Accepted', cls: 'bg-emerald-100 text-emerald-700' }
    : s === 'invited' ? { label: 'Invited', cls: 'bg-amber-100 text-amber-700' }
    : s === 'expired' ? { label: 'Expired', cls: 'bg-orange-100 text-orange-700' }
    : s === 'failed' ? { label: 'Failed', cls: 'bg-red-100 text-red-700' }
    : s === 'revoked' ? { label: 'Revoked', cls: 'bg-muted text-muted-foreground' }
    : s === 'invite_required' ? { label: 'Invite required', cls: 'bg-red-100 text-red-700' }
    : { label: 'Not sent', cls: 'bg-muted text-muted-foreground' };
  return (
    <div className="space-y-0.5">
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
      {s === 'invite_required' && (
        <div className="flex items-center gap-1 text-[11px] text-red-700">
          <AlertTriangle className="h-3 w-3" /> No active login — resend invite
        </div>
      )}
      {(s === 'invited' || s === 'expired') && user.invitedAt && (
        <div className="text-[11px] text-muted-foreground">
          Sent {fmtDate(user.invitedAt)} to {user.inviteSentTo ?? user.email}
          {s === 'invited' && user.inviteExpiresAt && <> · expires {fmtDate(user.inviteExpiresAt)}</>}
        </div>
      )}
      {s === 'failed' && (
        <div className="text-[11px] text-red-700">
          {user.inviteLastAttemptAt && <>Attempted {fmtDate(user.inviteLastAttemptAt)} · </>}
          {user.inviteLastError ?? 'Send failed'}
        </div>
      )}
      {s === 'accepted' && user.activatedAt && (
        <div className="text-[11px] text-muted-foreground">Activated {fmtDate(user.activatedAt)}</div>
      )}
    </div>
  );
}

function ClientUserRow({ user }: { user: ClientUser }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const update = useServerFn(updateClientUserFn);
  const resend = useServerFn(resendClientInviteFn);
  const adminReset = useServerFn(adminResetAndReinviteFn);
  const [editing, setEditing] = useState(false);

  const updateM = useMutation({
    mutationFn: (patch: { permissionLevel?: ClientPermission; status?: 'invited' | 'active' | 'inactive' }) =>
      update({ data: { id: user.id, ...patch } as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['client-users'] }); toast.success('Updated'); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });
  const resendM = useMutation({
    mutationFn: () => resend({ data: { id: user.id } }),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['client-users'] }); toast.success(`Invite sent to ${r?.sentTo ?? user.email}`); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });
  const adminResetM = useMutation({
    mutationFn: () => adminReset({ data: { id: user.id } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['client-users'] });
      toast.success(`Reset & reinvited ${r?.sentTo ?? user.email}`);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const canResend = user.inviteStatus === 'invited' || user.inviteStatus === 'expired'
    || user.inviteStatus === 'never_sent' || user.inviteStatus === 'invite_required'
    || user.inviteStatus === 'failed';

  const handleAdminReset = () => {
    if (!window.confirm(
      `Reset & reinvite ${user.firstName} ${user.lastName} (${user.email})?\n\n`
      + `This invalidates any existing portal access and login, deletes any current auth account for this email, and sends a fresh invite. Use this when the account is stuck, compromised, or the client wants to start over.`
    )) return;
    adminResetM.mutate();
  };

  return (
    <>
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
        <td className="px-4 py-3"><InviteStatusCell user={user} /></td>
        <td className="px-4 py-3 text-right">
          <div className="flex justify-end gap-3">
            {canResend && (
              <button
                onClick={() => resendM.mutate()}
                disabled={resendM.isPending || adminResetM.isPending}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCcw className="h-3.5 w-3.5" /> {user.inviteStatus === 'never_sent' ? 'Send invite' : 'Resend'}
              </button>
            )}
            {isAdmin && (
              <button
                onClick={handleAdminReset}
                disabled={adminResetM.isPending || resendM.isPending}
                title="Invalidates existing access and sends a fresh invite"
                className="inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-900"
              >
                <AlertTriangle className="h-3.5 w-3.5" /> {adminResetM.isPending ? 'Resetting…' : 'Reset & reinvite'}
              </button>
            )}
            <button onClick={() => setEditing(true)} className="text-xs text-muted-foreground hover:text-foreground">Edit</button>
            <button
              onClick={() => updateM.mutate({ status: user.status === 'inactive' ? 'active' : 'inactive' })}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {user.status === 'inactive' ? 'Reactivate' : 'Deactivate'}
            </button>
          </div>
        </td>
      </tr>
      {editing && <EditClientUserDialog user={user} onClose={() => setEditing(false)} />}
    </>
  );
}

function EditClientUserDialog({ user, onClose }: { user: ClientUser; onClose: () => void }) {
  const qc = useQueryClient();
  const update = useServerFn(updateClientUserFn);
  const resend = useServerFn(resendClientInviteFn);
  const [form, setForm] = useState({
    firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone ?? '',
  });
  const [pendingResendConfirm, setPendingResendConfirm] = useState<null | { sentTo: string }>(null);

  const saveM = useMutation({
    mutationFn: () => update({ data: {
      id: user.id,
      firstName: form.firstName, lastName: form.lastName,
      email: form.email, phone: form.phone || null,
    } as any }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['client-users'] });
      if (r?.emailChangedWhileInvited) {
        setPendingResendConfirm({ sentTo: form.email });
      } else {
        toast.success('Updated'); onClose();
      }
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });
  const resendM = useMutation({
    mutationFn: () => resend({ data: { id: user.id } }),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['client-users'] }); toast.success(`Invite sent to ${r?.sentTo}`); onClose(); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        {!pendingResendConfirm ? (
          <>
            <h2 className="font-display text-lg font-semibold mb-4">Edit Client User</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name *"><Input value={form.firstName} onChange={v => setForm({ ...form, firstName: v })} /></Field>
              <Field label="Last name *"><Input value={form.lastName} onChange={v => setForm({ ...form, lastName: v })} /></Field>
              <Field label="Email *" className="col-span-2"><Input type="email" value={form.email} onChange={v => setForm({ ...form, email: v })} /></Field>
              <Field label="Phone" className="col-span-2"><Input value={form.phone} onChange={v => setForm({ ...form, phone: formatPhoneInput(v) })} /></Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-md border border-input px-3.5 py-2 text-sm">Cancel</button>
              <button
                disabled={saveM.isPending}
                onClick={() => saveM.mutate()}
                className="rounded-md bg-[hsl(var(--trophi-gold))] px-3.5 py-2 text-sm font-medium text-[hsl(var(--trophi-ink))] disabled:opacity-60"
              >{saveM.isPending ? 'Saving…' : 'Save'}</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-display text-lg font-semibold">Send invite to new address?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Email updated to <b>{pendingResendConfirm.sentTo}</b>. Any previously issued invite links have been invalidated.
              Send a fresh invite to the new address now?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-md border border-input px-3.5 py-2 text-sm">Not now</button>
              <button
                disabled={resendM.isPending}
                onClick={() => resendM.mutate()}
                className="rounded-md bg-[hsl(var(--trophi-gold))] px-3.5 py-2 text-sm font-medium text-[hsl(var(--trophi-ink))] disabled:opacity-60"
              >{resendM.isPending ? 'Sending…' : 'Send invite'}</button>
            </div>
          </>
        )}
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold mb-4">New Client User</h2>
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
