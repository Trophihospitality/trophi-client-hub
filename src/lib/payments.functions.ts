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

export const listPaymentMethodsFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ businessId: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from('payment_methods')
      .select('id, scope, location_id, method_type, brand, last4, is_default, created_at')
      .eq('business_id', data.businessId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
