import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { AppRole } from '@/lib/users.functions';
import type {
  ReportPerson,
  ReportClient,
  ReportStatusHistory,
  ReportOnboardingRecord,
  ReportStepProgress,
  ReportStepDefinition,
} from '@/lib/reports.functions';

// ============================================================
// AWARDS + LEADERBOARD DATA
// - Awards table CRUD (admin grants; all Trophi roles view).
// - getLeaderboardDataFn returns the SAME numbers as the admin
//   reports view. It uses the service-role client so reps see
//   fair, uniform aggregates rather than RLS-scoped subsets.
//   Access is denied for client_admin (external accounts) only.
// ============================================================

export interface Award {
  id: string;
  name: string;
  periodType: 'monthly' | 'quarterly' | 'yearly';
  period: string;
  recipientUserId: string;
  metricKey: string | null;
  metricLabel: string | null;
  metricValue: number | null;
  awardedAt: string;
  awardedBy: string | null;
}

export interface LeaderboardData {
  people: ReportPerson[];
  clients: ReportClient[];
  statusHistory: ReportStatusHistory[];
  onboardingRecords: ReportOnboardingRecord[];
  stepProgress: ReportStepProgress[];
  stepDefinitions: ReportStepDefinition[];
  awards: Award[];
  viewerRole: AppRole;
  backfillCutoff: string;
}

const ROLE_RANK: Record<string, number> = {
  admin: 5, manager: 4, onboarding_specialist: 3, account_manager: 3, sales_rep: 2, client_admin: 1,
};

async function assertTrophiStaff(supabase: any, userId: string): Promise<AppRole> {
  const { data: roles, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId);
  if (error) throw error;
  const rows = (roles ?? []) as { role: AppRole }[];
  if (!rows.length) throw new Error('Forbidden');
  let best: AppRole = rows[0].role;
  for (const r of rows) {
    if ((ROLE_RANK[r.role] ?? 0) > (ROLE_RANK[best] ?? 0)) best = r.role;
  }
  if (best === 'client_admin') throw new Error('Forbidden');
  return best;
}

function mapAwards(rows: any[]): Award[] {
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    periodType: a.period_type,
    period: a.period,
    recipientUserId: a.recipient_user_id,
    metricKey: a.metric_key ?? null,
    metricLabel: a.metric_label ?? null,
    metricValue: a.metric_value !== null && a.metric_value !== undefined ? Number(a.metric_value) : null,
    awardedAt: a.awarded_at,
    awardedBy: a.awarded_by ?? null,
  }));
}

export const listAwardsFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Award[]> => {
    const { supabase, userId } = context;
    await assertTrophiStaff(supabase, userId);
    const { data, error } = await supabase
      .from('awards')
      .select('*')
      .order('awarded_at', { ascending: false });
    if (error) throw error;
    return mapAwards(data ?? []);
  });

export const grantAwardFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(120),
      periodType: z.enum(['monthly', 'quarterly', 'yearly']),
      period: z.string().trim().min(1).max(40),
      recipientUserId: z.string().uuid(),
      metricKey: z.string().trim().max(60).optional().nullable(),
      metricLabel: z.string().trim().max(120).optional().nullable(),
      metricValue: z.number().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<Award> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: userId, _role: 'admin' });
    if (!isAdmin) throw new Error('Forbidden: admin only');
    const { data: inserted, error } = await supabase
      .from('awards')
      .insert({
        name: data.name,
        period_type: data.periodType,
        period: data.period,
        recipient_user_id: data.recipientUserId,
        metric_key: data.metricKey ?? null,
        metric_label: data.metricLabel ?? null,
        metric_value: data.metricValue ?? null,
        awarded_by: userId,
      } as any)
      .select('*')
      .single();
    if (error) throw error;
    return mapAwards([inserted])[0];
  });

export const deleteAwardFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: userId, _role: 'admin' });
    if (!isAdmin) throw new Error('Forbidden: admin only');
    const { error } = await supabase.from('awards').delete().eq('id', data.id);
    if (error) throw error;
    return { ok: true };
  });

