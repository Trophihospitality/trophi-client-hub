import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

// ============================================================
// Client Portal — Step 4 embedded signing + Trophi countersignature.
// Client signs first (role 'client'), then a Trophi account owner
// countersigns (role 'trophi'). Both flows use silent send so no
// PandaDoc emails go out — all signing stays in-portal.
// ============================================================

export type BundleKind = 'msa' | 'order_form' | 'client_authorization';
const BUNDLE_KINDS: BundleKind[] = ['msa', 'order_form', 'client_authorization'];
const KIND_LABELS: Record<BundleKind, string> = {
  msa: 'Master Services Agreement',
  order_form: 'Order Form',
  client_authorization: 'Client Authorization',
};

async function assertCanSignForClient(supabase: any, _userId: string, businessId: string) {
  const { data: canClient } = await supabase.rpc('is_client_admin_for', { _business_id: businessId });
  if (canClient) return 'client' as const;
  const { data: canStaff } = await supabase.rpc('is_trophi_staff_for', { _business_id: businessId });
  if (canStaff) return 'staff' as const;
  throw new Error('Forbidden');
}

export interface ClientContractRow {
  kind: BundleKind;
  label: string;
  status: string;
  pandadocDocumentId: string | null;
  clientSigned: boolean;
  staffSigned: boolean;
  completed: boolean;
  errored: boolean;
  errorMessage: string | null;
  blankFields: string[];
  staffSignerEmail: string | null;
}

async function fetchRecipientState(pandadocDocId: string) {
  const { pandadoc } = await import('@/lib/pandadoc.server');
  const details: any = await pandadoc.getDocument(pandadocDocId);
  const recips: any[] = details?.recipients ?? [];
  const byRole = (role: string) => recips.find((r) => {
    const roles = Array.isArray(r.roles) ? r.roles : [];
    return String(r.role ?? '').toLowerCase() === role ||
      roles.some((v: any) => String(v).toLowerCase() === role);
  });
  const client = byRole('client');
  const staff = byRole('trophi');
  const signed = (r: any) => r?.has_completed === true || r?.completed === true || !!r?.signature_date;
  const status = String(details?.status ?? '');
  return {
    clientSigned: signed(client) || status === 'document.completed',
    staffSigned: signed(staff) || status === 'document.completed',
    staffEmail: (staff?.email as string | undefined) ?? null,
    status,
  };
}

export const getClientContractsFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string() }).parse(d))
  .handler(async ({ data, context }): Promise<{
    contracts: ClientContractRow[];
    signerEmail: string;
    allComplete: boolean;
    anyErrored: boolean;
    staffSignerEmail: string | null;
    allClientSigned: boolean;
  }> => {
    const { supabase, userId } = context;
    await assertCanSignForClient(supabase, userId, data.businessId);

    const [{ data: client }, { data: contracts }] = await Promise.all([
      supabase.from('clients').select('contact_email').eq('business_id', data.businessId).maybeSingle(),
      supabase.from('client_contracts').select('kind, status, pandadoc_document_id, metadata')
        .eq('business_id', data.businessId).in('kind', BUNDLE_KINDS),
    ]);
    if (!client?.contact_email) throw new Error('Client POC email not set');

    const rows: ClientContractRow[] = await Promise.all(BUNDLE_KINDS.map(async (kind) => {
      const r = (contracts ?? []).find((c: any) => c.kind === kind);
      const status = r?.status ?? 'not_created';
      const md = (r?.metadata ?? {}) as any;
      const blankFields = Array.isArray(md.blank_fields) ? md.blank_fields : [];
      const errored = status === 'error' || blankFields.length > 0;
      const completedByStatus = status === 'document.completed' || status === 'completed';
      const rec = !errored && r?.pandadoc_document_id
        ? await fetchRecipientState(r.pandadoc_document_id).catch(() => ({
            clientSigned: completedByStatus,
            staffSigned: completedByStatus,
            staffEmail: null as string | null,
            status: status || null,
          }))
        : { clientSigned: completedByStatus, staffSigned: completedByStatus, staffEmail: null as string | null, status: null as string | null };
      return {
        kind,
        label: KIND_LABELS[kind],
        status,
        pandadocDocumentId: r?.pandadoc_document_id ?? null,
        clientSigned: rec.clientSigned || completedByStatus,
        staffSigned: rec.staffSigned || completedByStatus,
        completed: completedByStatus || (rec.clientSigned && rec.staffSigned),
        errored,
        errorMessage: md.error ?? null,
        blankFields,
        staffSignerEmail: rec.staffEmail,
      };
    }));

    const staffSignerEmail = rows.find((r) => r.staffSignerEmail)?.staffSignerEmail ?? null;

    return {
      contracts: rows,
      signerEmail: client.contact_email,
      allComplete: rows.length > 0 && rows.every((r) => r.completed),
      anyErrored: rows.some((r) => r.errored),
      staffSignerEmail,
      allClientSigned: rows.length > 0 && rows.every((r) => r.clientSigned || r.completed),
    };
  });

