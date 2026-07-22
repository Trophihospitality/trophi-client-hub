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
  team: string | null;
  employeeId: number | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  hireDate: string | null;
  hireRole: AppRole | null;
  mentorId: string | null;
  currentRoleStartedAt: string | null;
  isActive: boolean;
  avatarPath: string | null;
  avatarUrl: string | null;
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

async function assertSpiro(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc('is_spiro', { _user_id: userId });
  if (error) throw error;
  if (!data) throw new Error('Forbidden: only Spiro (Employee 01) can perform this action');
}

async function writeAudit(admin: any, params: {
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: any;
  after?: any;
  metadata?: any;
  success?: boolean;
}) {
  await admin.from('audit_log').insert({
    actor_id: params.actorId,
    actor_email: params.actorEmail,
    actor_type: 'trophi',
    action: params.action,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
    before: params.before ?? null,
    after: params.after ?? null,
    metadata: params.metadata ?? null,
    success: params.success ?? true,
  });
}

export const listUsersFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AppUser[]> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
      supabase.from('profiles').select('*').order('employee_id', { ascending: true, nullsFirst: false }),
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
    const withPaths = (profiles ?? []).map((p: any) => ({
      id: p.user_id,
      name: p.name,
      email: p.email,
      team: p.team ?? null,
      role: highestRole(byUser.get(p.user_id) ?? []),
      employeeId: p.employee_id ?? null,
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      phone: p.phone ?? null,
      hireDate: p.hire_date ?? null,
      hireRole: p.hire_role ?? null,
      mentorId: p.mentor_id ?? null,
      currentRoleStartedAt: p.current_role_started_at ?? null,
      isActive: p.is_active !== false,
      avatarPath: p.avatar_path ?? null,
    }));

    // Batch sign avatar URLs (1h). Failures leave avatarUrl null; the UI falls back to initials.
    const signed = await Promise.all(
      withPaths.map(async (u) => {
        if (!u.avatarPath) return { ...u, avatarUrl: null as string | null };
        const { data } = await supabase.storage.from('trophi-avatars').createSignedUrl(u.avatarPath, 3600);
        return { ...u, avatarUrl: data?.signedUrl ?? null };
      }),
    );
    return signed;
  });

const AssignableRole = z.enum(['admin', 'manager', 'sales_rep', 'onboarding_specialist', 'account_manager']);

export const setUserRoleFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      targetUserId: z.string().uuid(),
      role: AssignableRole,
      trainerId: z.string().uuid(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await assertSpiro(supabase, userId);

    const { data: existing } = await supabase.from('user_roles').select('role').eq('user_id', data.targetUserId);
    const prevRoles = (existing ?? []).map((r: any) => r.role);

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

    // Update role start date — trigger closes prior open role_history row
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('profiles')
      .update({ current_role_started_at: today } as any)
      .eq('user_id', data.targetUserId);

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    // Insert new open role_history row with trainer for this role stint
    await supabaseAdmin.from('role_history').insert({
      user_id: data.targetUserId,
      role: data.role,
      started_on: today,
      trainer_id: data.trainerId,
      changed_by: userId,
    } as any);

    await writeAudit(supabaseAdmin, {
      actorId: userId,
      actorEmail: (claims as any)?.email ?? null,
      action: 'user.role.change',
      entityType: 'profile',
      entityId: data.targetUserId,
      before: { roles: prevRoles },
      after: { role: data.role, trainerId: data.trainerId },
    });

    return { ok: true };
  });

export const setUserTeamFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      targetUserId: z.string().uuid(),
      team: z.string().trim().max(80).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSpiro(supabase, userId);
    const team = data.team && data.team.length > 0 ? data.team : null;
    const { error } = await supabase.from('profiles').update({ team } as any).eq('user_id', data.targetUserId);
    if (error) throw error;
    return { ok: true };
  });

export const createTrophiUserFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(80),
      email: z.string().trim().email().max(255),
      phone: z.string().trim().min(1).max(40),
      role: AssignableRole,
      team: z.string().trim().min(1).max(80),
      hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      mentorId: z.string().uuid().nullable(),
      trainerId: z.string().uuid(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await assertSpiro(supabase, userId);

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { ACCEPT_INVITE_URL } = await import('./app-urls');

    const name = `${data.firstName} ${data.lastName}`.trim();

    const { data: invite, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: { name, first_name: data.firstName, last_name: data.lastName },
      redirectTo: ACCEPT_INVITE_URL,
    });
    if (inviteErr) {
      await writeAudit(supabaseAdmin, {
        actorId: userId, actorEmail: (claims as any)?.email ?? null,
        action: 'trophi_user.create', entityType: 'profile',
        after: { email: data.email }, success: false, metadata: { error: inviteErr.message },
      });
      throw new Error(inviteErr.message || 'Failed to invite user');
    }
    const newUserId = invite.user?.id;
    if (!newUserId) throw new Error('Invite returned no user id');

    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    const { error: updErr } = await supabaseAdmin.from('profiles').update({
      name,
      first_name: data.firstName,
      last_name: data.lastName,
      phone: data.phone,
      team: data.team,
      hire_date: data.hireDate || today,
      hire_role: data.role,
      mentor_id: data.mentorId,
      mentor_status: 'assigned',
      mentor_assigned_at: nowIso,
      current_role_started_at: data.hireDate || today,
      is_active: true,
      invited_at: nowIso,
      invite_last_attempt_at: nowIso,
      invite_last_error: null,
    } as any).eq('user_id', newUserId);
    if (updErr) throw updErr;


    await supabaseAdmin.from('user_roles').delete().eq('user_id', newUserId);
    await supabaseAdmin.from('user_roles').insert({ user_id: newUserId, role: data.role } as any);

    await supabaseAdmin.from('role_history').insert({
      user_id: newUserId,
      role: data.role,
      started_on: data.hireDate || today,
      trainer_id: data.trainerId,
      changed_by: userId,
    } as any);

    await writeAudit(supabaseAdmin, {
      actorId: userId, actorEmail: (claims as any)?.email ?? null,
      action: 'trophi_user.create', entityType: 'profile', entityId: newUserId,
      after: { email: data.email, role: data.role, name, trainerId: data.trainerId, mentorId: data.mentorId },
    });

    return { ok: true, userId: newUserId };
  });

