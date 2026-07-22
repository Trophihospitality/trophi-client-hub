// ============================================================
// Payment Authorization — Phase 3 server functions.
//
// generatePaymentAuthorizationFn: Trophi staff triggers this after the
// client captures the Stripe payment method(s). It calls the shared
// builder in payment-auth.server.ts (which enforces the SAME blank-guard
// + silent-send pattern as the contract bundle), then upserts the
// client_contracts row of kind='payment_authorization'.
//
// createPaymentAuthSessionFn: client-facing embedded signing session.
// Mirrors createSigningSessionFn but is scoped to a single doc kind.
//
// getPaymentAuthStatusFn: unified status snapshot for both Trophi and
// client sides — combines the client_contracts row + PandaDoc recipient
// state so the UI can render "Sign now" vs "Signed — Trophi archiving".
//
// voidPaymentAuthFn: admin/manager only — soft-void the current doc so
// scope or method changes can trigger a regenerate.
// ============================================================

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const businessIdSchema = z.object({ businessId: z.string() });
const generateSchema = z.object({
  businessId: z.string(),
  // 'ensure' = self-healing: reuse any live doc, only create if truly missing.
  //   Used by the CLIENT "Continue to authorization" path so a transient
  //   sandbox 429/409 or a doc already created by staff never dead-ends.
  // 'regenerate' = admin escape hatch: void any non-completed row and rebuild.
  intent: z.enum(['ensure', 'regenerate']).optional(),
});

async function assertStaff(supabase: any, businessId: string) {
  const { data: ok } = await supabase.rpc('is_trophi_staff_for', { _business_id: businessId });
  if (!ok) throw new Error('Forbidden');
}
async function assertClientOrStaff(supabase: any, businessId: string): Promise<'client' | 'staff'> {
  const { data: c } = await supabase.rpc('is_client_admin_for', { _business_id: businessId });
  if (c) return 'client';
  const { data: s } = await supabase.rpc('is_trophi_staff_for', { _business_id: businessId });
  if (s) return 'staff';
  throw new Error('Forbidden');
}

export interface PaymentAuthStatus {
  exists: boolean;
  pandadocDocumentId: string | null;
  status: string | null;
  errored: boolean;
  errorMessage: string | null;
  blankFields: string[];
  clientSigned: boolean;
  staffSigned: boolean;
  completed: boolean;
  signedPdfPath: string | null;
  executedAt: string | null;
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
    staffSigned: (staff ? signed(staff) : true) || status === 'document.completed',
    status,
  };
}

export const getPaymentAuthStatusFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => businessIdSchema.parse(d))
  .handler(async ({ data, context }): Promise<PaymentAuthStatus> => {
    await assertClientOrStaff(context.supabase, data.businessId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: row } = await supabaseAdmin.from('client_contracts')
      .select('pandadoc_document_id, status, metadata, signed_pdf_path, executed_at')
      .eq('business_id', data.businessId).eq('kind', 'payment_authorization')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (!row) {
      return {
        exists: false, pandadocDocumentId: null, status: null,
        errored: false, errorMessage: null, blankFields: [],
        clientSigned: false, staffSigned: false, completed: false,
        signedPdfPath: null, executedAt: null,
      };
    }
    const md = (row.metadata ?? {}) as any;
    const blankFields: string[] = Array.isArray(md.blank_fields) ? md.blank_fields : [];
    const errored = row.status === 'error' || blankFields.length > 0;
    const completedByStatus = row.status === 'document.completed' || row.status === 'completed';

    let rec = { clientSigned: completedByStatus, staffSigned: completedByStatus, status: row.status };
    if (!errored && row.pandadoc_document_id) {
      try { rec = { ...rec, ...(await fetchRecipientState(row.pandadoc_document_id)) }; }
      catch { /* keep fallback */ }
    }

    return {
      exists: true,
      pandadocDocumentId: row.pandadoc_document_id,
      status: row.status,
      errored,
      errorMessage: md.error ?? null,
      blankFields,
      clientSigned: rec.clientSigned,
      staffSigned: rec.staffSigned,
      completed: completedByStatus || (rec.clientSigned && rec.staffSigned),
      signedPdfPath: row.signed_pdf_path ?? null,
      executedAt: row.executed_at ?? null,
    };
  });

