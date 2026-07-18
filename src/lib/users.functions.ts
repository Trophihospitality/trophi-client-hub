import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export type AppRole = 'admin' | 'manager' | 'sales_rep';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: AppRole;
}

function highestRole(rows: { role: string }[]): AppRole {
  const roles = rows.map((r) => r.role);
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('manager')) return 'manager';
  return 'sales_rep';
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

export const setUserRoleFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      targetUserId: z.string().uuid(),
      role: z.enum(['admin', 'manager', 'sales_rep']),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    // Replace all roles for the target user with the single chosen role.
    // The database trigger prevents demoting the last remaining admin.
    const { error: delErr } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', data.targetUserId)
      .neq('role', data.role);
    if (delErr) throw delErr;

    const { error: insErr } = await supabase
      .from('user_roles')
      .insert({ user_id: data.targetUserId, role: data.role } as any);
    // Ignore unique conflict — role already present.
    if (insErr && !/duplicate key/i.test(insErr.message)) throw insErr;

    return { ok: true };
  });
