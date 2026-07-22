import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

// ============================================================
// Contract bundle (Step 1) — MSA + Order Form + Client Authorization
// All PandaDoc document creation flows through buildAndCreateBundleDoc
// so there is exactly ONE payload-construction path shared by initial
// generation, void-and-regenerate, and future Payment Authorization
// (Turn 5). After creation we read fields back from PandaDoc and mark
// the row errored if any required merge field is empty — clients must
// never be shown a blank contract to sign.
// ============================================================

export type BundleKind = 'msa' | 'order_form' | 'client_authorization';

const BUNDLE_KINDS: BundleKind[] = ['msa', 'order_form', 'client_authorization'];

const KIND_LABELS: Record<BundleKind, string> = {
  msa: 'Master Services Agreement',
  order_form: 'Order Form',
  client_authorization: 'Client Authorization',
};

// Required merge fields per template — must exactly match the field
// NAMES defined in the PandaDoc template (case-sensitive). If a template
// changes, update this map.
const REQUIRED_FIELDS_BY_KIND: Record<BundleKind, string[]> = {
  msa: ['Company', 'Brands', 'ContactName', 'ContactRole', 'ContactEmail', 'BusinessId'],
  order_form: ['Company', 'PackageType', 'MonthlyBudgetPerLocation', 'ActiveLocationsList', 'BusinessId'],
  client_authorization: ['Company', 'ContactName', 'ContactRole', 'BusinessId'],
};

export interface ContractRow {
  kind: BundleKind;
  label: string;
  status: string;
  pandadocDocumentId: string | null;
  updatedAt: string | null;
  errorMessage: string | null;
  blankFields: string[]; // required merge fields that came back empty after creation
}

export interface ContractBundlePreview {
  ready: boolean;
  readyReasons: string[];
  missingTemplateIds: BundleKind[];
  invalidTemplateIds: BundleKind[];
  merge: {
    Company: string;
    Brands: string;
    ContactName: string;
    ContactRole: string;
    ContactEmail: string;
    BusinessId: string;
    PackageType: string;
    MonthlyBudgetPerLocation: string;
    ActiveLocationsList: string;
    ActiveLocationCount: number;
  };
  locations: Array<{ locationId: string; name: string; address: string }>;
  clientSigner: { email: string; firstName: string; lastName: string } | null;
  trophiSigner: { email: string; firstName: string; lastName: string } | null;
  contracts: ContractRow[];
}


