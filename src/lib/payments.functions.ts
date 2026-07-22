// Payment method setup — Phase 1 server plumbing.
// The client-side Stripe Elements integration (Phase 3) will call
// createSetupIntentFn to obtain a SetupIntent client_secret and a
// (cached) Stripe customer id for the given payment scope. This module
// deliberately does NOT store card numbers, expiries, CVV, or full bank
// account numbers — Stripe holds all sensitive PANs. On successful
// setup, the /api/public/hooks/stripe webhook records only:
//   - stripe_customer_id
//   - stripe_payment_method_id (tokenised handle)
//   - method_type ('card' | 'us_bank_account')
//   - brand + last4 (display-only)
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const setupIntentSchema = z.object({
  businessId: z.string().min(1),
  scope: z.enum(['brand', 'location']),
  locationId: z.string().nullable().optional(),
});

async function assertClientAccess(supabase: any, userId: string, businessId: string) {
  // is_client_admin_for / is_trophi_staff_for both check via RLS-safe
  // helpers. We rely on RLS on payment_methods / payment_authorizations,
  // but also gate SetupIntent creation to callers who can actually see
  // the client so we don't leak the existence of businessIds.
  const [{ data: staffOk }, { data: clientOk }] = await Promise.all([
    supabase.rpc('is_trophi_staff_for', { _business_id: businessId }),
    supabase.rpc('is_client_admin_for', { _business_id: businessId }),
  ]);
  if (!(staffOk === true || clientOk === true)) {
    throw new Error('Forbidden');
  }
}

async function assertLocationBelongs(supabase: any, businessId: string, locationId: string) {
  const { data, error } = await supabase
    .from('locations')
    .select('location_id, business_id, status')
    .eq('location_id', locationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.business_id !== businessId) {
    throw new Error('Location does not belong to this client');
  }
  if (data.status !== 'active') {
    throw new Error('Location is not active');
  }
}

export const createSetupIntentFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => setupIntentSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertClientAccess(supabase, userId, data.businessId);

    if (data.scope === 'location') {
      if (!data.locationId) throw new Error('locationId is required for location scope');
      await assertLocationBelongs(supabase, data.businessId, data.locationId);
    }

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { stripe } = await import('@/lib/stripe.server');

    // Reuse an existing Stripe customer if this scope already has a
    // payment method registered for it. Otherwise create a new customer
    // scoped to the businessId (+ locationId when per-location).
    const scopeFilter = data.scope === 'location'
      ? { scope: 'location', location_id: data.locationId! }
      : { scope: 'brand', location_id: null as string | null };

    let existingQuery = supabaseAdmin
      .from('payment_methods')
      .select('stripe_customer_id')
      .eq('business_id', data.businessId)
      .eq('scope', scopeFilter.scope);
    existingQuery = scopeFilter.location_id
      ? existingQuery.eq('location_id', scopeFilter.location_id)
      : existingQuery.is('location_id', null);
    const { data: existing } = await existingQuery.limit(1).maybeSingle();

    let customerId = existing?.stripe_customer_id as string | undefined;

    if (!customerId) {
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('company, contact_email, contact_name')
        .eq('business_id', data.businessId)
        .maybeSingle();

      const customer = await stripe.customers.create({
        email: client?.contact_email ?? undefined,
        name: client?.company ?? undefined,
        metadata: {
          business_id: data.businessId,
          scope: data.scope,
          ...(data.scope === 'location' ? { location_id: data.locationId! } : {}),
        },
      });
      customerId = customer.id;
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card', 'us_bank_account'],
      usage: 'off_session',
      metadata: {
        business_id: data.businessId,
        scope: data.scope,
        ...(data.scope === 'location' ? { location_id: data.locationId! } : {}),
      },
    });

    return {
      clientSecret: setupIntent.client_secret!,
      customerId,
      setupIntentId: setupIntent.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
    };
  });

// Display-only listing (brand, last4, method type). Safe for both Trophi
// staff and the client_admin of the same business — the projection deliberately
// omits stripe_customer_id / stripe_payment_method_id.
export const listPaymentMethodsFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertClientAccess(context.supabase, context.userId, data.businessId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: rows, error } = await supabaseAdmin
      .from('payment_methods')
      .select('id, scope, location_id, method_type, brand, last4, is_default, created_at')
      .eq('business_id', data.businessId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// Full Step 5 readiness snapshot: scope from onboarding_records +
// list of "slots" that need a payment method, computed from active
// locations. Used by the client portal (to render Add Payment
// buttons) and by the Trophi onboarding page (status card).
export const getPaymentSetupStatusFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertClientAccess(supabase, userId, data.businessId);

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    const [{ data: rec }, { data: locations }, { data: methods }] = await Promise.all([
      supabaseAdmin.from('onboarding_records')
        .select('payment_scope, payment_scope_recorded_at, current_step')
        .eq('business_id', data.businessId).maybeSingle(),
      supabaseAdmin.from('locations')
        .select('location_id, name, status')
        .eq('business_id', data.businessId).eq('status', 'active')
        .order('location_id'),
      supabaseAdmin.from('payment_methods')
        .select('id, scope, location_id, method_type, brand, last4, is_default, created_at')
        .eq('business_id', data.businessId),
    ]);

    const scope = (rec?.payment_scope ?? null) as 'brand' | 'per_location' | null;

    // Build the "slots" that need a captured payment method
    interface Slot {
      key: string;
      scope: 'brand' | 'location';
      locationId: string | null;
      locationName: string | null;
      captured: {
        methodType: string;
        brand: string | null;
        last4: string;
        capturedAt: string;
      } | null;
    }

    const slots: Slot[] = [];
    if (scope === 'brand') {
      const m = (methods ?? []).find((x: any) => x.scope === 'brand');
      slots.push({
        key: 'brand',
        scope: 'brand',
        locationId: null,
        locationName: null,
        captured: m ? {
          methodType: m.method_type, brand: m.brand, last4: m.last4, capturedAt: m.created_at,
        } : null,
      });
    } else if (scope === 'per_location') {
      for (const loc of locations ?? []) {
        const m = (methods ?? []).find((x: any) => x.scope === 'location' && x.location_id === loc.location_id);
        slots.push({
          key: `loc:${loc.location_id}`,
          scope: 'location',
          locationId: loc.location_id,
          locationName: loc.name,
          captured: m ? {
            methodType: m.method_type, brand: m.brand, last4: m.last4, capturedAt: m.created_at,
          } : null,
        });
      }
    }

    const filled = slots.filter((s) => s.captured).length;
    const allCaptured = slots.length > 0 && filled === slots.length;

    return {
      businessId: data.businessId,
      scope,
      scopeRecordedAt: rec?.payment_scope_recorded_at ?? null,
      currentStep: rec?.current_step ?? null,
      slots,
      filled,
      total: slots.length,
      allCaptured,
    };
  });

