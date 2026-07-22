import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

// ============================================================
// ONBOARDING SERVER FUNCTIONS
// Step engine. Direct writes to onboarding tables are blocked
// by RLS; all mutations happen here as SECURITY DEFINER via
// service-role admin client, gated by explicit auth checks.
// ============================================================

export type StepStatus = 'locked' | 'in_progress' | 'complete';
export type OnboardingStatus = 'active' | 'live';
export type StepActor = 'account_owner' | 'system' | 'client' | 'specialist' | 'account_manager';

export interface StepDefinition {
  stepNumber: number;
  name: string;
  actor: StepActor;
  clientVisible: boolean;
}

export interface StepProgress {
  stepNumber: number;
  status: StepStatus;
  startedAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
}

export interface OnboardingListRow {
  businessId: string;
  company: string;
  brands: string[];
  activeLocations: number;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  packageType: string;
  budget: number | null;
  salesPersonId: string;
  salesPersonName: string;
  specialistId: string | null;
  specialistName: string | null;
  accountManagerId: string | null;
  accountManagerName: string | null;
  startedAt: string;
  currentStep: number;
  currentStepName: string;
  currentStepActor: StepActor;
  currentStepStartedAt: string | null;
  status: OnboardingStatus;
  waitingOn: 'client' | 'trophi' | 'system';
  incoming: boolean; // specialist can preview but not edit
}

export interface OnboardingDetail extends OnboardingListRow {
  paymentScope: 'brand' | 'per_location' | null;
  paymentScopeRecordedAt: string | null;
  steps: (StepDefinition & StepProgress)[];
  activity: {
    id: string;
    type: string;
    description: string;
    actor: string;
    timestamp: string;
  }[];
}


async function loadProfileMap(supabase: any, ids: string[]) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (uniq.length === 0) return new Map<string, { name: string; email: string }>();
  const { data } = await supabase.from('profiles').select('user_id, name, email').in('user_id', uniq);
  const m = new Map<string, { name: string; email: string }>();
  (data ?? []).forEach((p: any) => m.set(p.user_id, { name: p.name, email: p.email }));
  return m;
}

function actorWaitingOn(actor: StepActor): 'client' | 'trophi' | 'system' {
  if (actor === 'client') return 'client';
  if (actor === 'system') return 'system';
  return 'trophi';
}

export const listOnboardingFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingListRow[]> => {
    const { supabase, userId } = context;
    // RLS already filters visible records. We fetch what we can see.
    const { data: records, error } = await supabase
      .from('onboarding_records')
      .select('*')
      .order('started_at', { ascending: false });
    if (error) throw error;
    if (!records || records.length === 0) return [];

    const bizIds = records.map((r: any) => r.business_id);
    const [{ data: clients }, { data: locs }, { data: defs }] = await Promise.all([
      supabase.from('clients').select('*').in('business_id', bizIds),
      supabase.from('locations').select('business_id, status').in('business_id', bizIds),
      supabase.from('onboarding_step_definitions').select('*'),
    ]);
    const defMap = new Map<number, any>();
    (defs ?? []).forEach((d: any) => defMap.set(d.step_number, d));
    const clientMap = new Map<string, any>();
    (clients ?? []).forEach((c: any) => clientMap.set(c.business_id, c));
    const locCount = new Map<string, number>();
    (locs ?? []).forEach((l: any) => {
      if (l.status === 'active') locCount.set(l.business_id, (locCount.get(l.business_id) ?? 0) + 1);
    });

    // Load step progress for currentStep started_at
    const { data: progs } = await supabase
      .from('onboarding_step_progress')
      .select('business_id, step_number, status, started_at')
      .in('business_id', bizIds);
    const progMap = new Map<string, any>();
    (progs ?? []).forEach((p: any) => {
      if (p.status === 'in_progress') progMap.set(p.business_id, p);
    });

    const profileIds: string[] = [];
    records.forEach((r: any) => {
      const c = clientMap.get(r.business_id);
      if (c?.sales_person_id) profileIds.push(c.sales_person_id);
      if (r.specialist_id) profileIds.push(r.specialist_id);
      if (r.account_manager_id) profileIds.push(r.account_manager_id);
    });
    const profs = await loadProfileMap(supabase, profileIds);

    // Determine incoming (specialist role, not assigned, step 1–5)
    const { data: myRoles } = await supabase.from('user_roles').select('role').eq('user_id', userId);
    const roles = new Set((myRoles ?? []).map((r: any) => r.role));
    const isSpecialistViewer = roles.has('onboarding_specialist') && !roles.has('admin') && !roles.has('manager');

    return records.map((r: any): OnboardingListRow => {
      const c = clientMap.get(r.business_id) ?? {};
      const def = defMap.get(r.current_step) ?? { name: '', actor: 'system', client_visible: false };
      const prog = progMap.get(r.business_id);
      const incoming = !!isSpecialistViewer && r.specialist_id !== userId && r.current_step >= 1 && r.current_step <= 5;
      return {
        businessId: r.business_id,
        company: c.company ?? '',
        brands: c.brands ?? [],
        activeLocations: locCount.get(r.business_id) ?? 0,
        contactName: c.contact_name ?? '',
        contactEmail: c.contact_email ?? '',
        contactPhone: c.contact_phone ?? '',
        packageType: c.package_type ?? '',
        budget: c.budget ?? null,
        salesPersonId: c.sales_person_id ?? '',
        salesPersonName: profs.get(c.sales_person_id)?.name ?? '—',
        specialistId: r.specialist_id,
        specialistName: r.specialist_id ? profs.get(r.specialist_id)?.name ?? '—' : null,
        accountManagerId: r.account_manager_id,
        accountManagerName: r.account_manager_id ? profs.get(r.account_manager_id)?.name ?? '—' : null,
        startedAt: r.started_at,
        currentStep: r.current_step,
        currentStepName: def.name,
        currentStepActor: def.actor as StepActor,
        currentStepStartedAt: prog?.started_at ?? null,
        status: r.status as OnboardingStatus,
        waitingOn: actorWaitingOn(def.actor as StepActor),
        incoming,
      };
    });
  });