function splitName(name: string | null | undefined): { firstName: string; lastName: string } {
  const s = (name ?? '').trim();
  if (!s) return { firstName: '', lastName: '' };
  const parts = s.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function loadBundleContext(supabase: any, businessId: string) {
  const [{ data: client, error: cErr }, { data: locations }, { data: templates }, { data: contracts }] =
    await Promise.all([
      supabase.from('clients').select('*').eq('business_id', businessId).maybeSingle(),
      supabase.from('locations').select('*').eq('business_id', businessId).eq('status', 'active').order('location_id'),
      supabase.from('pandadoc_templates').select('key, template_id'),
      supabase.from('client_contracts').select('*').eq('business_id', businessId).in('kind', BUNDLE_KINDS),
    ]);
  if (cErr) throw cErr;
  if (!client) throw new Error('Client not found');

  const templateMap = new Map<string, string | null>();
  (templates ?? []).forEach((t: any) => {
    const raw = typeof t.template_id === 'string' ? t.template_id.trim() : t.template_id;
    templateMap.set(t.key, raw || null);
  });

  let sales: any = null;
  if (client.sales_person_id) {
    const { data } = await supabase.from('profiles').select('user_id, name, email').eq('user_id', client.sales_person_id).maybeSingle();
    sales = data;
  }

  return { client, locations: locations ?? [], templateMap, contracts: contracts ?? [], sales };
}

function isValidTemplateId(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = String(v).trim();
  if (!s) return false;
  if (/\s/.test(s)) return false;
  if (s.includes('/') || s.startsWith('http')) return false;
  return s.length >= 16 && s.length <= 64;
}

function formatLocationLine(l: any): string {
  const addr = [l.address, l.city, l.state].filter(Boolean).join(', ');
  return `${l.name} — ${addr || 'Address not set'} (${l.location_id})`;
}

function buildMerge(client: any, locations: any[]) {
  const brands = Array.isArray(client.brands) ? client.brands.join(', ') : '';
  const locList = locations.map(formatLocationLine).join('\n\n');
  return {
    Company: client.company ?? '',
    Brands: brands,
    ContactName: client.contact_name ?? '',
    ContactRole: client.contact_role ?? '',
    ContactEmail: client.contact_email ?? '',
    BusinessId: client.business_id,
    PackageType: client.package_type ?? '',
    MonthlyBudgetPerLocation: client.budget != null ? `$${Number(client.budget).toLocaleString()}` : '',
    ActiveLocationsList: locList,
    ActiveLocationCount: locations.length,
  };
}


export const getContractBundleFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string() }).parse(d))
  .handler(async ({ data, context }): Promise<ContractBundlePreview> => {
    const { client, locations, templateMap, contracts, sales } = await loadBundleContext(
      context.supabase,
      data.businessId,
    );
    const missing = BUNDLE_KINDS.filter((k) => !templateMap.get(k));
    const invalid = BUNDLE_KINDS.filter(
      (k) => !!templateMap.get(k) && !isValidTemplateId(templateMap.get(k)),
    );
    const merge = buildMerge(client, locations);

    const clientNames = splitName(client.contact_name);
    const salesNames = splitName(sales?.name);
    const clientSigner = client.contact_email
      ? { email: client.contact_email, firstName: clientNames.firstName, lastName: clientNames.lastName }
      : null;
    const trophiSigner = sales?.email
      ? { email: sales.email, firstName: salesNames.firstName, lastName: salesNames.lastName }
      : null;

    const rows: ContractRow[] = BUNDLE_KINDS.map((kind) => {
      const c = contracts.find((r: any) => r.kind === kind);
      const md = (c?.metadata ?? {}) as any;
      return {
        kind,
        label: KIND_LABELS[kind],
        status: c?.status ?? 'not_created',
        pandadocDocumentId: c?.pandadoc_document_id ?? null,
        updatedAt: c?.updated_at ?? null,
        errorMessage: md.error ?? null,
        blankFields: Array.isArray(md.blank_fields) ? md.blank_fields : [],
      };
    });

    const reasons: string[] = [];
    if (!client.contact_name) reasons.push('Client contact name is missing');
    if (!client.contact_role) reasons.push('Client contact role is missing');
    if (!client.contact_email) reasons.push('Client contact email is missing');
    if (!client.package_type) reasons.push('Package type is not set');
    if (client.budget == null) reasons.push('Monthly budget / location is not set');
    if (locations.length === 0) reasons.push('At least one active location is required');
    if (!sales?.email) reasons.push('Account owner (Trophi signer) has no email on file');
    missing.forEach((k) => reasons.push(`PandaDoc template ID not set for ${KIND_LABELS[k]}`));
    invalid.forEach((k) =>
      reasons.push(
        `PandaDoc template ID for ${KIND_LABELS[k]} looks invalid (expected a template UUID, not a form/share URL)`,
      ),
    );

    return {
      ready: reasons.length === 0,
      readyReasons: reasons,
      missingTemplateIds: missing,
      invalidTemplateIds: invalid,
      merge,
      locations: locations.map((l: any) => ({
        locationId: l.location_id,
        name: l.name,
        address: [l.address, l.city, l.state].filter(Boolean).join(', '),
      })),
      clientSigner,
      trophiSigner,
      contracts: rows,
    };
  });


async function assertOwnerOrPrivileged(supabase: any, userId: string, businessId: string) {
  const [{ data: client }, { data: roles }] = await Promise.all([
    supabase.from('clients').select('sales_person_id').eq('business_id', businessId).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
  ]);
  if (!client) throw new Error('Client not found');
  const roleSet = new Set((roles ?? []).map((r: any) => r.role));
  const ok = roleSet.has('admin') || roleSet.has('manager') || client.sales_person_id === userId;
  if (!ok) throw new Error('Forbidden');
}

