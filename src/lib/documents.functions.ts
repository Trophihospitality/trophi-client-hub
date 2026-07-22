import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

// ============================================================
// DOCUMENTS API
// - listClientDocumentsFn: returns contracts + any raw storage
//   files under {businessId}/{folder}/. Client-portal callers
//   NEVER receive payment/ items regardless of intent.
// - getDocumentSignedUrlFn: mints a short-lived signed URL for a
//   storage path. Authorization is enforced by:
//     * requireSupabaseAuth (must be signed in)
//     * a can_view check against the requested businessId/folder
//     * plus the storage.objects RLS policies as a hard backstop
// ============================================================

const CLIENT_VISIBLE_KINDS = new Set([
  'msa', 'order_form', 'client_authorization', 'bundle',
]);

const KIND_LABEL: Record<string, string> = {
  msa: 'Master Services Agreement',
  order_form: 'Order Form',
  client_authorization: 'Client Authorization',
  payment_authorization: 'Payment Authorization',
  bundle: 'Contract Bundle',
};

export interface DocumentContractItem {
  id: string;
  kind: string;
  kindLabel: string;
  documentName: string;
  status: string;
  executedAt: string | null;
  storagePath: string | null;
  fileSize: number | null;
  businessId: string;
  locationIds: string[];
  pandadocDocumentId: string | null;
}

export interface DocumentFileItem {
  name: string;
  storagePath: string;
  bucket: 'contracts' | 'payment' | 'client-attachments';
  folder: string; // contracts | payment | forms | assets
  size: number | null;
  updatedAt: string | null;
}

export interface DocumentsPayload {
  businessId: string;
  isStaff: boolean;
  contracts: DocumentContractItem[];
  // Raw files grouped by conceptual folder — contracts, payment (Trophi only),
  // forms and assets live under client-attachments/{bid}/{folder}.
  files: {
    contracts: DocumentFileItem[];
    payment: DocumentFileItem[]; // empty for clients
    forms: DocumentFileItem[];
    assets: DocumentFileItem[];
  };
}

async function isStaffFor(supabase: any, userId: string, businessId: string): Promise<boolean> {
  const { data } = await supabase.rpc('is_trophi_staff_for', { _business_id: businessId });
  if (data === true) return true;
  // Fallback: admins/managers are always staff regardless of business.
  const [{ data: isAdmin }, { data: isManager }] = await Promise.all([
    supabase.rpc('has_role', { _user_id: userId, _role: 'admin' }),
    supabase.rpc('has_role', { _user_id: userId, _role: 'manager' }),
  ]);
  return !!isAdmin || !!isManager;
}

async function isClientAdminFor(supabase: any, businessId: string): Promise<boolean> {
  const { data } = await supabase.rpc('is_client_admin_for', { _business_id: businessId });
  return !!data;
}

export const listClientDocumentsFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { businessId: string }) => input)
  .handler(async ({ data, context }): Promise<DocumentsPayload> => {
    const { supabase, userId } = context;
    const businessId = data.businessId;

    const staff = await isStaffFor(supabase, userId, businessId);
    const clientAdmin = staff ? false : await isClientAdminFor(supabase, businessId);
    if (!staff && !clientAdmin) {
      throw new Error('Forbidden: you do not have access to this client');
    }

    // Contracts via RLS (client_admin already scoped to visible kinds by policy)
    const { data: contractRows, error: cErr } = await supabase
      .from('client_contracts')
      .select('id, kind, status, executed_at, signed_pdf_path, document_name, file_size, business_id, location_ids, pandadoc_document_id, created_at')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (cErr) throw cErr;

    const contracts: DocumentContractItem[] = (contractRows ?? [])
      .filter((r: any) => staff || CLIENT_VISIBLE_KINDS.has(r.kind))
      .map((r: any) => ({
        id: r.id,
        kind: r.kind,
        kindLabel: KIND_LABEL[r.kind] ?? r.kind,
        documentName: r.document_name ?? KIND_LABEL[r.kind] ?? r.kind,
        status: r.status,
        executedAt: r.executed_at ?? null,
        storagePath: r.signed_pdf_path ?? null,
        fileSize: r.file_size ?? null,
        businessId: r.business_id,
        locationIds: Array.isArray(r.location_ids) ? r.location_ids : [],
        pandadocDocumentId: r.pandadoc_document_id ?? null,
      }));

    // Raw storage files (contracts + forms + assets always; payment only if staff)
    const contractsPaths = contracts.map((c) => c.storagePath).filter(Boolean) as string[];
    const knownContracts = new Set(contractsPaths.map((p) => p.split('/').pop()!));

    async function listBucket(bucket: string, folder: string): Promise<DocumentFileItem[]> {
      const { data: files } = await supabase.storage
        .from(bucket).list(`${businessId}/${folder}`, { limit: 200 });
      return (files ?? [])
        .filter((f: any) => f.name && !f.name.endsWith('/'))
        .map((f: any) => ({
          name: f.name,
          storagePath: `${businessId}/${folder}/${f.name}`,
          bucket: bucket as any,
          folder,
          size: (f.metadata?.size as number | null) ?? null,
          updatedAt: (f.updated_at as string | null) ?? null,
        }));
    }

    const [rawContracts, rawForms, rawAssets, rawPayment] = await Promise.all([
      listBucket('contracts', 'contracts'),
      listBucket('client-attachments', 'forms'),
      listBucket('client-attachments', 'assets'),
      staff ? listBucket('payment', 'payment') : Promise.resolve([]),
    ]);

    // Suppress raw-contract files already represented by a contracts row.
    const rawContractsFiltered = rawContracts.filter((f) => !knownContracts.has(f.name));

    return {
      businessId,
      isStaff: staff,
      contracts,
      files: {
        contracts: rawContractsFiltered,
        payment: rawPayment,
        forms: rawForms,
        assets: rawAssets,
      },
    };
  });

export const getDocumentSignedUrlFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bucket: 'contracts' | 'payment' | 'client-attachments'; path: string }) => input)
  .handler(async ({ data, context }): Promise<{ url: string; expiresIn: number }> => {
    const { supabase, userId } = context;
    const businessId = data.path.split('/')[0];
    if (!businessId) throw new Error('Invalid path');

    const staff = await isStaffFor(supabase, userId, businessId);
    const clientAdmin = staff ? false : await isClientAdminFor(supabase, businessId);
    if (!staff && !clientAdmin) throw new Error('Forbidden');

    // Payment bucket: Trophi staff only, no matter what.
    if (data.bucket === 'payment' && !staff) throw new Error('Forbidden');

    const { data: signed, error } = await supabase.storage
      .from(data.bucket).createSignedUrl(data.path, 300);
    if (error || !signed) throw new Error(error?.message ?? 'Could not create signed URL');
    return { url: signed.signedUrl, expiresIn: 300 };
  });

// Staff-only: pull completed PandaDoc PDFs into storage for one business.
// Idempotent — re-uploads only rows missing signed_pdf_path.
export const syncSignedPdfsFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { businessId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const staff = await isStaffFor(supabase, userId, data.businessId);
    if (!staff) throw new Error('Forbidden: staff only');
    const { archiveAllCompletedForBusiness } = await import('@/lib/contract-archive.server');
    return archiveAllCompletedForBusiness(data.businessId);
  });
