import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

// ============================================================
// Client Portal — Step 4 embedded signing.
// Caller must be an active client_users row for the businessId.
// Trophi staff assigned to the client can also start sessions
// (useful for support). Never trigger PandaDoc emails — sends
// happen with silent:true so all signing stays in-portal.
// ============================================================

export type BundleKind = 'msa' | 'order_form' | 'client_authorization';
const BUNDLE_KINDS: BundleKind[] = ['msa', 'order_form', 'client_authorization'];
const KIND_LABELS: Record<BundleKind, string> = {
  msa: 'Master Services Agreement',
  order_form: 'Order Form',
  client_authorization: 'Client Authorization',
};

async function assertCanSignForClient(supabase: any, userId: string, businessId: string) {
  // Trust the DB helper: client admin OR trophi staff for this client.
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
  completed: boolean;
  errored: boolean;
  errorMessage: string | null;
  blankFields: string[];
}

export const getClientContractsFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string() }).parse(d))
  .handler(async ({ data, context }): Promise<{
    contracts: ClientContractRow[];
    signerEmail: string;
    allComplete: boolean;
    anyErrored: boolean;
  }> => {
    const { supabase, userId } = context;
    await assertCanSignForClient(supabase, userId, data.businessId);

    const [{ data: client }, { data: contracts }] = await Promise.all([
      supabase.from('clients').select('contact_email').eq('business_id', data.businessId).maybeSingle(),
      supabase.from('client_contracts').select('kind, status, pandadoc_document_id, metadata')
        .eq('business_id', data.businessId).in('kind', BUNDLE_KINDS),
    ]);
    if (!client?.contact_email) throw new Error('Client POC email not set');

    const rows: ClientContractRow[] = BUNDLE_KINDS.map((kind) => {
      const r = (contracts ?? []).find((c: any) => c.kind === kind);
      const status = r?.status ?? 'not_created';
      const md = (r?.metadata ?? {}) as any;
      const blankFields = Array.isArray(md.blank_fields) ? md.blank_fields : [];
      const errored = status === 'error' || blankFields.length > 0;
      return {
        kind,
        label: KIND_LABELS[kind],
        status,
        pandadocDocumentId: r?.pandadoc_document_id ?? null,
        completed: status === 'document.completed' || status === 'completed',
        errored,
        errorMessage: md.error ?? null,
        blankFields,
      };
    });

    return {
      contracts: rows,
      signerEmail: client.contact_email,
      allComplete: rows.length > 0 && rows.every((r) => r.completed),
      anyErrored: rows.some((r) => r.errored),
    };
  });

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
      .select('pandadoc_document_id, status')
      .eq('business_id', data.businessId).eq('kind', data.kind).maybeSingle();
    if (!row?.pandadoc_document_id) throw new Error('Document has not been generated yet');

    const { pandadoc } = await import('@/lib/pandadoc.server');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    // A session requires document.sent state (or later). Docs may still be
    // in document.uploaded (processing) or document.draft — silent-send in
    // both cases so no PandaDoc email is triggered.
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
      }).eq('business_id', data.businessId).eq('kind', data.kind);
    }

    const session = await pandadoc.createSession(
      row.pandadoc_document_id,
      client.contact_email,
      900,
    );

    return {
      sessionUrl: `https://app.pandadoc.com/s/${session.id}`,
      expiresAt: session.expires_at,
    };
  });