function assertBundleContextReady(client: any, locations: any[], sales: any, templateMap: Map<string, string | null>) {
  const missing = BUNDLE_KINDS.filter((k) => !templateMap.get(k));
  if (missing.length > 0) throw new Error(`Missing PandaDoc template IDs for: ${missing.join(', ')}`);
  const invalid = BUNDLE_KINDS.filter((k) => !isValidTemplateId(templateMap.get(k)));
  if (invalid.length > 0) {
    throw new Error(
      `PandaDoc template IDs for ${invalid.map((k) => KIND_LABELS[k]).join(', ')} look invalid. ` +
        `Paste the template UUID (from Templates → your template → three-dot menu → Copy template ID), not a form/share URL.`,
    );
  }
  if (!client.contact_email || !client.contact_name || !client.contact_role) {
    throw new Error('Client point-of-contact name, role, and email are required');
  }
  if (!sales?.email) throw new Error('Account owner profile has no email — cannot set Trophi signer');
  if (locations.length === 0) throw new Error('At least one active location is required');
  if (!client.package_type || client.budget == null) {
    throw new Error('Package type and monthly budget per location are required');
  }
}

// ============================================================
// SHARED BUILD PATH — all document creation flows through this.
//   1. Build merge payload from client + locations
//   2. Build recipients (client + trophi roles)
//   3. Create from template with tokens+fields+metadata (business_id,
//      kind, location_ids)
//   4. Wait for draft, read back fields via API
//   5. If any required merge field is empty → mark row errored with
//      blank_fields list and DO NOT silent-send (blocks Sign now)
//   6. Otherwise silent-send so doc lands in document.sent
// Returns the persisted status.
// ============================================================
async function buildAndCreateBundleDoc(params: {
  kind: BundleKind;
  client: any;
  locations: any[];
  sales: any;
  templateUuid: string;
  userId: string;
}): Promise<{ documentId: string; status: string; blankFields: string[]; error?: string }> {
  const { kind, client, locations, sales, templateUuid } = params;
  const { pandadoc } = await import('@/lib/pandadoc.server');

  const merge = buildMerge(client, locations);
  const mergeStrings: Record<string, string> = {};
  Object.entries(merge).forEach(([k, v]) => { mergeStrings[k] = String(v); });

  const clientNames = splitName(client.contact_name);
  const salesNames = splitName(sales.name);
  const recipients = [
    { email: client.contact_email, first_name: clientNames.firstName, last_name: clientNames.lastName, role: 'client' },
    { email: sales.email, first_name: salesNames.firstName, last_name: salesNames.lastName, role: 'trophi' },
  ];

  const locationIds = locations.map((l: any) => l.location_id).join(',');

  const doc = await pandadoc.createFromTemplate({
    name: `${KIND_LABELS[kind]} — ${client.company} (${client.business_id})`,
    templateUuid,
    recipients,
    tokens: mergeStrings,
    fields: mergeStrings,
    metadata: {
      business_id: client.business_id,
      kind,
      location_ids: locationIds,
      signer_email_at_creation: client.contact_email,
    },
  });

  // Wait for PandaDoc to finish server-side processing so we can read
  // fields back reliably.
  let status = String(doc.status || 'document.uploaded');
  try {
    status = await pandadoc.waitForDraft(doc.id);
  } catch {
    /* fall through to verification */
  }

  // Blank-contract guard: read fields back and verify every required
  // merge field for this kind carries a non-empty value.
  const details = await pandadoc.getDocument(doc.id);
  const fieldMap = new Map<string, string>();
  for (const f of (details as any).fields ?? []) {
    const name = f.name ?? f.merge_field ?? f.field_id;
    if (!name) continue;
    const val = typeof f.value === 'string' ? f.value : '';
    fieldMap.set(String(name), val);
  }
  const required = REQUIRED_FIELDS_BY_KIND[kind];
  const blankFields = required.filter((k) => {
    const v = fieldMap.get(k);
    return v == null || v.trim() === '';
  });

  if (blankFields.length > 0) {
    // Do NOT silent-send. Leave in draft/uploaded so staff can inspect
    // and re-run; return error state to persist on the row.
    return {
      documentId: doc.id,
      status: 'error',
      blankFields,
      error: `PandaDoc created the document but did not populate required merge fields: ${blankFields.join(', ')}. ` +
        `Confirm the template's field NAMES match exactly (case-sensitive). Sign now is disabled until this is fixed.`,
    };
  }

  // Silent-send so the doc is signing-ready without emailing the client.
  try {
    await pandadoc.sendDocument(doc.id, {
      subject: 'Trophi Hospitality — in-portal signing',
      message: 'Signing happens inside the Trophi client portal. You should not receive this email.',
      silent: true,
    });
    status = 'document.sent';
  } catch (err) {
    // Non-fatal: keep whatever status we last saw. createSigningSessionFn
    // will retry silent-send lazily on first Sign now click.
    console.warn(`[bundle] silent send failed for ${kind} (${doc.id}):`, err);
  }

  return { documentId: doc.id, status, blankFields: [] };
}