export const getOnboardingDetailFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string() }).parse(d))
  .handler(async ({ data, context }): Promise<OnboardingDetail | null> => {
    const { supabase } = context;
    const { data: rec, error } = await supabase
      .from('onboarding_records').select('*').eq('business_id', data.businessId).maybeSingle();
    if (error) throw error;
    if (!rec) return null;

    const [{ data: client }, { data: locs }, { data: defs }, { data: progs }, { data: activity }] =
      await Promise.all([
        supabase.from('clients').select('*').eq('business_id', data.businessId).maybeSingle(),
        supabase.from('locations').select('business_id, status').eq('business_id', data.businessId),
        supabase.from('onboarding_step_definitions').select('*').order('step_number'),
        supabase.from('onboarding_step_progress').select('*').eq('business_id', data.businessId),
        supabase.from('client_activity').select('*').eq('business_id', data.businessId)
          .order('timestamp', { ascending: false }).limit(50),
      ]);

    const profs = await loadProfileMap(supabase, [
      client?.sales_person_id, rec.specialist_id, rec.account_manager_id,
    ].filter((x): x is string => !!x));

    const progMap = new Map<number, any>();
    (progs ?? []).forEach((p: any) => progMap.set(p.step_number, p));
    const currentDef = (defs ?? []).find((d: any) => d.step_number === rec.current_step);
    const activeLocs = (locs ?? []).filter((l: any) => l.status === 'active').length;

    const steps = (defs ?? []).map((d: any) => {
      const p = progMap.get(d.step_number);
      return {
        stepNumber: d.step_number,
        name: d.name,
        actor: d.actor as StepActor,
        clientVisible: d.client_visible,
        status: (p?.status ?? 'locked') as StepStatus,
        startedAt: p?.started_at ?? null,
        completedAt: p?.completed_at ?? null,
        completedBy: p?.completed_by ?? null,
      };
    });

    const inProg = steps.find((s) => s.status === 'in_progress');

    return {
      businessId: rec.business_id,
      company: client?.company ?? '',
      brands: client?.brands ?? [],
      activeLocations: activeLocs,
      contactName: client?.contact_name ?? '',
      contactEmail: client?.contact_email ?? '',
      contactPhone: client?.contact_phone ?? '',
      packageType: client?.package_type ?? '',
      budget: client?.budget ?? null,
      salesPersonId: client?.sales_person_id ?? '',
      salesPersonName: (client?.sales_person_id && profs.get(client.sales_person_id)?.name) || '—',
      specialistId: rec.specialist_id,
      specialistName: rec.specialist_id ? profs.get(rec.specialist_id)?.name ?? '—' : null,
      accountManagerId: rec.account_manager_id,
      accountManagerName: rec.account_manager_id ? profs.get(rec.account_manager_id)?.name ?? '—' : null,
      startedAt: rec.started_at,
      currentStep: rec.current_step,
      currentStepName: currentDef?.name ?? '',
      currentStepActor: (currentDef?.actor ?? 'system') as StepActor,
      currentStepStartedAt: inProg?.startedAt ?? null,
      status: rec.status as OnboardingStatus,
      waitingOn: actorWaitingOn((currentDef?.actor ?? 'system') as StepActor),
      incoming: false,
      paymentScope: (rec.payment_scope ?? null) as 'brand' | 'per_location' | null,
      paymentScopeRecordedAt: rec.payment_scope_recorded_at ?? null,
      steps,
      activity: (activity ?? []).map((a: any) => ({
        id: a.id, type: a.type, description: a.description, actor: a.actor, timestamp: a.timestamp,
      })),
    };
  });

