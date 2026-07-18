import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type {
  Client, ClientNote, ActivityEvent, JourneyStatus, Attachment,
  ContactMethod, ClientType, PackageType, Location, SalesPerson,
} from '@/lib/types';

// ============================================================
// CRM SERVER FUNCTIONS
// All ID generation happens in the database via triggers.
// Approved → Onboarding side-effects also handled by DB trigger.
// ============================================================

async function loadClient(supabase: any, businessId: string): Promise<Client | null> {
  const { data: c, error } = await supabase
    .from('clients').select('*').eq('business_id', businessId).maybeSingle();
  if (error) throw error;
  if (!c) return null;
  const [locs, notes, activity, attachments] = await Promise.all([
    supabase.from('locations').select('*').eq('business_id', businessId).order('location_id'),
    supabase.from('client_notes').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
    supabase.from('client_activity').select('*').eq('business_id', businessId).order('timestamp', { ascending: false }),
    supabase.from('client_attachments').select('*').eq('business_id', businessId).order('uploaded_at', { ascending: false }),
  ]);
  return rowToClient(c, locs.data ?? [], notes.data ?? [], activity.data ?? [], attachments.data ?? []);
}

function rowToClient(c: any, locs: any[], notes: any[], activity: any[], attachments: any[]): Client {
  return {
    businessId: c.business_id,
    company: c.company,
    brands: c.brands ?? [],
    clientType: c.client_type as ClientType,
    locations: locs.map((l): Location => ({
      locationId: l.location_id, businessId: l.business_id, name: l.name,
      address: l.address ?? '', city: l.city ?? '', state: l.state ?? '',
      status: (l.status ?? 'active') as 'active' | 'closed',
      needsOnboarding: !!l.needs_onboarding,
      closedAt: l.closed_at ?? undefined,
    })),
    journeyStatus: c.journey_status as JourneyStatus,
    lastContactDate: c.last_contact_date ?? '',
    lastContactMethod: (c.last_contact_method ?? 'None') as ContactMethod,
    contactName: c.contact_name ?? '',
    contactEmail: c.contact_email ?? '',
    contactPhone: c.contact_phone ?? '',
    isDecisionMaker: !!c.is_decision_maker,
    packageType: c.package_type as PackageType,
    budget: c.budget !== null ? Number(c.budget) : null,
    salesPersonId: c.sales_person_id,
    leadSource: c.lead_source ?? undefined,
    nextFollowUpDate: c.next_follow_up_date ?? undefined,
    notes: notes.map((n): ClientNote => ({
      id: n.id, authorName: n.author_name, body: n.body, createdAt: n.created_at,
    })),
    attachments: attachments.map((a): Attachment => ({
      id: a.id, fileName: a.file_name, fileType: a.file_type,
      fileSize: Number(a.file_size),
      dataUrl: a.storage_path, // storage_path in this column now; UI fetches signed URL on demand
      uploadedBy: a.uploaded_by_name, uploadedAt: a.uploaded_at,
    })),
    activity: activity.map((a): ActivityEvent => ({
      id: a.id, type: a.type as ActivityEvent['type'],
      description: a.description, actor: a.actor, timestamp: a.timestamp,
    })),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    sentToOnboarding: !!c.sent_to_onboarding,
    onboardingSentAt: c.onboarding_sent_at ?? undefined,
  };
}

async function actorName(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('name').eq('user_id', userId).maybeSingle();
  return data?.name ?? 'Unknown';
}

async function logActivity(
  supabase: any, businessId: string, type: string, description: string, actor: string, actorId: string,
) {
  await supabase.from('client_activity').insert({
    business_id: businessId, type, description, actor, actor_id: actorId,
  } as any);
}

// ---------- LIST ----------
export const listClients = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [{ data: clients, error }, locs, notes, activity, attachments] = await Promise.all([
      supabase.from('clients').select('*').order('created_at', { ascending: false }),
      supabase.from('locations').select('*'),
      supabase.from('client_notes').select('*').order('created_at', { ascending: false }),
      supabase.from('client_activity').select('*').order('timestamp', { ascending: false }),
      supabase.from('client_attachments').select('*').order('uploaded_at', { ascending: false }),
    ]);
    if (error) throw error;
    const byBiz = <T extends { business_id: string }>(rows: T[]) =>
      rows.reduce<Record<string, T[]>>((acc, r) => {
        (acc[r.business_id] ||= []).push(r); return acc;
      }, {});
    const L = byBiz(locs.data ?? []);
    const N = byBiz(notes.data ?? []);
    const A = byBiz(activity.data ?? []);
    const F = byBiz(attachments.data ?? []);
    return (clients ?? []).map(c => rowToClient(c, L[c.business_id] ?? [], N[c.business_id] ?? [], A[c.business_id] ?? [], F[c.business_id] ?? []));
  });

