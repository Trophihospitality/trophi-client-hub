import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import {
  listUsersFn, listRoleHistoryFn, updateTrophiUserFn, setUserRoleFn, setUserActiveFn,
  type AppRole, type AppUser,
} from '@/lib/users.functions';
import { getLeaderboardDataFn } from '@/lib/awards.functions';
import { useAuth } from '@/store/userStore';
import { formatPhone, formatPhoneInput } from '@/lib/phone';
import { AvatarCircle } from '@/components/ui/avatar-circle';
import { uploadAvatarBlob, validateAvatarFile, AVATAR_ACCEPT } from '@/lib/avatar';
import { AvatarCropDialog } from '@/components/ui/avatar-crop-dialog';
import { ArrowLeft, Pencil, X, Check, Trophy, Upload } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/users/trophi/$userId')({
  component: TrophiUserDetail,
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

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}
function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}
function daysBetween(a: string, b: string) {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}

function TrophiUserDetail() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const isSpiro = useIsSpiro();
  const { profile, refreshAvatar } = useAuth();
  const isSelf = profile?.id === userId;
  const editMode: 'admin' | 'self' | 'none' = isSpiro ? 'admin' : (isSelf ? 'self' : 'none');

  const listUsers = useServerFn(listUsersFn);
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => listUsers(),
  });
  const user = useMemo(() => (users ?? []).find(u => u.id === userId), [users, userId]);
  const mentor = useMemo(() => user?.mentorId ? (users ?? []).find(u => u.id === user.mentorId) : null, [users, user]);

  const [tab, setTab] = useState<'summary' | 'history' | 'activity'>('summary');

  if (usersLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!user) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate({ to: '/users/trophi' })} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div>User not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/users/trophi" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All Trophi Users
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <AvatarCircle name={user.name} url={user.avatarUrl ?? null} size={72} />
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-mono">
                Employee #{user.employeeId !== null ? String(user.employeeId).padStart(2, '0') : '—'}
              </div>
              <h1 className="font-display text-2xl font-semibold mt-0.5">{user.name}</h1>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <span className="capitalize">{user.role.replace(/_/g, ' ')}</span>
                <span>·</span>
                <span>{user.team ?? 'No team'}</span>
                <span>·</span>
                <span className={user.isActive ? 'text-emerald-700' : 'text-muted-foreground'}>
                  {user.isActive ? 'Active' : 'Inactive'}
                </span>
                {editMode === 'self' && <><span>·</span><span className="text-[hsl(var(--trophi-gold))]">Your profile</span></>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === 'summary'} onClick={() => setTab('summary')}>Employee Summary</TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>Role History</TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>Recent Activity</TabButton>
      </div>

      {tab === 'summary' && (
        <SummaryTab user={user} mentor={mentor ?? null} users={users ?? []} editMode={editMode} onAvatarChanged={refreshAvatar} />
      )}
      {tab === 'history' && <HistoryTab user={user} users={users ?? []} />}
      {tab === 'activity' && <ActivityTab user={user} />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? 'border-[hsl(var(--trophi-gold))] text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

/* ================ Summary Tab ================ */
function SummaryTab({ user, mentor, users, editMode, onAvatarChanged }: {
  user: AppUser; mentor: AppUser | null; users: AppUser[];
  editMode: 'admin' | 'self' | 'none';
  onAvatarChanged: () => Promise<void> | void;
}) {
  const canEdit = editMode !== 'none';
  const isSelfOnly = editMode === 'self';
  const qc = useQueryClient();
  const update = useServerFn(updateTrophiUserFn);
  const setRole = useServerFn(setUserRoleFn);
  const setActive = useServerFn(setUserActiveFn);
  const [editing, setEditing] = useState(false);
  const spiroId = users.find(u => u.email.toLowerCase() === 'spiro@trophihospitality.com')?.id ?? null;
  const [form, setForm] = useState({
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    phone: user.phone ?? '',
    team: user.team && (user.team === 'TBD' || user.team === 'Other') ? user.team : 'TBD',
    hireDate: user.hireDate ?? '',
    hireRole: (user.hireRole ?? user.role) as AppRole,
    mentorChoice: (user.mentorId ?? 'open') as string,
    role: user.role,
    currentRoleStartedAt: user.currentRoleStartedAt ?? '',
    isActive: user.isActive,
    trainerId: spiroId ?? '',
  });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      phone: user.phone ?? '',
      team: user.team && (user.team === 'TBD' || user.team === 'Other') ? user.team : 'TBD',
      hireDate: user.hireDate ?? '',
      hireRole: (user.hireRole ?? user.role) as AppRole,
      mentorChoice: (user.mentorId ?? 'open') as string,
      role: user.role,
      currentRoleStartedAt: user.currentRoleStartedAt ?? '',
      isActive: user.isActive,
      trainerId: spiroId ?? '',
    });
    setPhotoFile(null);
    setPhotoPreview(null);
  }, [user, spiroId]);

  const roleChanged = !isSelfOnly && form.role !== user.role && form.role !== 'client_admin';

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast.error('Image must be under 5 MB'); return; }
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  }

  const saveM = useMutation({
    mutationFn: async () => {
      if (!form.phone.trim()) throw new Error('Phone is required');

      // Upload avatar first (if changed). Users may only upload to their own folder;
      // admin (Spiro) has global rights via storage policy.
      let newAvatarPath: string | null | undefined;
      if (photoFile) {
        const blob = await cropToSquareJpeg(photoFile);
        newAvatarPath = await uploadAvatarBlob(user.id, blob);
      }

      if (isSelfOnly) {
        // Self-service: only phone + avatar are allowed by the server.
        await update({ data: {
          targetUserId: user.id,
          phone: form.phone,
          ...(newAvatarPath !== undefined ? { avatarPath: newAvatarPath } : {}),
        } as any });
      } else {
        if (roleChanged && !form.trainerId) throw new Error('Select a trainer for the new role');
        await update({ data: {
          targetUserId: user.id,
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone,
          team: form.team,
          hireDate: form.hireDate || null,
          hireRole: form.hireRole,
          mentorId: form.mentorChoice === 'open' ? null : form.mentorChoice,
          currentRoleStartedAt: form.currentRoleStartedAt || null,
          ...(newAvatarPath !== undefined ? { avatarPath: newAvatarPath } : {}),
        } as any });
        if (roleChanged) {
          await setRole({ data: { targetUserId: user.id, role: form.role, trainerId: form.trainerId } as any });
        }
        if (form.isActive !== user.isActive) {
          await setActive({ data: { targetUserId: user.id, isActive: form.isActive } });
        }
      }
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['role-history', user.id] });
      if (photoFile) await onAvatarChanged();
      toast.success('Profile updated');
      setEditing(false);
      setPhotoFile(null);
      setPhotoPreview(null);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to update'),
  });

  const previewUrl = photoPreview ?? user.avatarUrl ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold">Profile</h2>
            {canEdit && !editing && (
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <Pencil className="h-3.5 w-3.5" /> {isSelfOnly ? 'Edit my profile' : 'Edit'}
              </button>
            )}
            {editing && (
              <div className="flex gap-2">
                <button onClick={() => { setEditing(false); setPhotoFile(null); setPhotoPreview(null); }} className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-sm">
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <button disabled={saveM.isPending} onClick={() => saveM.mutate()} className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--trophi-gold))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--trophi-ink))] disabled:opacity-60">
                  <Check className="h-3.5 w-3.5" /> {saveM.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>

          {editing && isSelfOnly && (
            <div className="mb-4 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              You can update your <strong>photo</strong> and <strong>phone number</strong>. Contact your admin to update any other field.
            </div>
          )}

          {editing && (
            <div className="mb-5 flex items-center gap-4">
              <AvatarCircle name={user.name} url={previewUrl} size={64} />
              <label className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
                <Upload className="h-3.5 w-3.5" /> {photoFile ? 'Change photo' : 'Upload photo'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onPickPhoto} />
              </label>
              {photoFile && (
                <button onClick={() => { setPhotoFile(null); setPhotoPreview(null); }} className="text-xs text-muted-foreground hover:text-foreground">
                  Discard change
                </button>
              )}
            </div>
          )}

          {!editing ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <Info label="Employee ID" value={user.employeeId !== null ? String(user.employeeId).padStart(2, '0') : '—'} mono />
              <Info label="Full name" value={user.name} />
              <Info label="Email" value={user.email} />
              <Info label="Phone" value={user.phone ? formatPhone(user.phone) : '—'} />
              <Info label="Hire date" value={fmtDate(user.hireDate)} />
              <Info label="Hire role" value={user.hireRole ? user.hireRole.replace(/_/g, ' ') : '—'} capitalize />
              <Info label="Current role" value={user.role.replace(/_/g, ' ')} capitalize />
              <Info label="Role started" value={fmtDate(user.currentRoleStartedAt)} />
              <Info label="Team" value={user.team ?? '—'} />
              <Info label="Mentor" value={mentor?.name ?? 'Open'} />
              <Info label="Status" value={user.isActive ? 'Active' : 'Inactive'} />
            </dl>
          ) : isSelfOnly ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <F label="First name"><I value={user.firstName ?? ''} disabled onChange={() => {}} /></F>
              <F label="Last name"><I value={user.lastName ?? ''} disabled onChange={() => {}} /></F>
              <F label="Email"><I value={user.email} disabled onChange={() => {}} /></F>
              <F label="Phone (editable)"><I value={form.phone} onChange={v => setForm({ ...form, phone: formatPhoneInput(v) })} /></F>
              <F label="Team"><I value={user.team ?? ''} disabled onChange={() => {}} /></F>
              <F label="Role"><I value={user.role.replace(/_/g, ' ')} disabled onChange={() => {}} /></F>
              <F label="Hire date"><I type="date" value={user.hireDate ?? ''} disabled onChange={() => {}} /></F>
              <F label="Status"><I value={user.isActive ? 'Active' : 'Inactive'} disabled onChange={() => {}} /></F>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <F label="First name"><I value={form.firstName} onChange={v => setForm({ ...form, firstName: v })} /></F>
              <F label="Last name"><I value={form.lastName} onChange={v => setForm({ ...form, lastName: v })} /></F>
              <F label="Email"><I value={user.email} disabled onChange={() => {}} /></F>
              <F label="Phone"><I value={form.phone} onChange={v => setForm({ ...form, phone: formatPhoneInput(v) })} /></F>
              <F label="Hire date"><I type="date" value={form.hireDate} onChange={v => setForm({ ...form, hireDate: v })} /></F>
              <F label="Hire role">
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.hireRole} onChange={e => setForm({ ...form, hireRole: e.target.value as AppRole })}>
                  {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </F>
              <F label="Current role">
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as AppRole })}>
                  {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </F>
              <F label="Role started"><I type="date" value={form.currentRoleStartedAt} onChange={v => setForm({ ...form, currentRoleStartedAt: v })} /></F>
              <F label="Team">
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.team} onChange={e => setForm({ ...form, team: e.target.value })}>
                  <option value="TBD">TBD</option>
                  <option value="Other">Other</option>
                </select>
              </F>
              <F label="Mentor">
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.mentorChoice} onChange={e => setForm({ ...form, mentorChoice: e.target.value })}>
                  <option value="open">Open</option>
                  {spiroId && <option value={spiroId}>Spiro Douvris</option>}
                </select>
              </F>
              {roleChanged && (
                <F label="Trainer for new role *">
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.trainerId} onChange={e => setForm({ ...form, trainerId: e.target.value })}>
                    <option value="" disabled>Select trainer…</option>
                    {spiroId && <option value={spiroId}>Spiro Douvris</option>}
                  </select>
                </F>
              )}
              <F label="Status">
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.isActive ? 'yes' : 'no'} onChange={e => setForm({ ...form, isActive: e.target.value === 'yes' })}>
                  <option value="yes">Active</option>
                  <option value="no">Inactive</option>
                </select>
              </F>
            </div>
          )}
        </div>

        <StatsStrip user={user} />
      </div>

      <div className="space-y-6">
        <AwardsCard userId={user.id} />
      </div>
    </div>
  );
}