async function persistBundleRow(params: {
  supabaseAdmin: any;
  businessId: string;
  kind: BundleKind;
  existingRowId: string | null;
  documentId: string | null;
  status: string;
  templateId: string;
  signerEmail: string;
  locationIds: string[];
  userId: string;
  blankFields: string[];
  error?: string;
}) {
  const { supabaseAdmin, existingRowId, kind, businessId } = params;
  const metadata: Record<string, any> = {
    template_id: params.templateId,
    signer_email_at_creation: params.signerEmail,
    location_ids: params.locationIds,
  };
  if (params.blankFields.length > 0) metadata.blank_fields = params.blankFields;
  if (params.error) metadata.error = params.error;

  const row = {
    business_id: businessId,
    kind,
    pandadoc_document_id: params.documentId,
    status: params.status,
    metadata,
    created_by: params.userId,
    updated_at: new Date().toISOString(),
  };
  const res = existingRowId
    ? await supabaseAdmin.from('client_contracts').update(row).eq('id', existingRowId)
    : await supabaseAdmin.from('client_contracts').insert(row);
  if (res.error) throw new Error(`DB persist failed: ${res.error.message}`);
}

// ============================================================
// generateContractBundleFn — creates any missing/errored bundle
// documents; skips those already successfully created.
// ============================================================
export const generateContractBundleFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; created: BundleKind[]; skipped: BundleKind[]; errored: BundleKind[] }> => {
    const { supabase, userId } = context;
    await assertOwnerOrPrivileged(supabase, userId, data.businessId);

    const { client, locations, templateMap, contracts, sales } = await loadBundleContext(supabase, data.businessId);
    assertBundleContextReady(client, locations, sales, templateMap);

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    const created: BundleKind[] = [];
    const skipped: BundleKind[] = [];
    const errored: BundleKind[] = [];

    for (const kind of BUNDLE_KINDS) {
      const existing = contracts.find((r: any) => r.kind === kind);
      if (existing && existing.pandadoc_document_id && existing.status !== 'error') {
        skipped.push(kind);
        continue;
      }
      try {
        const result = await buildAndCreateBundleDoc({
          kind, client, locations, sales,
          templateUuid: templateMap.get(kind)!, userId,
        });
        await persistBundleRow({
          supabaseAdmin,
          businessId: client.business_id,
          kind,
          existingRowId: existing?.id ?? null,
          documentId: result.documentId,
          status: result.status,
          templateId: templateMap.get(kind)!,
          signerEmail: client.contact_email,
          locationIds: locations.map((l: any) => l.location_id),
          userId,
          blankFields: result.blankFields,
          error: result.error,
        });
        if (result.error) errored.push(kind);
        else created.push(kind);
      } catch (err: any) {
        await persistBundleRow({
          supabaseAdmin,
          businessId: client.business_id,
          kind,
          existingRowId: existing?.id ?? null,
          documentId: existing?.pandadoc_document_id ?? null,
          status: 'error',
          templateId: templateMap.get(kind)!,
          signerEmail: client.contact_email,
          locationIds: locations.map((l: any) => l.location_id),
          userId,
          blankFields: [],
          error: err?.message ?? String(err),
        });
        errored.push(kind);
      }
    }

    await supabaseAdmin.from('client_activity').insert({
      business_id: client.business_id,
      type: 'info_updated',
      description: `Contract bundle generated (${created.length} new, ${skipped.length} existing, ${errored.length} errored)`,
      actor: sales.name ?? 'User',
    });

    return { ok: true, created, skipped, errored };
  });