// ---------- SALES TEAM ----------
export const listSalesTeam = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SalesPerson[]> => {
    const { supabase } = context;
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase.from('profiles').select('user_id, name, email').order('name'),
      supabase.from('user_roles').select('user_id, role'),
    ]);
    const roleMap = new Map<string, 'admin' | 'manager' | 'sales_rep'>();
    (roles ?? []).forEach((r: any) => {
      const prev = roleMap.get(r.user_id);
      const rank = (x: string) => (x === 'admin' ? 2 : x === 'manager' ? 1 : 0);
      if (!prev || rank(r.role) > rank(prev)) roleMap.set(r.user_id, r.role);
    });
    return (profiles ?? []).map((p: any) => ({
      id: p.user_id, name: p.name, email: p.email,
      role: roleMap.get(p.user_id) ?? 'sales_rep',
    }));
  });

// ---------- CREATE ----------
const LocationInputSchema = z.object({
  name: z.string().min(1),
  address: z.string().default(''),
  city: z.string().default(''),
  state: z.string().default(''),
});
const CreateClientInput = z.object({
  company: z.string().min(1),
  brands: z.array(z.string()),
  clientType: z.string(),
  journeyStatus: z.string(),
  contactName: z.string().default(''),
  contactEmail: z.string().default(''),
  contactPhone: z.string().default(''),
  isDecisionMaker: z.boolean().default(false),
  packageType: z.string().default('TBD'),
  budget: z.number().nullable(),
  salesPersonId: z.string().uuid(),
  leadSource: z.string().optional(),
  locations: z.array(LocationInputSchema).min(1),
});

export const createClientFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateClientInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const name = await actorName(supabase, userId);
    const today = new Date().toISOString().slice(0, 10);
    const { data: inserted, error } = await supabase.from('clients').insert({
      company: data.company, brands: data.brands, client_type: data.clientType,
      journey_status: data.journeyStatus, last_contact_date: today,
      last_contact_method: 'None', contact_name: data.contactName,
      contact_email: data.contactEmail, contact_phone: data.contactPhone,
      is_decision_maker: data.isDecisionMaker, package_type: data.packageType,
      budget: data.budget, sales_person_id: data.salesPersonId,
      lead_source: data.leadSource ?? null,
    } as any).select('business_id, journey_status, sent_to_onboarding').single();
    if (error) throw error;
    const businessId = inserted.business_id;
    const { error: locErr } = await supabase.from('locations').insert(
      data.locations.map(l => ({ business_id: businessId, name: l.name, address: l.address, city: l.city, state: l.state })) as any
    );
    if (locErr) throw locErr;
    const desc = `Client created · ${data.locations.length} location${data.locations.length > 1 ? 's' : ''} registered`;
    await logActivity(supabase, businessId, 'created', desc, name, userId);
    if (inserted.sent_to_onboarding) {
      await logActivity(supabase, businessId, 'status_change',
        `Status changed: (new) → Approved · Sent to Onboarding`, name, userId);
    }
    return { businessId };
  });

// ---------- UPDATE ----------
const UpdateClientInput = z.object({
  businessId: z.string(),
  updates: z.object({
    company: z.string().optional(),
    brands: z.array(z.string()).optional(),
    contactName: z.string().optional(),
    contactEmail: z.string().optional(),
    contactPhone: z.string().optional(),
    isDecisionMaker: z.boolean().optional(),
    packageType: z.string().optional(),
    budget: z.number().nullable().optional(),
    salesPersonId: z.string().uuid().optional(),
    lastContactDate: z.string().optional(),
    lastContactMethod: z.string().optional(),
    nextFollowUpDate: z.string().optional().nullable(),
  }),
});

