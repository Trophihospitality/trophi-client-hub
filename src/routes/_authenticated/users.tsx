import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { listUsersFn, setUserRoleFn, setUserTeamFn, type AppRole } from '@/lib/users.functions';
import { useAuth } from '@/store/userStore';

export const Route = createFileRoute('/_authenticated/users')({
  component: UsersPage,
});

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'sales_rep', label: 'Sales Rep' },
  { value: 'onboarding_specialist', label: 'Onboarding Specialist' },
  { value: 'account_manager', label: 'Account Manager' },
];

function TeamCell({ userId, initial, disabled }: { userId: string; initial: string | null; disabled?: boolean }) {
  const qc = useQueryClient();
  const setTeam = useServerFn(setUserTeamFn);
  const [value, setValue] = useState(initial ?? '');
  const [dirty, setDirty] = useState(false);
  const mutation = useMutation({
    mutationFn: (v: { targetUserId: string; team: string | null }) => setTeam({ data: v }),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Team updated');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to update team'),
  });
  const commit = () => {
    if (!dirty) return;
    mutation.mutate({ targetUserId: userId, team: value.trim() || null });
  };
  return (
    <input
      className="w-40 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      placeholder="—"
      value={value}
      disabled={disabled || mutation.isPending}
      onChange={(e) => { setValue(e.target.value); setDirty(true); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function UsersPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const listUsers = useServerFn(listUsersFn);
  const setRole = useServerFn(setUserRoleFn);

  if (profile && profile.role !== 'admin') {
    throw redirect({ to: '/crm' });
  }

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => listUsers(),
  });

  const mutation = useMutation({
    mutationFn: (v: { targetUserId: string; role: AppRole }) => setRole({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Role updated');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to update role'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">User Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Change roles between Admin, Manager, and Sales Rep. Set an optional team label used in reporting filters.
          The last remaining admin cannot be demoted.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Team</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={4}>Loading…</td></tr>
            )}
            {(users ?? []).map((u) => {
              const isSelf = u.id === profile?.id;
              return (
                <tr key={u.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{u.name}{isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      value={u.role}
                      disabled={mutation.isPending}
                      onChange={(e) =>
                        mutation.mutate({ targetUserId: u.id, role: e.target.value as AppRole })
                      }
                    >
                      {ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <TeamCell userId={u.id} initial={u.team} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
