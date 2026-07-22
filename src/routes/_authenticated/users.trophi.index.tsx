import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import {
  listUsersFn, createTrophiUserFn, updateTrophiUserFn, resendTrophiInviteFn,
  type AppRole, type AppUser,
} from '@/lib/users.functions';

import { useAuth } from '@/store/userStore';
import { formatPhone, formatPhoneInput } from '@/lib/phone';
import { AvatarCircle } from '@/components/ui/avatar-circle';
import { uploadAvatarBlob, validateAvatarFile, AVATAR_ACCEPT } from '@/lib/avatar';
import { AvatarCropDialog } from '@/components/ui/avatar-crop-dialog';
import { AlertTriangle, Mail, Plus, Search, Upload } from 'lucide-react';


export const Route = createFileRoute('/_authenticated/users/trophi/')({
  component: TrophiUsersPage,
});

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'sales_rep', label: 'Sales Rep' },
  { value: 'onboarding_specialist', label: 'Onboarding Specialist' },
  { value: 'account_manager', label: 'Account Manager' },
];

export const TEAM_OPTIONS = ['TBD', 'Other'] as const;

export function findSpiroId(users: AppUser[] | undefined): string | null {
  return users?.find(u => u.email.toLowerCase() === 'spiro@trophihospitality.com')?.id ?? null;
}

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
              <th className="px-4 py-3"></th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Invite</th>
              {isSpiro && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={isSpiro ? 10 : 9}>Loading…</td></tr>}
            {filtered.map((u) => (
              <TrophiUserRow key={u.id} u={u} isSpiro={isSpiro} onNavigate={() => navigate({ to: '/users/trophi/$userId', params: { userId: u.id } })} />
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr><td className="px-4 py-6 text-muted-foreground text-center" colSpan={isSpiro ? 10 : 9}>No users found</td></tr>
            )}

          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddTrophiUserDialog
          users={users ?? []}
          onClose={() => setShowAdd(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['users'] })}
        />
      )}
    </div>
  );
}

function AddTrophiUserDialog({ users, onClose, onSaved }: { users: AppUser[]; onClose: () => void; onSaved: () => void }) {
  const createUser = useServerFn(createTrophiUserFn);
  const updateUser = useServerFn(updateTrophiUserFn);
  const spiroId = findSpiroId(users);
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    role: 'sales_rep' as AppRole, team: 'TBD', hireDate: new Date().toISOString().slice(0, 10),
    trainerId: spiroId ?? '',
    mentorChoice: 'open' as 'open' | string,
  });
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const trainerOptions = useMemo(
    () => (spiroId ? [{ id: spiroId, label: 'Spiro Douvris' }] : []),
    [spiroId],
  );
  const mentorOptions = useMemo(
    () => (spiroId ? [{ id: spiroId, label: 'Spiro Douvris' }] : []),
    [spiroId],
  );

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const v = validateAvatarFile(f);
    if (!v.ok) { toast.error(v.error); return; }
    setCropFile(f);
  }

  const m = useMutation({
    mutationFn: async () => {
      const res: any = await createUser({ data: {
        firstName: form.firstName, lastName: form.lastName,
        email: form.email, phone: form.phone, role: form.role,
        team: form.team, hireDate: form.hireDate,
        trainerId: form.trainerId,
        mentorId: form.mentorChoice === 'open' ? null : form.mentorChoice,
      } as any });
      const newUserId = res?.userId;
      if (photoBlob && newUserId) {
        try {
          const path = await uploadAvatarBlob(newUserId, photoBlob);
          await updateUser({ data: { targetUserId: newUserId, avatarPath: path } as any });
        } catch (err: any) {
          toast.error(`User created but photo upload failed: ${err?.message ?? err}`);
        }
      }
    },
    onSuccess: () => { toast.success('User invited — check email to activate'); onSaved(); onClose(); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to create user'),
  });

  const canSubmit =
    form.firstName && form.lastName && form.email && form.phone &&
    form.role && form.team && form.hireDate && form.trainerId && form.mentorChoice;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold mb-4">New Trophi User</h2>

        <div className="mb-4 flex items-center gap-4">
          {photoPreview ? (
            <img src={photoPreview} alt="" className="h-16 w-16 rounded-full object-cover bg-muted" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-xs">No photo</div>
          )}
          <label className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
            <Upload className="h-3.5 w-3.5" /> {photoBlob ? 'Change photo' : 'Upload photo'}
            <input type="file" accept={AVATAR_ACCEPT} className="hidden" onChange={onPickPhoto} />
          </label>
          {photoBlob && (
            <button onClick={() => { setPhotoBlob(null); setPhotoPreview(null); }} className="text-xs text-muted-foreground hover:text-foreground">
              Remove
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="First name *"><Input value={form.firstName} onChange={v => setForm({ ...form, firstName: v })} /></Field>
          <Field label="Last name *"><Input value={form.lastName} onChange={v => setForm({ ...form, lastName: v })} /></Field>
          <Field label="Email *" className="col-span-2"><Input type="email" value={form.email} onChange={v => setForm({ ...form, email: v })} /></Field>
          <Field label="Phone *"><Input value={form.phone} onChange={v => setForm({ ...form, phone: formatPhoneInput(v) })} /></Field>
          <Field label="Team *">
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.team} onChange={e => setForm({ ...form, team: e.target.value })}>
              {TEAM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Role *">
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as AppRole })}>
              {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Hire date *"><Input type="date" value={form.hireDate} onChange={v => setForm({ ...form, hireDate: v })} /></Field>
          <Field label="Trainer *">
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.trainerId} onChange={e => setForm({ ...form, trainerId: e.target.value })}>
              <option value="" disabled>Select trainer…</option>
              {trainerOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Mentor *">
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.mentorChoice} onChange={e => setForm({ ...form, mentorChoice: e.target.value })}>
              <option value="open">Open</option>
              {mentorOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </Field>
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

      {cropFile && (
        <AvatarCropDialog
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={(blob, url) => {
            setPhotoBlob(blob);
            setPhotoPreview(url);
            setCropFile(null);
          }}
        />
      )}
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