export const updateClientFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateClientInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const name = await actorName(supabase, userId);
    const patch: any = {};
    const u = data.updates;
    if (u.company !== undefined) patch.company = u.company;
    if (u.brands !== undefined) patch.brands = u.brands;
    if (u.contactName !== undefined) patch.contact_name = u.contactName;
    if (u.contactEmail !== undefined) patch.contact_email = u.contactEmail;
    if (u.contactPhone !== undefined) patch.contact_phone = u.contactPhone;
    if (u.isDecisionMaker !== undefined) patch.is_decision_maker = u.isDecisionMaker;
    if (u.packageType !== undefined) patch.package_type = u.packageType;
    if (u.budget !== undefined) patch.budget = u.budget;
    if (u.salesPersonId !== undefined) patch.sales_person_id = u.salesPersonId;
    if (u.lastContactDate !== undefined) patch.last_contact_date = u.lastContactDate || null;
    if (u.lastContactMethod !== undefined) patch.last_contact_method = u.lastContactMethod;
    if (u.nextFollowUpDate !== undefined) patch.next_follow_up_date = u.nextFollowUpDate || null;
    const { error } = await supabase.from('clients').update(patch).eq('business_id', data.businessId);
    if (error) throw error;
    await logActivity(supabase, data.businessId, 'info_updated', 'Client information updated', name, userId);
    return { ok: true };
  });

// ---------- CHANGE STATUS ----------
const ChangeStatusInput = z.object({
  businessId: z.string(),
  status: z.string(),
});
export const changeStatusFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ChangeStatusInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const name = await actorName(supabase, userId);
    const { data: prev, error: prevErr } = await supabase.from('clients')
      .select('journey_status').eq('business_id', data.businessId).maybeSingle();
    if (prevErr) throw prevErr;
    if (!prev) throw new Error('Client not found');
    if (prev.journey_status === data.status) return { ok: true };
    const { data: updated, error } = await supabase.from('clients')
      .update({ journey_status: data.status })
      .eq('business_id', data.businessId)
      .select('sent_to_onboarding').single();
    if (error) throw error;
    const goingToOnboarding = data.status === 'Approved' && updated.sent_to_onboarding;
    const desc = `Status changed: ${prev.journey_status} → ${data.status}${goingToOnboarding ? ' · Sent to Onboarding' : ''}`;
    await logActivity(supabase, data.businessId, 'status_change', desc, name, userId);
    return { ok: true };
  });

// ---------- ADD NOTE ----------
export const addNoteFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    businessId: z.string(), body: z.string().min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const name = await actorName(supabase, userId);
    const { error } = await supabase.from('client_notes').insert({
      business_id: data.businessId, author_id: userId, author_name: name, body: data.body,
    } as any);
    if (error) throw error;
    await logActivity(supabase, data.businessId, 'note_added', 'Note added', name, userId);
    return { ok: true };
  });

// ---------- LOG CONTACT ----------
const LogContactInput = z.object({
  businessId: z.string(),
  method: z.string(),
  date: z.string(),
  summary: z.string(),
  nextFollowUpDate: z.string().optional(),
});
export const logContactFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LogContactInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const name = await actorName(supabase, userId);
    const patch: any = {
      last_contact_date: data.date,
      last_contact_method: data.method,
    };
    if (data.nextFollowUpDate) patch.next_follow_up_date = data.nextFollowUpDate;
    const { error } = await supabase.from('clients').update(patch as any).eq('business_id', data.businessId);
    if (error) throw error;
    const desc = `${data.method} contact logged${data.summary ? `: ${data.summary}` : ''}`;
    await logActivity(supabase, data.businessId, 'contact_logged', desc, name, userId);
    return { ok: true };
  });

// ---------- ATTACHMENTS ----------
export const registerAttachmentFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    businessId: z.string(),
    fileName: z.string(),
    fileType: z.string(),
    fileSize: z.number(),
    storagePath: z.string(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const name = await actorName(supabase, userId);
    const { error } = await supabase.from('client_attachments').insert({
      business_id: data.businessId, file_name: data.fileName, file_type: data.fileType,
      file_size: data.fileSize, storage_path: data.storagePath,
      uploaded_by: userId, uploaded_by_name: name,
    } as any);
    if (error) throw error;
    await logActivity(supabase, data.businessId, 'info_updated', `Attachment added: ${data.fileName}`, name, userId);
    return { ok: true };
  });