function Info({ label, value, mono, capitalize }: { label: string; value: React.ReactNode; mono?: boolean; capitalize?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 ${mono ? 'font-mono text-xs' : ''} ${capitalize ? 'capitalize' : ''}`}>{value}</dd>
    </div>
  );
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
function I({ value, onChange, type = 'text', disabled }: { value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return (
    <input type={type} value={value} disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60" />
  );
}

/* ================ Stats Strip ================ */
function StatsStrip({ user }: { user: AppUser }) {
  const load = useServerFn(getLeaderboardDataFn);
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard-data'],
    queryFn: () => load(),
  });
  if (isLoading || !data) {
    return <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading stats…</div>;
  }

  const stats = computeUserStats(user, data);
  if (stats.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="font-display text-lg font-semibold mb-4">Current period</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg bg-muted/30 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="mt-1 font-display text-xl font-semibold">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function computeUserStats(user: AppUser, data: any): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const role = user.role;
  const involvedSales = data.clients.some((c: any) => c.salesPersonId === user.id);
  const involvedOnboarding = data.onboardingRecords.some((r: any) => r.specialistId === user.id);
  const involvedAcctMgr = data.onboardingRecords.some((r: any) => r.accountManagerId === user.id);

  if (role === 'sales_rep' || role === 'manager' || role === 'admin' || involvedSales) {
    const mine = data.clients.filter((c: any) => c.salesPersonId === user.id);
    const signed = mine.filter((c: any) => c.signedAt);
    const signedSum = signed.reduce((s: number, c: any) => s + (c.budget ?? 0), 0);
    const convRate = mine.length ? Math.round((signed.length / mine.length) * 100) : 0;
    const daysList = signed
      .filter((c: any) => c.approvedAt && c.signedAt)
      .map((c: any) => daysBetween(c.approvedAt, c.signedAt));
    const avgDays = daysList.length ? Math.round(daysList.reduce((a: number, b: number) => a + b, 0) / daysList.length) : null;

    out.push({ label: 'Signed $', value: fmtMoney(signedSum) });
    out.push({ label: 'Signed #', value: String(signed.length) });
    out.push({ label: 'Conv rate', value: `${convRate}%` });
    out.push({ label: 'Avg Appr→Sign', value: avgDays !== null ? `${avgDays}d` : '—' });
  }
  if (role === 'onboarding_specialist' || involvedOnboarding) {
    const mine = data.onboardingRecords.filter((r: any) => r.specialistId === user.id);
    const live = mine.filter((r: any) => r.wentLiveAt);
    const durList = live.map((r: any) => daysBetween(r.startedAt, r.wentLiveAt));
    const avg = durList.length ? Math.round(durList.reduce((a: number, b: number) => a + b, 0) / durList.length) : null;
    out.push({ label: 'Go-lives', value: String(live.length) });
    out.push({ label: 'Avg total onboarding', value: avg !== null ? `${avg}d` : '—' });
  }
  if (role === 'account_manager' || involvedAcctMgr) {
    const mineRecs = data.onboardingRecords.filter((r: any) => r.accountManagerId === user.id);
    const activeBizIds = new Set(mineRecs.map((r: any) => r.businessId));
    const activeClients = data.clients.filter((c: any) => activeBizIds.has(c.businessId));
    const monthlyTotal = activeClients.reduce((s: number, c: any) => s + (c.budget ?? 0) * (c.activeLocations || 1), 0);
    out.push({ label: 'Active clients', value: String(activeClients.length) });
    out.push({ label: 'Monthly $ managed', value: fmtMoney(monthlyTotal) });
  }
  return out;
}

/* ================ Awards ================ */
function AwardsCard({ userId }: { userId: string }) {
  const load = useServerFn(getLeaderboardDataFn);
  const { data } = useQuery({ queryKey: ['leaderboard-data'], queryFn: () => load() });
  const awards = (data?.awards ?? []).filter((a: any) => a.recipientUserId === userId);

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-4 w-4 text-[hsl(var(--trophi-gold))]" />
        <h2 className="font-display text-lg font-semibold">Awards</h2>
      </div>
      {awards.length === 0 ? (
        <div className="text-sm text-muted-foreground">No awards yet.</div>
      ) : (
        <ul className="space-y-3">
          {awards.map((a: any) => (
            <li key={a.id} className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">{a.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {a.period} · {a.periodType}
              </div>
              {a.metricLabel && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {a.metricLabel}{a.metricValue !== null ? `: ${a.metricValue.toLocaleString()}` : ''}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ================ Role History ================ */
function HistoryTab({ user, users }: { user: AppUser; users: AppUser[] }) {
  const list = useServerFn(listRoleHistoryFn);
  const { data, isLoading } = useQuery({
    queryKey: ['role-history', user.id],
    queryFn: () => list({ data: { targetUserId: user.id } }),
  });

  const nameFor = (id: string | null | undefined) => id ? (users.find(u => u.id === id)?.name ?? id.slice(0, 8)) : '—';

  const rows = useMemo(() => {
    const raw = (data ?? []) as any[];
    if (raw.length > 0) return raw;
    // Synthesize from profile fields so the tab is never empty for a hired user.
    const synth: any[] = [];
    if (user.hireRole && user.hireDate) {
      const hireOpen = !user.currentRoleStartedAt || user.currentRoleStartedAt === user.hireDate || user.hireRole === user.role;
      synth.push({
        id: 'synth-hire',
        role: user.hireRole,
        startedOn: user.hireDate,
        endedOn: hireOpen ? null : user.currentRoleStartedAt,
        trainerId: null,
        changedBy: null,
      });
      if (!hireOpen) {
        synth.push({
          id: 'synth-current',
          role: user.role,
          startedOn: user.currentRoleStartedAt,
          endedOn: null,
          trainerId: null,
          changedBy: null,
        });
      }
    }
    return synth.sort((a, b) => (b.startedOn > a.startedOn ? 1 : -1));
  }, [data, user]);

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="font-display text-lg font-semibold mb-4">Role progression</h2>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!isLoading && rows.length === 0 && (
        <div className="text-sm text-muted-foreground">No role history recorded.</div>
      )}
      {!isLoading && rows.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="px-2 py-2">Role</th>
              <th className="px-2 py-2">Started</th>
              <th className="px-2 py-2">Ended</th>
              <th className="px-2 py-2">Time in role</th>
              <th className="px-2 py-2">Trainer</th>
              <th className="px-2 py-2">Changed by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r: any) => {
              const end = r.endedOn ?? new Date().toISOString().slice(0, 10);
              const days = daysBetween(r.startedOn, end);
              return (
                <tr key={r.id}>
                  <td className="px-2 py-3 capitalize font-medium">{r.role.replace(/_/g, ' ')}</td>
                  <td className="px-2 py-3 text-muted-foreground">{fmtDate(r.startedOn)}</td>
                  <td className="px-2 py-3 text-muted-foreground">{r.endedOn ? fmtDate(r.endedOn) : 'Present'}</td>
                  <td className="px-2 py-3 text-muted-foreground">{days}d</td>
                  <td className="px-2 py-3 text-muted-foreground">{r.trainerId ? nameFor(r.trainerId) : '—'}</td>
                  <td className="px-2 py-3 text-muted-foreground">{r.changedBy ? nameFor(r.changedBy) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}


/* ================ Recent Activity ================ */
function ActivityTab({ user }: { user: AppUser }) {
  const load = useServerFn(getLeaderboardDataFn);
  const { data, isLoading } = useQuery({ queryKey: ['leaderboard-data'], queryFn: () => load() });

  if (isLoading || !data) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const involvedSales = data.clients.some((c: any) => c.salesPersonId === user.id);
  const involvedOnboarding = data.onboardingRecords.some((r: any) => r.specialistId === user.id);
  const involvedAcctMgr = data.onboardingRecords.some((r: any) => r.accountManagerId === user.id);

  const showSales = involvedSales || user.role === 'sales_rep' || user.role === 'admin' || user.role === 'manager';
  const showOnb = involvedOnboarding || user.role === 'onboarding_specialist';
  const showAM = involvedAcctMgr || user.role === 'account_manager';

  return (
    <div className="space-y-6">
      {showSales && <SalesActivity user={user} data={data} />}
      {showOnb && <OnboardingActivity user={user} data={data} />}
      {showAM && <AccountManagerActivity user={user} data={data} />}
      {!showSales && !showOnb && !showAM && (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No recent activity to show.
        </div>
      )}
    </div>
  );
}

function SalesActivity({ user, data }: { user: AppUser; data: any }) {
  const mine = data.clients.filter((c: any) => c.salesPersonId === user.id);
  const signed = mine.filter((c: any) => c.signedAt).sort((a: any, b: any) => (b.signedAt > a.signedAt ? 1 : -1));
  const lifetime = signed.reduce((s: number, c: any) => s + (c.budget ?? 0), 0);
  const last20 = signed.slice(0, 20);

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold">Sales — recent signed deals</h2>
        <div className="text-sm text-muted-foreground">
          Lifetime signed: <span className="font-medium text-foreground">{fmtMoney(lifetime)}</span> · {signed.length} deal{signed.length === 1 ? '' : 's'}
        </div>
      </div>
      {last20.length === 0 ? (
        <div className="text-sm text-muted-foreground">No signed deals yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="px-2 py-2">Company</th>
              <th className="px-2 py-2">Business ID</th>
              <th className="px-2 py-2">Signed</th>
              <th className="px-2 py-2 text-right">Monthly $</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {last20.map((c: any) => (
              <tr key={c.businessId}>
                <td className="px-2 py-3 font-medium">{c.company}</td>
                <td className="px-2 py-3 text-xs font-mono text-muted-foreground">{c.businessId}</td>
                <td className="px-2 py-3 text-muted-foreground">{fmtDate(c.signedAt)}</td>
                <td className="px-2 py-3 text-right">{fmtMoney(c.budget)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OnboardingActivity({ user, data }: { user: AppUser; data: any }) {
  const mine = data.onboardingRecords.filter((r: any) => r.specialistId === user.id);
  const active = mine.filter((r: any) => !r.wentLiveAt);
  const completed = mine.filter((r: any) => r.wentLiveAt)
    .sort((a: any, b: any) => (b.wentLiveAt > a.wentLiveAt ? 1 : -1))
    .slice(0, 10);
  const bizName = (id: string) => data.clients.find((c: any) => c.businessId === id)?.company ?? id;

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold mb-3">Currently active onboardings</h2>
        {active.length === 0 ? (
          <div className="text-sm text-muted-foreground">None active.</div>
        ) : (
          <ul className="divide-y divide-border">
            {active.map((r: any) => (
              <li key={r.businessId} className="py-2.5 text-sm flex items-center justify-between">
                <div>
                  <div className="font-medium">{bizName(r.businessId)}</div>
                  <div className="text-xs font-mono text-muted-foreground">{r.businessId}</div>
                </div>
                <div className="text-xs text-muted-foreground">Started {fmtDate(r.startedAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2 className="font-display text-lg font-semibold mb-3">Last 10 completed onboardings</h2>
        {completed.length === 0 ? (
          <div className="text-sm text-muted-foreground">No completed onboardings.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="px-2 py-2">Company</th>
                <th className="px-2 py-2">Business ID</th>
                <th className="px-2 py-2">Go-live</th>
                <th className="px-2 py-2 text-right">Total days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {completed.map((r: any) => (
                <tr key={r.businessId}>
                  <td className="px-2 py-3 font-medium">{bizName(r.businessId)}</td>
                  <td className="px-2 py-3 text-xs font-mono text-muted-foreground">{r.businessId}</td>
                  <td className="px-2 py-3 text-muted-foreground">{fmtDate(r.wentLiveAt)}</td>
                  <td className="px-2 py-3 text-right">{daysBetween(r.startedAt, r.wentLiveAt)}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AccountManagerActivity({ user, data }: { user: AppUser; data: any }) {
  const mineRecs = data.onboardingRecords.filter((r: any) => r.accountManagerId === user.id);
  const bizIds = new Set(mineRecs.map((r: any) => r.businessId));
  const clients = data.clients.filter((c: any) => bizIds.has(c.businessId));
  const recByBiz = new Map(mineRecs.map((r: any) => [r.businessId, r]));
  const monthlyTotal = clients.reduce((s: number, c: any) => s + (c.budget ?? 0) * (c.activeLocations || 1), 0);

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold">Account Manager — active clients</h2>
        <div className="text-sm text-muted-foreground">
          {clients.length} client{clients.length === 1 ? '' : 's'} · <span className="font-medium text-foreground">{fmtMoney(monthlyTotal)}</span>/mo
        </div>
      </div>
      {clients.length === 0 ? (
        <div className="text-sm text-muted-foreground">No active clients.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="px-2 py-2">Company</th>
              <th className="px-2 py-2">Business ID</th>
              <th className="px-2 py-2">Locations</th>
              <th className="px-2 py-2">Live date</th>
              <th className="px-2 py-2 text-right">Monthly $</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {clients.map((c: any) => {
              const rec = recByBiz.get(c.businessId) as any;
              return (
                <tr key={c.businessId}>
                  <td className="px-2 py-3 font-medium">{c.company}</td>
                  <td className="px-2 py-3 text-xs font-mono text-muted-foreground">{c.businessId}</td>
                  <td className="px-2 py-3 text-muted-foreground">{c.activeLocations}</td>
                  <td className="px-2 py-3 text-muted-foreground">{fmtDate(rec?.wentLiveAt)}</td>
                  <td className="px-2 py-3 text-right">{fmtMoney((c.budget ?? 0) * (c.activeLocations || 1))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