// Staff (or the client, via portal) triggers this once all payment
// methods for the recorded scope have been captured. Voids any existing
// non-complete Payment Auth row first so a scope/method change cleanly
// produces a new signable document.
export const generatePaymentAuthorizationFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => generateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const caller = await assertClientOrStaff(supabase, data.businessId);
    const intent = data.intent ?? 'ensure';

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    // Read scope + client + template
    const [{ data: rec }, { data: tpl }] = await Promise.all([
      supabaseAdmin.from('onboarding_records')
        .select('payment_scope, current_step')
        .eq('business_id', data.businessId).maybeSingle(),
      supabaseAdmin.from('pandadoc_templates')
        .select('template_id').eq('key', 'payment_authorization').maybeSingle(),
    ]);
    if (!rec?.payment_scope) throw new Error('Payment scope not recorded yet (Step 2)');
    if (!tpl?.template_id) throw new Error('Payment Authorization PandaDoc template ID is not configured. Ask an admin to set it in Admin → PandaDoc Templates.');

    const { data: existing } = await supabaseAdmin.from('client_contracts')
      .select('id, status, pandadoc_document_id, metadata')
      .eq('business_id', data.businessId).eq('kind', 'payment_authorization')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    const isCompleted = (s: string | null) => s === 'document.completed' || s === 'completed';
    const existingMd = (existing?.metadata ?? {}) as any;
    const existingBlank = Array.isArray(existingMd.blank_fields) ? existingMd.blank_fields : [];
    const existingErrored = existing && (existing.status === 'error' || existingBlank.length > 0);
    const existingLive =
      existing && !!existing.pandadoc_document_id && existing.status !== 'void' && !existingErrored && !isCompleted(existing.status);

    // Self-healing reuse: if a live doc already exists (from a prior client
    // attempt or a staff manual click), just hand it back. Never dead-end.
    if (intent === 'ensure' && existingLive) {
      return {
        ok: true, id: existing!.id, reused: true, blankFields: [] as string[], error: null as string | null,
      };
    }
    if (existing && isCompleted(existing.status)) {
      throw new Error('Payment Authorization is already fully executed for this client.');
    }

    // Void any non-completed row before rebuilding (regenerate, or ensure
    // with an errored/voided prior row).
    if (existing && !isCompleted(existing.status) && existing.status !== 'void') {
      await supabaseAdmin.from('client_contracts').update({
        status: 'void', updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
    }

    // Wrap the PandaDoc build so a transient sandbox failure surfaces as a
    // friendly retry to the client AND leaves a trail for staff, without
    // creating a poisoned error row that blocks the next retry.
    const { buildAndCreatePaymentAuthDoc } = await import('@/lib/payment-auth.server');
    let result;
    try {
      result = await buildAndCreatePaymentAuthDoc({
        supabaseAdmin,
        businessId: data.businessId,
        scope: rec.payment_scope as 'brand' | 'per_location',
        templateUuid: tpl.template_id,
        actorUserId: userId,
      });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      console.error(`[payment-auth] generate failed for ${data.businessId} (caller=${caller}):`, msg);
      await supabaseAdmin.from('client_activity').insert({
        business_id: data.businessId,
        type: 'info_updated',
        description: `Payment Authorization generation hit a transient error (${caller} attempt): ${msg}. Client can retry from portal.`,
        actor: 'System',
      });
      // Friendly retryable error — client UI catches and shows retry state.
      const isTransient = /\b(429|409|throttl|rate limit|timeout|temporarily)/i.test(msg);
      throw new Error(
        isTransient
          ? "We're still preparing your document. Please try again in a minute."
          : `Could not prepare the Payment Authorization: ${msg}`,
      );
    }

    const locationIds = result.snapshot.map((s) => s.locationId).filter(Boolean) as string[];

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('client_contracts')
      .insert({
        business_id: data.businessId,
        kind: 'payment_authorization',
        pandadoc_document_id: result.documentId,
        status: result.status,
        location_ids: locationIds.length ? locationIds : null,
        document_name: `Payment Authorization`,
        metadata: {
          scope: rec.payment_scope,
          blank_fields: result.blankFields,
          error: result.error ?? null,
          snapshot: JSON.parse(JSON.stringify(result.snapshot)),
        } as any,
      })
      .select('id').single();
    if (insErr) throw new Error(insErr.message);


    await supabaseAdmin.from('client_activity').insert({
      business_id: data.businessId,
      type: 'info_updated',
      description: result.error
        ? `Payment Authorization created with blank-field error: ${result.blankFields.join(', ')}`
        : `Payment Authorization document created and sent for client signing (${caller})`,
      actor: (await supabaseAdmin.from('profiles').select('name').eq('user_id', userId).maybeSingle()).data?.name ?? 'User',
    });

    return { ok: true, id: inserted.id, reused: false, blankFields: result.blankFields, error: result.error ?? null };
  });