export const removeAttachmentFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    businessId: z.string(), attachmentId: z.string(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const name = await actorName(supabase, userId);
    const { data: att, error: fetchErr } = await supabase.from('client_attachments')
      .select('file_name, storage_path').eq('id', data.attachmentId).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (att?.storage_path) {
      await supabase.storage.from('client-attachments').remove([att.storage_path]);
    }
    const { error } = await supabase.from('client_attachments').delete().eq('id', data.attachmentId);
    if (error) throw error;
    await logActivity(supabase, data.businessId, 'info_updated', `Attachment removed: ${att?.file_name ?? 'file'}`, name, userId);
    return { ok: true };
  });

export const signAttachmentUrlFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ attachmentId: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: att, error } = await supabase.from('client_attachments')
      .select('storage_path, file_name').eq('id', data.attachmentId).maybeSingle();
    if (error || !att) throw error ?? new Error('Attachment not found');
    const { data: signed, error: sErr } = await supabase.storage
      .from('client-attachments').createSignedUrl(att.storage_path, 60);
    if (sErr) throw sErr;
    return { url: signed.signedUrl, fileName: att.file_name };
  });

// ---------- IMPORT ----------
const ImportInput = z.object({
  rows: z.array(z.object({
    company: z.string(),
    brands: z.array(z.string()),
    clientType: z.string(),
    journeyStatus: z.string(),
    contactName: z.string(),
    contactEmail: z.string(),
    contactPhone: z.string(),
    isDecisionMaker: z.boolean(),
    packageType: z.string(),
    budget: z.number().nullable(),
    lastContactDate: z.string(),
    leadSource: z.string().optional(),
    locations: z.array(LocationInputSchema),
  })),
});

export const importClientsFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ImportInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const name = await actorName(supabase, userId);
    let count = 0;
    for (const r of data.rows) {
      const { data: ins, error } = await supabase.from('clients').insert({
        company: r.company, brands: r.brands, client_type: r.clientType,
        journey_status: r.journeyStatus, last_contact_date: r.lastContactDate,
        last_contact_method: 'None', contact_name: r.contactName,
        contact_email: r.contactEmail, contact_phone: r.contactPhone,
        is_decision_maker: r.isDecisionMaker, package_type: r.packageType,
        budget: r.budget, sales_person_id: userId, lead_source: r.leadSource ?? 'CSV Import',
      } as any).select('business_id').single();
      if (error) continue;
      await supabase.from('locations').insert(
        r.locations.map(l => ({ business_id: ins.business_id, name: l.name, address: l.address, city: l.city, state: l.state })) as any
      );
      await logActivity(supabase, ins.business_id, 'created',
        `Imported from CSV · ${r.locations.length} location${r.locations.length > 1 ? 's' : ''} registered`, name, userId);
      count++;
    }
    return { count };
  });

// ---------- ADD LOCATION ----------
export const addLocationFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    businessId: z.string(),
    name: z.string().min(1),
    address: z.string().default(''),
    city: z.string().default(''),
    state: z.string().default(''),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const name = await actorName(supabase, userId);
    const { data: ins, error } = await supabase.from('locations').insert({
      business_id: data.businessId, name: data.name,
      address: data.address, city: data.city, state: data.state,
    } as any).select('location_id, needs_onboarding').single();
    if (error) throw error;
    await logActivity(supabase, data.businessId, 'info_updated',
      `Location added: ${data.name} · ${ins.location_id}${ins.needs_onboarding ? ' · Flagged for Onboarding' : ''}`,
      name, userId);
    return { locationId: ins.location_id };
  });

// ---------- CLOSE LOCATION (managers/admins only, enforced by DB trigger) ----------
export const setLocationStatusFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    locationId: z.string(),
    status: z.enum(['active', 'closed']),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const name = await actorName(supabase, userId);
    const { data: loc, error: fErr } = await supabase.from('locations')
      .select('business_id, name, status').eq('location_id', data.locationId).maybeSingle();
    if (fErr) throw fErr;
    if (!loc) throw new Error('Location not found');
    if (loc.status === data.status) return { ok: true };
    const patch: any = {
      status: data.status,
      closed_at: data.status === 'closed' ? new Date().toISOString() : null,
      closed_by: data.status === 'closed' ? userId : null,
    };
    const { error } = await supabase.from('locations').update(patch).eq('location_id', data.locationId);
    if (error) throw error;
    const verb = data.status === 'closed' ? 'Location closed' : 'Location reopened';
    await logActivity(supabase, loc.business_id, 'info_updated',
      `${verb}: ${loc.name} · ${data.locationId}`, name, userId);
    return { ok: true };
  });
