// Payment Authorization document builder (Phase 1 wiring — no callers
// in the UI yet). Mirrors buildAndCreateBundleDoc in
// src/lib/contracts.functions.ts so the SAME blank-guard + silent-send
// pattern applies to the Payment Authorization document generated at
// onboarding Step 5, after Stripe has captured payment methods and we
// know the real last4 values.
//
// Phase 3 will call buildAndCreatePaymentAuthDoc(...) from a server
// function tied to Step 5 completion. Do not import at module scope
// from route files or *.functions.ts — use dynamic import inside
// handlers.

import type { SupabaseClient } from '@supabase/supabase-js';

export type PaymentScope = 'brand' | 'per_location';

// Required merge fields for the Payment Authorization PandaDoc
// template. Field NAMES must exactly match the template (case-
// sensitive). If a merge field cannot be populated, the blank-guard
// marks the row errored and refuses to silent-send.
export const PAYMENT_AUTH_REQUIRED_FIELDS = [
  'Company',
  'BusinessId',
  'ContactName',
  'ContactRole',
  'ContactEmail',
  'PaymentScope',
  'PaymentSummary',
] as const;

export interface BuildPaymentAuthArgs {
  supabaseAdmin: SupabaseClient<any>;
  businessId: string;
  scope: PaymentScope;
  templateUuid: string;
  actorUserId: string;
}

interface PaymentMethodSnapshot {
  scope: 'brand' | 'location';
  locationId: string | null;
  locationName: string | null;
  brand: string | null;
  last4: string;
  methodType: string;
}

export interface BuildPaymentAuthResult {
  documentId: string;
  status: string;
  blankFields: string[];
  error?: string;
  snapshot: PaymentMethodSnapshot[];
}

function splitName(name: string | null | undefined): { firstName: string; lastName: string } {
  const s = (name ?? '').trim();
  if (!s) return { firstName: '', lastName: '' };
  const parts = s.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function loadPaymentAuthContext(supabaseAdmin: SupabaseClient<any>, businessId: string, scope: PaymentScope) {
  const [
    { data: client, error: cErr },
    { data: locations, error: lErr },
    { data: methods, error: mErr },
  ] = await Promise.all([
    supabaseAdmin.from('clients').select('*').eq('business_id', businessId).maybeSingle(),
    supabaseAdmin.from('locations').select('location_id, name, status').eq('business_id', businessId).eq('status', 'active'),
    supabaseAdmin.from('payment_methods').select('*').eq('business_id', businessId),
  ]);
  if (cErr) throw cErr;
  if (lErr) throw lErr;
  if (mErr) throw mErr;
  if (!client) throw new Error('Client not found');

  const locMap = new Map<string, any>((locations ?? []).map((l: any) => [l.location_id, l]));

  const expectedScope = scope === 'brand' ? 'brand' : 'location';
  const snapshot: PaymentMethodSnapshot[] = (methods ?? [])
    .filter((m: any) => m.scope === expectedScope)
    .map((m: any) => ({
      scope: m.scope,
      locationId: m.location_id ?? null,
      locationName: m.location_id ? (locMap.get(m.location_id)?.name ?? null) : null,
      brand: m.brand ?? null,
      last4: m.last4,
      methodType: m.method_type,
    }));

  if (scope === 'brand' && snapshot.length === 0) {
    throw new Error('No brand-level payment method captured yet');
  }
  if (scope === 'per_location') {
    const covered = new Set(snapshot.map((s) => s.locationId));
    const missing = (locations ?? []).filter((l: any) => !covered.has(l.location_id));
    if (missing.length > 0) {
      throw new Error(
        `Missing per-location payment methods for: ${missing.map((l: any) => l.name || l.location_id).join(', ')}`,
      );
    }
  }

  return { client, snapshot };
}

function formatPaymentLine(pm: PaymentMethodSnapshot): string {
  const brandLabel = pm.methodType === 'card' ? (pm.brand ?? 'Card') : `ACH${pm.brand ? ` (${pm.brand})` : ''}`;
  const target = pm.locationId ? `${pm.locationName ?? pm.locationId} (${pm.locationId})` : 'Brand-wide';
  return `${target} — ${brandLabel} •••• ${pm.last4}`;
}

export async function buildAndCreatePaymentAuthDoc(args: BuildPaymentAuthArgs): Promise<BuildPaymentAuthResult> {
  const { supabaseAdmin, businessId, scope, templateUuid } = args;
  const { pandadoc } = await import('@/lib/pandadoc.server');

  const { client, snapshot } = await loadPaymentAuthContext(supabaseAdmin, businessId, scope);

  const summary = snapshot.map(formatPaymentLine).join('\n');
  const scopeLabel = scope === 'brand' ? 'Brand-wide (single payment method)' : 'Per-location (one method per active location)';

  const merge: Record<string, string> = {
    Company: client.company ?? '',
    BusinessId: client.business_id,
    ContactName: client.contact_name ?? '',
    ContactRole: client.contact_role ?? '',
    ContactEmail: client.contact_email ?? '',
    PaymentScope: scopeLabel,
    PaymentSummary: summary,
    // Convenience single-value merge; only populated on brand scope, on
    // per-location scope PaymentSummary carries the full breakdown.
    PaymentLast4: snapshot.length === 1 ? snapshot[0].last4 : '',
  };

  const clientNames = splitName(client.contact_name);
  const recipients = [
    {
      email: client.contact_email,
      first_name: clientNames.firstName,
      last_name: clientNames.lastName,
      role: 'client',
    },
  ];

  const locationIds = snapshot.map((s) => s.locationId).filter(Boolean).join(',');

  const doc = await pandadoc.createFromTemplate({
    name: `Payment Authorization — ${client.company} (${client.business_id})`,
    templateUuid,
    recipients,
    tokens: merge,
    fields: merge,
    metadata: {
      business_id: client.business_id,
      kind: 'payment_authorization',
      location_ids: locationIds,
      signer_email_at_creation: client.contact_email,
      scope,
    },
  });

  let status = String(doc.status || 'document.uploaded');
  try {
    status = await pandadoc.waitForDraft(doc.id);
  } catch { /* fall through to verification */ }

  const details = await pandadoc.getDocument(doc.id);
  const fieldMap = new Map<string, string>();
  for (const f of (details as any).fields ?? []) {
    const name = f.name ?? f.merge_field ?? f.field_id;
    if (!name) continue;
    const val = typeof f.value === 'string' ? f.value : '';
    fieldMap.set(String(name), val);
  }
  const blankFields = PAYMENT_AUTH_REQUIRED_FIELDS.filter((k) => {
    const v = fieldMap.get(k);
    return v == null || v.trim() === '';
  });

  if (blankFields.length > 0) {
    return {
      documentId: doc.id,
      status: 'error',
      blankFields: [...blankFields],
      error:
        `PandaDoc created the Payment Authorization but did not populate required merge fields: ${blankFields.join(', ')}. ` +
        `Confirm the template's field NAMES match exactly (case-sensitive). Sign now is disabled until this is fixed.`,
      snapshot,
    };
  }

  try {
    await pandadoc.sendDocument(doc.id, {
      subject: 'Trophi Hospitality — Payment Authorization',
      message: 'Signing happens inside the Trophi client portal. You should not receive this email.',
      silent: true,
    });
    status = 'document.sent';
  } catch (err) {
    console.warn(`[payment-auth] silent send failed for ${doc.id}:`, err);
  }

  return { documentId: doc.id, status, blankFields: [], snapshot };
}