// Client (or staff on client's behalf) opens the embedded PandaDoc session
// for the Payment Authorization doc.
export const createPaymentAuthSessionFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => businessIdSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ sessionUrl: string; expiresAt: string }> => {
    await assertClientOrStaff(context.supabase, data.businessId);

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const [{ data: client }, { data: row }] = await Promise.all([
      supabaseAdmin.from('clients').select('contact_email').eq('business_id', data.businessId).maybeSingle(),
      supabaseAdmin.from('client_contracts')
        .select('id, pandadoc_document_id, status, metadata')
        .eq('business_id', data.businessId).eq('kind', 'payment_authorization')
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!client?.contact_email) throw new Error('Client POC email not set');
    if (!row?.pandadoc_document_id) throw new Error('Payment Authorization document has not been generated yet');

    const md = (row.metadata ?? {}) as any;
    const blank = Array.isArray(md.blank_fields) ? md.blank_fields : [];
    if (row.status === 'error' || blank.length > 0) {
      throw new Error(`This document is not ready to sign — required fields are empty (${blank.join(', ') || 'see admin'}).`);
    }

    const { pandadoc } = await import('@/lib/pandadoc.server');
    let current = String(row.status ?? '');
    if (current === 'document.uploaded' || current === 'uploaded' || current === 'document.draft' || current === 'draft') {
      try {
        current = await pandadoc.waitForDraft(row.pandadoc_document_id);
        await pandadoc.sendDocument(row.pandadoc_document_id, {
          subject: 'Trophi Hospitality — Payment Authorization',
          message: 'Signing happens inside the Trophi client portal. You should not receive this email.',
          silent: true,
        });
        await supabaseAdmin.from('client_contracts')
          .update({ status: 'document.sent', updated_at: new Date().toISOString() })
          .eq('id', row.id);
      } catch (err: any) {
        throw new Error(`Could not prepare document for signing: ${err?.message ?? err}`);
      }
    }

    const session = await pandadoc.createSession(row.pandadoc_document_id, client.contact_email, 900);
    return { sessionUrl: `https://app.pandadoc.com/s/${session.id}`, expiresAt: session.expires_at };
  });

// Admin/manager escape hatch. Voids the current non-complete Payment Auth
// so the panel can regenerate. Completed docs cannot be voided.
export const voidPaymentAuthFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => businessIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, data.businessId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: row } = await supabaseAdmin.from('client_contracts')
      .select('id, status').eq('business_id', data.businessId).eq('kind', 'payment_authorization')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!row) throw new Error('No Payment Authorization exists');
    if (row.status === 'document.completed' || row.status === 'completed') {
      throw new Error('Cannot void a fully executed Payment Authorization');
    }
    await supabaseAdmin.from('client_contracts').update({
      status: 'void', updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    await supabaseAdmin.from('client_activity').insert({
      business_id: data.businessId, type: 'info_updated',
      description: 'Payment Authorization voided — regenerate after updating scope or payment methods',
      actor: (await supabaseAdmin.from('profiles').select('name').eq('user_id', context.userId).maybeSingle()).data?.name ?? 'User',
    });
    return { ok: true };
  });
