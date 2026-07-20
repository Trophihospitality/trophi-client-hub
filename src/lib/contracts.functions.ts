import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

// ============================================================
// Contract bundle (Step 1) — MSA + Order Form + Client Authorization
// Merge fields come from the client record + active locations.
// Documents are created as drafts in PandaDoc; sending happens in Step 4.
// ============================================================

export type BundleKind = 'msa' | 'order_form' | 'client_authorization';

const BUNDLE_KINDS: BundleKind[] = ['msa', 'order_form', 'client_authorization'];

const KIND_LABELS: Record<BundleKind, string> = {
  msa: 'Master Services Agreement',
  order_form: 'Order Form',
  client_authorization: 'Client Authorization',
};

export interface ContractRow {
  kind: BundleKind;
  label: string;
  status: string; // draft | sent | viewed | completed | error | not_created
  pandadocDocumentId: string | null;
  updatedAt: string | null;
  errorMessage: string | null;
}

export interface ContractBundlePreview {
  ready: boolean;
  readyReasons: string[]; // human-readable list of what's blocking generation
  missingTemplateIds: BundleKind[];
  invalidTemplateIds: BundleKind[]; // template value present but not a valid PandaDoc UUID
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

// A valid PandaDoc template UUID is an opaque 22-char base62 id; reject
// obvious form/share URLs and anything with whitespace or slashes.
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
  // Blank line between entries so PandaDoc renders them as separate paragraphs.
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
      return {
        kind,
        label: KIND_LABELS[kind],
        status: c?.status ?? 'not_created',
        pandadocDocumentId: c?.pandadoc_document_id ?? null,
        updatedAt: c?.updated_at ?? null,
        errorMessage: c?.metadata?.error ?? null,
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

export const generateContractBundleFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; created: BundleKind[]; skipped: BundleKind[] }> => {
    const { supabase, userId } = context;
    await assertOwnerOrPrivileged(supabase, userId, data.businessId);

    const { client, locations, templateMap, contracts, sales } = await loadBundleContext(
      supabase,
      data.businessId,
    );

    const missing = BUNDLE_KINDS.filter((k) => !templateMap.get(k));
    if (missing.length > 0) {
      throw new Error(`Missing PandaDoc template IDs for: ${missing.join(', ')}`);
    }
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

    const merge = buildMerge(client, locations);
    const clientNames = splitName(client.contact_name);
    const salesNames = splitName(sales.name);

    const recipients = [
      { email: client.contact_email, first_name: clientNames.firstName, last_name: clientNames.lastName, role: 'client' },
      { email: sales.email, first_name: salesNames.firstName, last_name: salesNames.lastName, role: 'trophi' },
    ];

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { pandadoc } = await import('@/lib/pandadoc.server');

    const mergeStrings: Record<string, string> = {};
    Object.entries(merge).forEach(([k, v]) => { mergeStrings[k] = String(v); });

    const created: BundleKind[] = [];
    const skipped: BundleKind[] = [];

    // Reconcile: find any PandaDoc documents already tagged with this business_id
    // (e.g. from a previous run where the DB insert failed silently) so we link
    // instead of creating duplicates.
    let existingDocs: Array<{ id: string; name: string; status: string; metadata?: any }> = [];
    try {
      existingDocs = await pandadoc.listByMetadata({ business_id: client.business_id }) as any;
    } catch {
      existingDocs = [];
    }
    const findExistingRemote = (kind: BundleKind) => {
      const byMeta = existingDocs.find((d: any) => d.metadata?.kind === kind);
      if (byMeta) return byMeta;
      // Fallback: match by document name prefix if metadata wasn't preserved.
      return existingDocs.find((d) => d.name?.startsWith(KIND_LABELS[kind]));
    };

    for (const kind of BUNDLE_KINDS) {
      const existing = contracts.find((r: any) => r.kind === kind);
      if (existing && existing.pandadoc_document_id && existing.status !== 'error') {
        skipped.push(kind);
        continue;
      }

      try {
        let doc: { id: string; name: string; status: string };
        const remote = findExistingRemote(kind);
        if (remote) {
          doc = remote;
        } else {
          const templateUuid = templateMap.get(kind)!;
          const perKindRecipients =
            kind === 'client_authorization' ? [recipients[0], recipients[1]] : recipients;
          doc = await pandadoc.createFromTemplate({
            name: `${KIND_LABELS[kind]} — ${client.company} (${client.business_id})`,
            templateUuid,
            recipients: perKindRecipients,
            tokens: mergeStrings,
            fields: mergeStrings,
            metadata: { business_id: client.business_id, kind },
          });
        }

        const row = {
          business_id: client.business_id,
          kind,
          pandadoc_document_id: doc.id,
          status: doc.status || 'document.draft',
          metadata: { name: doc.name, template_id: templateMap.get(kind), reconciled: !!remote },
          created_by: userId,
          updated_at: new Date().toISOString(),
        };
        const res = existing
          ? await supabaseAdmin.from('client_contracts').update(row).eq('id', existing.id)
          : await supabaseAdmin.from('client_contracts').insert(row);
        if (res.error) throw new Error(`DB persist failed: ${res.error.message}`);
        created.push(kind);
      } catch (err: any) {
        const errRow = {
          business_id: client.business_id,
          kind,
          pandadoc_document_id: existing?.pandadoc_document_id ?? null,
          status: 'error',
          metadata: { error: err?.message ?? String(err) },
          created_by: userId,
          updated_at: new Date().toISOString(),
        };
        if (existing) {
          await supabaseAdmin.from('client_contracts').update(errRow).eq('id', existing.id);
        } else {
          await supabaseAdmin.from('client_contracts').insert(errRow);
        }
        throw new Error(`Failed to create ${KIND_LABELS[kind]}: ${err?.message ?? err}`);
      }
    }


    await supabaseAdmin.from('client_activity').insert({
      business_id: client.business_id,
      type: 'info_updated',
      description: `Contract bundle generated in PandaDoc (${created.length} new, ${skipped.length} existing)`,
      actor: sales.name ?? 'User',
    });

    return { ok: true, created, skipped };
  });
