import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export type ClientPermission = 'admin_full' | 'leadership' | 'manager';
export type ClientUserStatus = 'invited' | 'active' | 'inactive';
export type InviteStatus = 'accepted' | 'invited' | 'expired' | 'never_sent' | 'revoked' | 'failed';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function deriveInviteStatus(row: {
  status: ClientUserStatus;
  user_id?: string | null;
  invited_at?: string | null;
  invite_last_error?: string | null;
}): InviteStatus {
  if (row.user_id || row.status === 'active') return 'accepted';
  if (row.status === 'inactive') return 'revoked';
  if (row.invite_last_error) return 'failed';
  if (!row.invited_at) return 'never_sent';
  const ageMs = Date.now() - new Date(row.invited_at).getTime();
  return ageMs > INVITE_TTL_MS ? 'expired' : 'invited';
}

export interface ClientUser {
  id: string;
  userId: string | null;
  businessId: string;
  businessName: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  locationIds: string[];
  permissionLevel: ClientPermission;
  status: ClientUserStatus;
  invitedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  inviteSentTo: string | null;
  inviteExpiresAt: string | null;
  inviteStatus: InviteStatus;
}

async function writeAudit(admin: any, params: {
  actorId: string | null; actorEmail: string | null;
  action: string; entityType?: string; entityId?: string;
  before?: any; after?: any; metadata?: any; success?: boolean;
}) {
  await admin.from('audit_log').insert({
    actor_id: params.actorId, actor_email: params.actorEmail,
    actor_type: 'trophi', action: params.action,
    entity_type: params.entityType ?? null, entity_id: params.entityId ?? null,
    before: params.before ?? null, after: params.after ?? null,
    metadata: params.metadata ?? null, success: params.success ?? true,
  });
}

async function writeClientActivity(admin: any, params: {
  businessId: string; type: string; description: string; actor: string; actorId: string | null;
}) {
  try {
    await admin.from('client_activity').insert({
      business_id: params.businessId,
      type: params.type,
      description: params.description,
      actor: params.actor,
      actor_id: params.actorId,
    });
  } catch { /* non-fatal */ }
}

function mapClientUser(r: any): ClientUser {
  const inviteExpiresAt = r.invited_at
    ? new Date(new Date(r.invited_at).getTime() + INVITE_TTL_MS).toISOString()
    : null;
  return {
    id: r.id,
    userId: r.user_id ?? null,
    businessId: r.business_id,
    businessName: r.clients?.company ?? null,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone ?? null,
    locationIds: r.location_ids ?? [],
    permissionLevel: r.permission_level,
    status: r.status,
    invitedAt: r.invited_at ?? null,
    activatedAt: r.activated_at ?? null,
    createdAt: r.created_at,
    inviteSentTo: r.invite_sent_to ?? null,
    inviteExpiresAt,
    inviteStatus: deriveInviteStatus(r),
  };
}

export const listClientUsersFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClientUser[]> => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from('client_users')
      .select('*, clients:business_id(company)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapClientUser);
  });

export const listClientUsersForBusinessFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }): Promise<ClientUser[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from('client_users')
      .select('*, clients:business_id(company)')
      .eq('business_id', data.businessId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (rows ?? []).map(mapClientUser);
  });

const PermSchema = z.enum(['admin_full', 'leadership', 'manager']);

export const createClientUserFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      businessId: z.string().min(1),
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(80),
      email: z.string().trim().email().max(255),
      phone: z.string().trim().max(40).optional().nullable(),
      locationIds: z.array(z.string()).default([]),
      permissionLevel: PermSchema,
      sendInvite: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;

    // RLS on insert requires is_trophi_staff_for(business_id)
    const nowIso = new Date().toISOString();
    const { data: inserted, error: insErr } = await supabase.from('client_users').insert({
      business_id: data.businessId,
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      phone: data.phone || null,
      location_ids: data.locationIds,
      permission_level: data.permissionLevel,
      status: 'invited',
      invited_by: userId,
      invited_at: data.sendInvite ? nowIso : null,
      invite_sent_to: data.sendInvite ? data.email : null,
    } as any).select('*').single();
    if (insErr) throw insErr;

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    let inviteSent = false;
    if (data.sendInvite) {
      try {
        await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
          data: {
            name: `${data.firstName} ${data.lastName}`.trim(),
            client_user: true,
            business_id: data.businessId,
          },
        });
        inviteSent = true;
      } catch (e) {
        // Non-fatal; row is still created. Clear invite fields so UI shows never_sent.
        await supabaseAdmin.from('client_users')
          .update({ invited_at: null, invite_sent_to: null } as any)
          .eq('id', inserted.id);
      }
    }

    if (inviteSent) {
      await writeClientActivity(supabaseAdmin, {
        businessId: data.businessId, type: 'info_updated',
        description: `Portal invite sent to ${data.email} (${data.firstName} ${data.lastName})`,
        actor: (claims as any)?.email ?? 'system', actorId: userId,
      });
    }

    await writeAudit(supabaseAdmin, {
      actorId: userId, actorEmail: (claims as any)?.email ?? null,
      action: 'client_user.create', entityType: 'client_user', entityId: inserted.id,
      after: { email: data.email, business_id: data.businessId, permission: data.permissionLevel, invite_sent: inviteSent },
    });

    return { ok: true, id: inserted.id };
  });