// ---------- Assignment candidates ----------
export interface AssignmentCandidate {
  id: string;
  name: string;
  email: string;
  activeCount: number;
}

async function listCandidatesByRole(
  supabase: any,
  role: 'onboarding_specialist' | 'account_manager',
  assignmentColumn: 'specialist_id' | 'account_manager_id',
): Promise<AssignmentCandidate[]> {
  const { data: roleRows } = await supabase
    .from('user_roles').select('user_id, role').in('role', [role, 'admin']);
  const ids = Array.from(new Set((roleRows ?? []).map((r: any) => r.user_id)));
  if (ids.length === 0) return [];
  const { data: profiles } = await supabase.from('profiles').select('user_id, name, email').in('user_id', ids);
  const { data: counts } = await supabase
    .from('onboarding_records').select(assignmentColumn + ', status').eq('status', 'active').in(assignmentColumn, ids);
  const countMap = new Map<string, number>();
  (counts ?? []).forEach((c: any) => {
    const key = c[assignmentColumn];
    if (!key) return;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  });
  return (profiles ?? []).map((p: any) => ({
    id: p.user_id, name: p.name, email: p.email,
    activeCount: countMap.get(p.user_id) ?? 0,
  }));
}

export const listSpecialistCandidatesFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    listCandidatesByRole(context.supabase, 'onboarding_specialist', 'specialist_id'));

export const listAccountManagerCandidatesFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    listCandidatesByRole(context.supabase, 'account_manager', 'account_manager_id'));

// ---------- Step engine ----------
async function assertCanEditOnboarding(supabase: any, userId: string, businessId: string) {
  // Fetch record + client owner + user roles in parallel
  const [{ data: rec }, { data: client }, { data: rolesRows }] = await Promise.all([
    supabase.from('onboarding_records').select('*').eq('business_id', businessId).maybeSingle(),
    supabase.from('clients').select('sales_person_id').eq('business_id', businessId).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
  ]);
  if (!rec) throw new Error('Onboarding record not found');
  const roles = new Set((rolesRows ?? []).map((r: any) => r.role));
  const isAdmin = roles.has('admin');
  const isManager = roles.has('manager');
  const isOwner = client?.sales_person_id === userId;
  const isSpecialist = rec.specialist_id === userId;
  const isAM = rec.account_manager_id === userId;
  return { rec, client, roles, isAdmin, isManager, isOwner, isSpecialist, isAM };
}

function canActOnStep(
  actor: StepActor,
  ctx: { isAdmin: boolean; isManager: boolean; isOwner: boolean; isSpecialist: boolean; isAM: boolean },
) {
  if (ctx.isAdmin) return true;
  switch (actor) {
    case 'account_owner': return ctx.isOwner || ctx.isManager;
    case 'system': return ctx.isOwner || ctx.isManager;
    case 'client': return ctx.isOwner || ctx.isManager; // Trophi can mark on client's behalf
    case 'specialist': return ctx.isSpecialist || ctx.isManager;
    case 'account_manager': return ctx.isAM || ctx.isManager;
  }
}