async function ensureSendableAndCreateSession(
  supabaseAdmin: any,
  row: { pandadoc_document_id: string; status: string; metadata: any },
  businessId: string,
  kind: BundleKind,
  recipientEmail: string,
): Promise<{ sessionUrl: string; expiresAt: string }> {
  const { pandadoc } = await import('@/lib/pandadoc.server');

  const blank = Array.isArray(row.metadata?.blank_fields) ? row.metadata.blank_fields : [];
  if (row.status === 'error' || blank.length > 0) {
    throw new Error(
      `This document is not ready to sign — required fields are empty (${blank.join(', ') || 'see admin'}).`,
    );
  }

  let current = String(row.status ?? '');
  if (current === 'document.uploaded' || current === 'uploaded') {
    current = await pandadoc.waitForDraft(row.pandadoc_document_id);
  }
  if (current === 'document.draft' || current === 'draft' || current === 'document.uploaded') {
    await pandadoc.sendDocument(row.pandadoc_document_id, {
      subject: 'Trophi Hospitality — in-portal signing',
      message: 'Signing happens inside the Trophi client portal. You should not receive this email.',
      silent: true,
    });
    await supabaseAdmin.from('client_contracts').update({
      status: 'document.sent',
      updated_at: new Date().toISOString(),
    }).eq('business_id', businessId).eq('kind', kind);
  }

  const session = await pandadoc.createSession(row.pandadoc_document_id, recipientEmail, 900);
  return { sessionUrl: `https://app.pandadoc.com/s/${session.id}`, expiresAt: session.expires_at };
}

export const createSigningSessionFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      businessId: z.string(),
      kind: z.enum(['msa', 'order_form', 'client_authorization']),
    }).parse(d))
  .handler(async ({ data, context }): Promise<{ sessionUrl: string; expiresAt: string }> => {
    const { supabase, userId } = context;
    await assertCanSignForClient(supabase, userId, data.businessId);

    const { data: client } = await supabase.from('clients')
      .select('contact_email').eq('business_id', data.businessId).maybeSingle();
    if (!client?.contact_email) throw new Error('Client POC email not set');

    const { data: row } = await supabase.from('client_contracts')
      .select('pandadoc_document_id, status, metadata')
      .eq('business_id', data.businessId).eq('kind', data.kind).maybeSingle();
    if (!row?.pandadoc_document_id) throw new Error('Document has not been generated yet');

    // Block if client already signed but not yet fully executed — they'd just
    // see a completed document, but be explicit for UX.
    const rec = await fetchRecipientState(row.pandadoc_document_id).catch((err) => {
      throw new Error(`Could not confirm PandaDoc signing status. Please retry in a few seconds. ${err?.message ?? ''}`.trim());
    });
    if (rec.clientSigned && !rec.staffSigned) {
      throw new Error('You have already signed this document. Awaiting Trophi countersignature.');
    }

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    return ensureSendableAndCreateSession(supabaseAdmin, row as any, data.businessId, data.kind, client.contact_email);
  });

// Trophi countersignature: any Trophi staff assigned to the client can open
// a session for the 'trophi' recipient. Session runs as whoever the template
// recipient email is (typically the account owner). Requires the client to
// have signed first.
export const createCountersignSessionFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      businessId: z.string(),
      kind: z.enum(['msa', 'order_form', 'client_authorization']),
    }).parse(d))
  .handler(async ({ data, context }): Promise<{ sessionUrl: string; expiresAt: string; signerEmail: string }> => {
    const { supabase } = context;
    const { data: canStaff } = await supabase.rpc('is_trophi_staff_for', { _business_id: data.businessId });
    if (!canStaff) throw new Error('Forbidden');

    const { data: row } = await supabase.from('client_contracts')
      .select('pandadoc_document_id, status, metadata')
      .eq('business_id', data.businessId).eq('kind', data.kind).maybeSingle();
    if (!row?.pandadoc_document_id) throw new Error('Document has not been generated yet');

    const rec = await fetchRecipientState(row.pandadoc_document_id).catch((err) => {
      throw new Error(`Could not confirm PandaDoc signing status. Please retry in a few seconds. ${err?.message ?? ''}`.trim());
    });
    if (!rec.clientSigned) {
      throw new Error('The client has not signed yet — countersignature not available.');
    }
    if (!rec.staffEmail) throw new Error('No Trophi signer configured on this document.');
    if (rec.staffSigned) throw new Error('This document has already been countersigned.');

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const session = await ensureSendableAndCreateSession(
      supabaseAdmin, row as any, data.businessId, data.kind, rec.staffEmail,
    );
    return { ...session, signerEmail: rec.staffEmail };
  });