export const updateClientUserFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      firstName: z.string().trim().min(1).max(80).optional(),
      lastName: z.string().trim().min(1).max(80).optional(),
      email: z.string().trim().email().max(255).optional(),
      permissionLevel: PermSchema.optional(),
      locationIds: z.array(z.string()).optional(),
      status: z.enum(['invited', 'active', 'inactive']).optional(),
      phone: z.string().trim().max(40).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;

    const { data: before } = await supabase.from('client_users').select('*').eq('id', data.id).maybeSingle();
    if (!before) throw new Error('Client user not found');

    const patch: any = { updated_at: new Date().toISOString() };
    if (data.permissionLevel !== undefined) patch.permission_level = data.permissionLevel;
    if (data.locationIds !== undefined) patch.location_ids = data.locationIds;
    if (data.status !== undefined) {
      patch.status = data.status;
      if (data.status === 'inactive') patch.deactivated_at = new Date().toISOString();
      if (data.status === 'active') patch.activated_at = new Date().toISOString();
    }
    if (data.phone !== undefined) patch.phone = data.phone || null;
    if (data.firstName !== undefined) patch.first_name = data.firstName;
    if (data.lastName !== undefined) patch.last_name = data.lastName;

    // Email change handling: if email changes on an unaccepted (invited/expired) user,
    // invalidate any outstanding invite links by clearing invited_at + invite_sent_to.
    let emailChangedWhileInvited = false;
    if (data.email !== undefined && data.email.toLowerCase() !== (before.email ?? '').toLowerCase()) {
      patch.email = data.email;
      const accepted = !!before.user_id || before.status === 'active';
      if (!accepted) {
        patch.invited_at = null;
        patch.invite_sent_to = null;
        emailChangedWhileInvited = true;
      }
    }

    const { error } = await supabase.from('client_users').update(patch).eq('id', data.id);
    if (error) throw error;

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    await writeAudit(supabaseAdmin, {
      actorId: userId, actorEmail: (claims as any)?.email ?? null,
      action: 'client_user.update', entityType: 'client_user', entityId: data.id,
      before: { email: before.email, permission: before.permission_level, status: before.status, locations: before.location_ids },
      after: patch,
      metadata: emailChangedWhileInvited ? { email_changed_while_invited: true, previous_email: before.email } : null,
    });

    if (emailChangedWhileInvited) {
      await writeClientActivity(supabaseAdmin, {
        businessId: before.business_id, type: 'info_updated',
        description: `Client user email changed from ${before.email} to ${data.email}; prior invite links invalidated`,
        actor: (claims as any)?.email ?? 'system', actorId: userId,
      });
    }

    return { ok: true, emailChangedWhileInvited };
  });

export const resendClientInviteFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const { data: row, error } = await supabase.from('client_users').select('*').eq('id', data.id).single();
    if (error) throw error;
    if (row.user_id || row.status === 'active') {
      throw new Error('This user has already accepted their invite');
    }
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    // Best-effort: delete any prior unconfirmed auth user for the current email so
    // the fresh invite issues a brand-new token (invalidating any old link).
    try {
      const { data: existing } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const priorList = (existing?.users ?? []).filter(
        (u: any) => u.email?.toLowerCase() === row.email.toLowerCase() && !u.email_confirmed_at && !u.last_sign_in_at,
      );
      for (const u of priorList) {
        try { await supabaseAdmin.auth.admin.deleteUser(u.id); } catch { /* ignore */ }
      }
    } catch { /* ignore - not critical */ }

    try {
      await supabaseAdmin.auth.admin.inviteUserByEmail(row.email, {
        data: { name: `${row.first_name} ${row.last_name}`.trim(), client_user: true, business_id: row.business_id },
      });
    } catch (e: any) {
      throw new Error(e?.message || 'Failed to resend invite');
    }
    const nowIso = new Date().toISOString();
    await supabase.from('client_users')
      .update({ invited_at: nowIso, invite_sent_to: row.email, status: 'invited' } as any)
      .eq('id', data.id);
    await writeAudit(supabaseAdmin, {
      actorId: userId, actorEmail: (claims as any)?.email ?? null,
      action: 'client_user.invite_resend', entityType: 'client_user', entityId: data.id,
      after: { sent_to: row.email }, metadata: { previous_invite_invalidated: true },
    });
    await writeClientActivity(supabaseAdmin, {
      businessId: row.business_id, type: 'info_updated',
      description: `Portal invite resent to ${row.email} (${row.first_name} ${row.last_name}); prior links invalidated`,
      actor: (claims as any)?.email ?? 'system', actorId: userId,
    });
    return { ok: true, sentTo: row.email };
  });

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorType: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: any;
  after: any;
  metadata: any;
  success: boolean;
  createdAt: string;
}

export const listAuditLogFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      limit: z.number().int().min(1).max(500).default(200),
      search: z.string().trim().optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<AuditLogEntry[]> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: userId, _role: 'admin' });
    if (!isAdmin) throw new Error('Forbidden: admin only');

    let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(data.limit);
    if (data.search && data.search.length > 0) {
      q = q.or(`action.ilike.%${data.search}%,actor_email.ilike.%${data.search}%,entity_id.ilike.%${data.search}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      actorId: r.actor_id,
      actorEmail: r.actor_email,
      actorType: r.actor_type,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      before: r.before,
      after: r.after,
      metadata: r.metadata,
      success: r.success,
      createdAt: r.created_at,
    }));
  });