export const completeStepFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ businessId: z.string(), stepNumber: z.number().int().min(1).max(16) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const ctx = await assertCanEditOnboarding(supabase, userId, data.businessId);

    const { data: defs } = await supabase.from('onboarding_step_definitions').select('*').order('step_number');
    const def = (defs ?? []).find((d: any) => d.step_number === data.stepNumber);
    if (!def) throw new Error('Unknown step');
    if (!canActOnStep(def.actor as StepActor, ctx)) throw new Error('Forbidden: not the actor for this step');

    const { data: prog } = await supabase
      .from('onboarding_step_progress').select('*')
      .eq('business_id', data.businessId).eq('step_number', data.stepNumber).maybeSingle();
    if (!prog) throw new Error('Step not initialised');
    if (prog.status === 'complete') throw new Error('Step already complete');
    if (prog.status === 'locked') throw new Error('Step is locked');

    // Assignment steps require the person to be assigned before completion
    if (data.stepNumber === 6 && !ctx.rec.specialist_id)
      throw new Error('Assign an onboarding specialist before completing step 6');
    if (data.stepNumber === 13 && !ctx.rec.account_manager_id)
      throw new Error('Assign an account manager before completing step 13');

    // Step 2 requires the account owner to have recorded the payment scope
    // (brand vs per_location). No document is created at Step 2; that decision
    // drives Step 5's Stripe capture + Payment Authorization generation.
    if (data.stepNumber === 2 && !ctx.rec.payment_scope)
      throw new Error('Record the payment scope (brand or per-location) before completing step 2');


    // Load admin client for writes (blocked by RLS otherwise)
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    const now = new Date().toISOString();
    await supabaseAdmin.from('onboarding_step_progress').update({
      status: 'complete', completed_at: now, completed_by: userId,
    }).eq('id', prog.id);

    // Determine next step: strict except that completing 1 unlocks 2 immediately
    let nextStep: number | null = data.stepNumber + 1;
    if (data.stepNumber === 16) nextStep = null;

    // Special: completing 1 also starts 2 (owner can do both back-to-back).
    // Otherwise, we start the sequential next step.
    if (nextStep !== null && nextStep <= 16) {
      // Only start next step if it isn't already started/completed
      const { data: nextProg } = await supabaseAdmin
        .from('onboarding_step_progress').select('*')
        .eq('business_id', data.businessId).eq('step_number', nextStep).maybeSingle();
      if (nextProg && nextProg.status === 'locked') {
        await supabaseAdmin.from('onboarding_step_progress').update({
          status: 'in_progress', started_at: now,
        }).eq('id', nextProg.id);
      }
    }

    const updates: any = {};
    if (nextStep !== null) updates.current_step = nextStep;
    if (data.stepNumber === 16) { updates.status = 'live'; updates.went_live_at = now; }
    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from('onboarding_records').update(updates).eq('business_id', data.businessId);
    }

    await supabaseAdmin.from('client_activity').insert({
      business_id: data.businessId,
      type: 'info_updated',
      description: `Onboarding step ${data.stepNumber} complete: ${def.name}`,
      actor: (await supabaseAdmin.from('profiles').select('name').eq('user_id', userId).maybeSingle()).data?.name ?? 'User',
    });

    // Step 4 = contract bundle fully executed → auto-flip CRM journey to "Signed".
    // (This is also the hook the PandaDoc webhook will call after countersignature.)
    if (data.stepNumber === 4) {
      const { data: curClient } = await supabaseAdmin.from('clients')
        .select('journey_status').eq('business_id', data.businessId).maybeSingle();
      if (curClient && curClient.journey_status !== 'Signed') {
        await supabaseAdmin.from('clients')
          .update({ journey_status: 'Signed' })
          .eq('business_id', data.businessId);
        await supabaseAdmin.from('client_activity').insert({
          business_id: data.businessId,
          type: 'status_change',
          description: `Status changed: ${curClient.journey_status} → Signed · Contract bundle fully executed`,
          actor: 'System',
        });
      }
    }

    // ------------------------------------------------------------------
    // Auto POC portal invite: fires on ANY Step 1 → complete transition.
    // Path-agnostic by design (normal generation, reconciliation, manual
    // admin completion, any future flow that ends up in completeStepFn).
    // Idempotent: safe to call repeatedly. Failures are recorded on the
    // client_users row and audit; they do NOT roll back the step.
    // ------------------------------------------------------------------
    if (data.stepNumber === 1) {
      try {
        const { ensurePocInviteInternal } = await import('./client-users.functions');
        const result = await ensurePocInviteInternal(supabaseAdmin, data.businessId, userId);
        if (!result.ok && result.error) {
          console.error(`[onboarding] Step 1 auto POC invite failed for ${data.businessId}:`, result.error);
        }
      } catch (err) {
        console.error(`[onboarding] Step 1 auto POC invite crashed for ${data.businessId}:`, err);
      }
    }

    return { ok: true, nextStep };
  });