// ============================================================
// voidAndRegenerateContractBundleFn — deletes all bundle docs
// (whether draft or sent) and recreates from scratch through the
// shared build path.
// ============================================================
export const voidAndRegenerateContractBundleFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; voided: number; recreated: BundleKind[]; errored: BundleKind[] }> => {
    const { supabase, userId } = context;
    await assertOwnerOrPrivileged(supabase, userId, data.businessId);

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { pandadoc } = await import('@/lib/pandadoc.server');

    const { data: existing } = await supabaseAdmin
      .from('client_contracts')
      .select('id, kind, pandadoc_document_id, status')
      .eq('business_id', data.businessId)
      .in('kind', BUNDLE_KINDS);

    let voided = 0;
    for (const row of existing ?? []) {
      const docId = (row as any).pandadoc_document_id;
      if (!docId) continue;
      try {
        await pandadoc.deleteDocument(docId);
        voided++;
      } catch (err) {
        // Sent/viewed docs cannot be deleted via public API — leave orphaned.
        console.warn(`[voidAndRegenerate] Could not delete PandaDoc doc ${docId}:`, err);
      }
    }

    await supabaseAdmin
      .from('client_contracts')
      .delete()
      .eq('business_id', data.businessId)
      .in('kind', BUNDLE_KINDS);

    const { client, locations, templateMap, sales } = await loadBundleContext(supabase, data.businessId);
    assertBundleContextReady(client, locations, sales, templateMap);

    const recreated: BundleKind[] = [];
    const errored: BundleKind[] = [];
    for (const kind of BUNDLE_KINDS) {
      try {
        const result = await buildAndCreateBundleDoc({
          kind, client, locations, sales,
          templateUuid: templateMap.get(kind)!, userId,
        });
        await persistBundleRow({
          supabaseAdmin,
          businessId: client.business_id,
          kind,
          existingRowId: null,
          documentId: result.documentId,
          status: result.status,
          templateId: templateMap.get(kind)!,
          signerEmail: client.contact_email,
          locationIds: locations.map((l: any) => l.location_id),
          userId,
          blankFields: result.blankFields,
          error: result.error,
        });
        if (result.error) errored.push(kind);
        else recreated.push(kind);
      } catch (err: any) {
        await persistBundleRow({
          supabaseAdmin,
          businessId: client.business_id,
          kind,
          existingRowId: null,
          documentId: null,
          status: 'error',
          templateId: templateMap.get(kind)!,
          signerEmail: client.contact_email,
          locationIds: locations.map((l: any) => l.location_id),
          userId,
          blankFields: [],
          error: err?.message ?? String(err),
        });
        errored.push(kind);
      }
    }

    await supabaseAdmin.from('client_activity').insert({
      business_id: client.business_id,
      type: 'info_updated',
      description: `Contract bundle voided and regenerated (${voided} removed, ${recreated.length} recreated, ${errored.length} errored) — signer: ${client.contact_email}`,
      actor: sales.name ?? 'User',
    });

    return { ok: true, voided, recreated, errored };
  });

// ============================================================
// prepBundleForSigningFn — silent-sends draft/uploaded docs.
// Refuses to send docs marked errored (blank merge fields).
// ============================================================
export const prepBundleForSigningFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; prepared: string[]; skipped: string[] }> => {
    const { supabase, userId } = context;
    await assertOwnerOrPrivileged(supabase, userId, data.businessId);

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { pandadoc } = await import('@/lib/pandadoc.server');

    const { data: rows } = await supabaseAdmin
      .from('client_contracts')
      .select('kind, pandadoc_document_id, status, metadata')
      .eq('business_id', data.businessId)
      .in('kind', BUNDLE_KINDS);

    const prepared: string[] = [];
    const skipped: string[] = [];
    for (const r of (rows ?? []) as any[]) {
      const docId = r.pandadoc_document_id;
      const s = String(r.status ?? '');
      const blank = Array.isArray(r.metadata?.blank_fields) && r.metadata.blank_fields.length > 0;
      if (!docId) { skipped.push(`${r.kind}:no-doc`); continue; }
      if (blank) { skipped.push(`${r.kind}:blank-fields`); continue; }
      if (s !== 'document.draft' && s !== 'draft' && s !== 'document.uploaded' && s !== 'uploaded') {
        skipped.push(`${r.kind}:${s}`); continue;
      }
      try {
        await pandadoc.waitForDraft(docId);
        await pandadoc.sendDocument(docId, {
          subject: 'Trophi Hospitality — in-portal signing',
          message: 'Signing happens inside the Trophi client portal. You should not receive this email.',
          silent: true,
        });
        await supabaseAdmin.from('client_contracts').update({
          status: 'document.sent', updated_at: new Date().toISOString(),
        }).eq('business_id', data.businessId).eq('kind', r.kind);
        prepared.push(r.kind);
      } catch (err: any) {
        skipped.push(`${r.kind}:error:${err?.message ?? err}`);
      }
    }
    return { ok: true, prepared, skipped };
  });
