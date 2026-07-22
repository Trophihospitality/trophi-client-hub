import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { AppRole } from '@/lib/users.functions';

// ============================================================
// REPORTS DATA FETCH — admin/manager only.
// Returns raw rows; all aggregation happens client-side to keep
// the surface flexible while filters change.
// ============================================================

export interface ReportPerson {
  id: string;
  name: string;
  email: string;
  team: string | null;
  role: AppRole;
}
export interface ReportClient {
  businessId: string;
  company: string;
  journeyStatus: string;
  salesPersonId: string;
  budget: number | null;
  activeLocations: number;
  signedActiveLocations: number | null;
  createdAt: string;
  approvedAt: string | null;
  signedAt: string | null;
}
export interface ReportStatusHistory {
  businessId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
  changedBy: string | null;
  changedByName: string | null;
  source: 'live' | 'backfill';
}
export interface ReportOnboardingRecord {
  businessId: string;
  startedAt: string;
  status: 'active' | 'live';
  specialistId: string | null;
  accountManagerId: string | null;
  wentLiveAt: string | null;
}
export interface ReportStepProgress {
  businessId: string;
  stepNumber: number;
  status: 'locked' | 'in_progress' | 'complete';
  startedAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
}
export interface ReportStepDefinition {
  stepNumber: number;
  name: string;
  actor: 'account_owner' | 'system' | 'client' | 'specialist' | 'account_manager';
}
export interface ReportData {
  people: ReportPerson[];
  clients: ReportClient[];
  statusHistory: ReportStatusHistory[];
  onboardingRecords: ReportOnboardingRecord[];
  stepProgress: ReportStepProgress[];
  stepDefinitions: ReportStepDefinition[];
  backfillCutoff: string; // ISO date — history <= this date is reconstructed
}

const ROLE_RANK: Record<string, number> = {
  admin: 5, manager: 4, onboarding_specialist: 3, account_manager: 3, sales_rep: 2, client_admin: 1,
};

export const getReportDataFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReportData> => {
    const { supabase, userId } = context;
    const [{ data: isAdmin }, { data: isManager }] = await Promise.all([
      supabase.rpc('has_role', { _user_id: userId, _role: 'admin' }),
      supabase.rpc('has_role', { _user_id: userId, _role: 'manager' }),
    ]);
    if (!isAdmin && !isManager) throw new Error('Forbidden: admin or manager only');

    const [profilesR, rolesR, clientsR, locsR, historyR, recordsR, progressR, defsR] = await Promise.all([
      supabase.from('profiles').select('user_id, name, email, team'),
      supabase.from('user_roles').select('user_id, role'),
      supabase.from('clients').select('business_id, company, journey_status, sales_person_id, budget, created_at, approved_at, signed_at, signed_active_locations'),
      supabase.from('locations').select('business_id, status'),
      supabase.from('client_status_history').select('*').order('changed_at'),
      supabase.from('onboarding_records').select('business_id, started_at, status, specialist_id, account_manager_id, went_live_at'),
      supabase.from('onboarding_step_progress').select('business_id, step_number, status, started_at, completed_at, completed_by'),
      supabase.from('onboarding_step_definitions').select('step_number, name, actor').order('step_number'),
    ]);

    for (const r of [profilesR, rolesR, clientsR, locsR, historyR, recordsR, progressR, defsR]) {
      if ((r as any).error) throw (r as any).error;
    }

    // people with highest role
    const roleByUser = new Map<string, string>();
    (rolesR.data ?? []).forEach((r: any) => {
      const cur = roleByUser.get(r.user_id);
      if (!cur || (ROLE_RANK[r.role] ?? 0) > (ROLE_RANK[cur] ?? 0)) roleByUser.set(r.user_id, r.role);
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
      backfillCutoff: new Date().toISOString().slice(0, 10),
    };
  });