export const getLeaderboardDataFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LeaderboardData> => {
    const { supabase, userId } = context;
    const viewerRole = await assertTrophiStaff(supabase, userId);

    // Use service-role client so rep-visible boards show the same aggregates as admin view.
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    const [profilesR, rolesR, clientsR, locsR, historyR, recordsR, progressR, defsR, awardsR] = await Promise.all([
      supabaseAdmin.from('profiles').select('user_id, name, email, team'),
      supabaseAdmin.from('user_roles').select('user_id, role'),
      supabaseAdmin.from('clients').select('business_id, company, journey_status, sales_person_id, budget, created_at, approved_at, signed_at, signed_active_locations'),
      supabaseAdmin.from('locations').select('business_id, status'),
      supabaseAdmin.from('client_status_history').select('*').order('changed_at'),
      supabaseAdmin.from('onboarding_records').select('business_id, started_at, status, specialist_id, account_manager_id, went_live_at'),
      supabaseAdmin.from('onboarding_step_progress').select('business_id, step_number, status, started_at, completed_at, completed_by'),
      supabaseAdmin.from('onboarding_step_definitions').select('step_number, name, actor').order('step_number'),
      supabaseAdmin.from('awards').select('*').order('awarded_at', { ascending: false }),
    ]);
    for (const r of [profilesR, rolesR, clientsR, locsR, historyR, recordsR, progressR, defsR, awardsR]) {
      if ((r as any).error) throw (r as any).error;
    }

    const roleByUser = new Map<string, AppRole>();
    (rolesR.data ?? []).forEach((r: any) => {
      const cur = roleByUser.get(r.user_id);
      if (!cur || (ROLE_RANK[r.role] ?? 0) > (ROLE_RANK[cur] ?? 0)) roleByUser.set(r.user_id, r.role as AppRole);
    });
    const people: ReportPerson[] = (profilesR.data ?? []).map((p: any) => ({
      id: p.user_id, name: p.name, email: p.email, team: p.team ?? null,
      role: (roleByUser.get(p.user_id) ?? 'sales_rep') as AppRole,
    }));

    const activeLocByBiz = new Map<string, number>();
    (locsR.data ?? []).forEach((l: any) => {
      if (l.status === 'active') activeLocByBiz.set(l.business_id, (activeLocByBiz.get(l.business_id) ?? 0) + 1);
    });
    const clients: ReportClient[] = (clientsR.data ?? []).map((c: any) => ({
      businessId: c.business_id, company: c.company, journeyStatus: c.journey_status,
      salesPersonId: c.sales_person_id, budget: c.budget !== null ? Number(c.budget) : null,
      activeLocations: activeLocByBiz.get(c.business_id) ?? 0,
      signedActiveLocations: c.signed_active_locations !== null && c.signed_active_locations !== undefined
        ? Number(c.signed_active_locations) : null,
      createdAt: c.created_at, approvedAt: c.approved_at ?? null, signedAt: c.signed_at ?? null,
    }));

    const statusHistory: ReportStatusHistory[] = (historyR.data ?? []).map((h: any) => ({
      businessId: h.business_id, fromStatus: h.from_status, toStatus: h.to_status,
      changedAt: h.changed_at, changedBy: h.changed_by, changedByName: h.changed_by_name,
      source: h.source as 'live' | 'backfill',
    }));
    const onboardingRecords: ReportOnboardingRecord[] = (recordsR.data ?? []).map((r: any) => ({
      businessId: r.business_id, startedAt: r.started_at, status: r.status,
      specialistId: r.specialist_id, accountManagerId: r.account_manager_id, wentLiveAt: r.went_live_at,
    }));
    const stepProgress: ReportStepProgress[] = (progressR.data ?? []).map((s: any) => ({
      businessId: s.business_id, stepNumber: s.step_number, status: s.status,
      startedAt: s.started_at, completedAt: s.completed_at, completedBy: s.completed_by,
    }));
    const stepDefinitions: ReportStepDefinition[] = (defsR.data ?? []).map((d: any) => ({
      stepNumber: d.step_number, name: d.name, actor: d.actor,
    }));

    return {
      people, clients, statusHistory, onboardingRecords, stepProgress, stepDefinitions,
      awards: mapAwards(awardsR.data ?? []),
      viewerRole,
      backfillCutoff: new Date().toISOString().slice(0, 10),
    };
  });
