import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export type AppRole = 'admin' | 'manager' | 'sales_rep' | 'onboarding_specialist' | 'account_manager' | 'client_admin';

const ROLE_RANK: Record<AppRole, number> = {
  admin: 5, manager: 4, onboarding_specialist: 3, account_manager: 3, sales_rep: 2, client_admin: 1,
};

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: AppRole;
}

function highestRole(rows: { role: string }[]): AppRole {
  let best: AppRole = 'sales_rep';
  for (const r of rows) {
    const role = r.role as AppRole;
    if ((ROLE_RANK[role] ?? 0) > ROLE_RANK[best]) best = role;
  }
  return best;
}

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc('has_role', { _user_id: userId, _role: 'admin' });
  if (error) throw error;
  if (!data) throw new Error('Forbidden: admin only');
}

export const listUsersFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AppUser[]> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
      supabase.from('profiles').select('user_id, name, email').order('name'),
      supabase.from('user_roles').select('user_id, role'),
    ]);
    if (pErr) throw pErr;
    if (rErr) throw rErr;
    const byUser = new Map<string, { role: string }[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push({ role: r.role });
      byUser.set(r.user_id, arr);
    });
    return (profiles ?? []).map((p: any) => ({
      id: p.user_id,
      name: p.name,
      email: p.email,
      role: highestRole(byUser.get(p.user_id) ?? []),
    }));
  });

const AssignableRole = z.enum(['admin', 'manager', 'sales_rep', 'onboarding_specialist', 'account_manager']);

export const setUserRoleFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      targetUserId: z.string().uuid(),
      role: AssignableRole,
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    // Replace all Trophi-staff roles with the single chosen one.
    // (client_admin is client-scoped and managed elsewhere; not touched here.)
    const { error: delErr } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', data.targetUserId)
      .in('role', ['admin', 'manager', 'sales_rep', 'onboarding_specialist', 'account_manager'])
      .neq('role', data.role);
    if (delErr) throw delErr;

    const { error: insErr } = await supabase
      .from('user_roles')
      .insert({ user_id: data.targetUserId, role: data.role } as any);
    if (insErr && !/duplicate key/i.test(insErr.message)) throw insErr;

    return { ok: true };
  });