export const assignSpecialistFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ businessId: z.string(), userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId: caller } = context;
    const ctx = await assertCanEditOnboarding(supabase, caller, data.businessId);
    if (!ctx.isAdmin && !ctx.isManager && !ctx.isOwner) throw new Error('Forbidden');
    if (ctx.rec.current_step < 6) throw new Error('Specialist can only be assigned once Step 6 is active');

    // Verify the target user actually has onboarding_specialist (or admin) role
    const { data: targetRoles } = await supabase.from('user_roles').select('role').eq('user_id', data.userId);
    const roleSet = new Set((targetRoles ?? []).map((r: any) => r.role));
    if (!roleSet.has('onboarding_specialist') && !roleSet.has('admin'))
      throw new Error('User is not an onboarding specialist');

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    await supabaseAdmin.from('onboarding_records').update({ specialist_id: data.userId }).eq('business_id', data.businessId);
    await supabaseAdmin.from('client_activity').insert({
      business_id: data.businessId, type: 'info_updated',
      description: 'Onboarding specialist assigned',
      actor: (await supabaseAdmin.from('profiles').select('name').eq('user_id', caller).maybeSingle()).data?.name ?? 'User',
    });
    return { ok: true };
  });

export const assignAccountManagerFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ businessId: z.string(), userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId: caller } = context;
    const ctx = await assertCanEditOnboarding(supabase, caller, data.businessId);
    if (!ctx.isAdmin && !ctx.isManager && !ctx.isOwner) throw new Error('Forbidden');
    if (ctx.rec.current_step < 13) throw new Error('Account manager can only be assigned once Step 13 is active');

    const { data: targetRoles } = await supabase.from('user_roles').select('role').eq('user_id', data.userId);
    const roleSet = new Set((targetRoles ?? []).map((r: any) => r.role));
    if (!roleSet.has('account_manager') && !roleSet.has('admin'))
      throw new Error('User is not an account manager');

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    await supabaseAdmin.from('onboarding_records').update({ account_manager_id: data.userId }).eq('business_id', data.businessId);
    await supabaseAdmin.from('client_activity').insert({
      business_id: data.businessId, type: 'info_updated',
      description: 'Account manager assigned',
      actor: (await supabaseAdmin.from('profiles').select('name').eq('user_id', caller).maybeSingle()).data?.name ?? 'User',
    });
    return { ok: true };
  });

// Records the payment scope on onboarding_records. Account owner /
// manager / admin only. Allowed at any active step (defensive), but the
// UI surfaces the control on Step 2. Changing scope after Step 5 has
// generated a Payment Authorization is blocked here — regenerate via the
// Payment Authorization panel instead.
export const setPaymentScopeFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      businessId: z.string(),
      paymentScope: z.enum(['brand', 'per_location']),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const ctx = await assertCanEditOnboarding(supabase, userId, data.businessId);
    if (!ctx.isAdmin && !ctx.isManager && !ctx.isOwner)
      throw new Error('Only the account owner, a manager, or an admin can set the payment scope');

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    // Block scope change once a Payment Authorization document exists in a
    // non-void state. Regen must be explicit from the Payment Auth panel.
    const { data: existing } = await supabaseAdmin
      .from('client_contracts')
      .select('id, status')
      .eq('business_id', data.businessId)
      .eq('kind', 'payment_authorization')
      .not('status', 'eq', 'void')
      .limit(1);
    if ((existing ?? []).length > 0 && ctx.rec.payment_scope && ctx.rec.payment_scope !== data.paymentScope) {
      throw new Error('A Payment Authorization already exists. Void it before changing scope.');
    }

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from('onboarding_records')
      .update({
        payment_scope: data.paymentScope,
        payment_scope_recorded_at: now,
        payment_scope_recorded_by: userId,
      })
      .eq('business_id', data.businessId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from('client_activity').insert({
      business_id: data.businessId,
      type: 'info_updated',
      description: `Payment scope set to ${data.paymentScope === 'brand' ? 'Brand-wide (single method)' : 'Per-location (one method per active location)'}`,
      actor: (await supabaseAdmin.from('profiles').select('name').eq('user_id', userId).maybeSingle()).data?.name ?? 'User',
    });

    return { ok: true, paymentScope: data.paymentScope, paymentScopeRecordedAt: now };
  });