export const setUserActiveFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ targetUserId: z.string().uuid(), isActive: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await assertSpiro(supabase, userId);
    if (data.targetUserId === userId && !data.isActive) {
      throw new Error('You cannot deactivate yourself');
    }
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { error } = await supabaseAdmin.from('profiles')
      .update({ is_active: data.isActive } as any)
      .eq('user_id', data.targetUserId);
    if (error) throw error;

    // Ban / unban auth user so they truly cannot log in
    try {
      await supabaseAdmin.auth.admin.updateUserById(data.targetUserId, {
        ban_duration: data.isActive ? 'none' : '876600h', // ~100 years
      } as any);
    } catch {
      // Best-effort; non-fatal
    }

    await writeAudit(supabaseAdmin, {
      actorId: userId, actorEmail: (claims as any)?.email ?? null,
      action: data.isActive ? 'trophi_user.activate' : 'trophi_user.deactivate',
      entityType: 'profile', entityId: data.targetUserId,
      after: { is_active: data.isActive },
    });
    return { ok: true };
  });


export interface RoleHistoryEntry {
  id: string;
  role: AppRole;
  startedOn: string;
  endedOn: string | null;
  trainerId: string | null;
  changedBy: string | null;
}

export const listRoleHistoryFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ targetUserId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<RoleHistoryEntry[]> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: rows, error } = await supabase
      .from('role_history')
      .select('id, role, started_on, ended_on, trainer_id, changed_by')
      .eq('user_id', data.targetUserId)
      .order('started_on', { ascending: false });
    if (error) throw error;
    return (rows ?? []).map((r: any) => ({
      id: r.id, role: r.role, startedOn: r.started_on, endedOn: r.ended_on,
      trainerId: r.trainer_id ?? null, changedBy: r.changed_by ?? null,
    }));
  });

export const updateTrophiUserFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      targetUserId: z.string().uuid(),
      firstName: z.string().trim().min(1).max(80).optional(),
      lastName: z.string().trim().min(1).max(80).optional(),
      phone: z.string().trim().min(1).max(40).optional(),
      team: z.string().trim().min(1).max(80).optional(),
      hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      hireRole: AssignableRole.nullable().optional(),
      mentorId: z.string().uuid().nullable().optional(),
      currentRoleStartedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      avatarPath: z.string().trim().max(300).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;

    // Authorization:
    // - Spiro can edit any field on any user.
    // - Anyone else can edit ONLY their own record, and ONLY phone + avatarPath.
    const { data: isSpiro } = await supabase.rpc('is_spiro', { _user_id: userId });
    if (!isSpiro) {
      if (data.targetUserId !== userId) {
        throw new Error('Forbidden: only Spiro can edit other users');
      }
      const allowed = new Set(['targetUserId', 'phone', 'avatarPath']);
      const attempted = Object.entries(data).filter(([k, v]) => v !== undefined && !allowed.has(k));
      if (attempted.length > 0) {
        throw new Error('Forbidden: you may only update your photo and phone number');
      }
    }

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    const { data: before } = await supabaseAdmin.from('profiles').select('*').eq('user_id', data.targetUserId).maybeSingle();

    const patch: Record<string, unknown> = {};
    if (data.firstName !== undefined) patch.first_name = data.firstName;
    if (data.lastName !== undefined) patch.last_name = data.lastName;
    if (data.firstName !== undefined || data.lastName !== undefined) {
      const fn = data.firstName ?? before?.first_name ?? '';
      const ln = data.lastName ?? before?.last_name ?? '';
      patch.name = `${fn} ${ln}`.trim();
    }
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.team !== undefined) patch.team = data.team;
    if (data.hireDate !== undefined) patch.hire_date = data.hireDate;
    if (data.hireRole !== undefined) patch.hire_role = data.hireRole;
    if (data.currentRoleStartedAt !== undefined) patch.current_role_started_at = data.currentRoleStartedAt;
    if (data.avatarPath !== undefined) patch.avatar_path = data.avatarPath;
    if (data.mentorId !== undefined) {
      const prevMentor = before?.mentor_id ?? null;
      if (prevMentor !== data.mentorId) {
        patch.mentor_id = data.mentorId;
        patch.mentor_status = 'assigned';
        patch.mentor_assigned_at = new Date().toISOString();
      }
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabaseAdmin.from('profiles').update(patch as any).eq('user_id', data.targetUserId);
      if (error) throw error;
    }

    await writeAudit(supabaseAdmin, {
      actorId: userId, actorEmail: (claims as any)?.email ?? null,
      action: isSpiro ? 'trophi_user.update' : 'trophi_user.self_update',
      entityType: 'profile', entityId: data.targetUserId,
      before, after: patch,
    });
    return { ok: true };
  });

