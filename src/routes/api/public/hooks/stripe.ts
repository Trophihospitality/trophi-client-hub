// Stripe webhook receiver (Phase 1).
//
// Verifies every payload with Stripe's async webhook verifier
// (SubtleCrypto under the hood — Worker-safe). Refuses to process any
// event unless STRIPE_WEBHOOK_SECRET is a real `whsec_...` signing
// secret; a placeholder is treated as misconfigured and returns 500.
//
// On setup_intent.succeeded we resolve the underlying PaymentMethod and
// insert a payment_methods row with ONLY tokens + display metadata
// (brand, last4). Nothing sensitive is stored.
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/hooks/stripe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const sig = request.headers.get('stripe-signature');
        if (!sig) return new Response('Missing stripe-signature', { status: 400 });

        const body = await request.text();

        const { stripe, getStripeWebhookSecret } = await import('@/lib/stripe.server');
        let secret: string;
        try {
          secret = getStripeWebhookSecret();
        } catch (err: any) {
          console.error('[stripe-webhook] refusing to process:', err?.message);
          return new Response('Webhook secret not configured', { status: 500 });
        }

        let event: any;
        try {
          event = await stripe.webhooks.constructEventAsync(body, sig, secret);
        } catch (err: any) {
          console.warn('[stripe-webhook] signature verification failed:', err?.message);
          return new Response('Invalid signature', { status: 401 });
        }

        try {
          switch (event.type) {
            case 'setup_intent.succeeded':
              await handleSetupIntentSucceeded(event.data.object);
              break;
            case 'payment_method.detached':
              await handlePaymentMethodDetached(event.data.object);
              break;
            default:
              // Ignore other events for Phase 1.
              break;
          }
        } catch (err: any) {
          console.error(`[stripe-webhook] handler failed for ${event.type}:`, err);
          // Return 500 so Stripe retries.
          return new Response('Handler failed', { status: 500 });
        }

        return new Response('ok');
      },
    },
  },
});

async function handleSetupIntentSucceeded(setupIntent: any) {
  const md = (setupIntent.metadata ?? {}) as Record<string, string>;
  const businessId = md.business_id;
  const scope = md.scope as 'brand' | 'location' | undefined;
  const locationId = md.location_id ?? null;
  const customerId: string | null = setupIntent.customer ?? null;
  const paymentMethodId: string | null = setupIntent.payment_method ?? null;

  if (!businessId || !scope || !customerId || !paymentMethodId) {
    console.warn('[stripe-webhook] setup_intent.succeeded missing metadata', {
      hasBusinessId: !!businessId, scope, hasCustomer: !!customerId, hasPm: !!paymentMethodId,
    });
    return;
  }

  const { stripe } = await import('@/lib/stripe.server');
  const pm: any = await stripe.paymentMethods.retrieve(paymentMethodId);

  const methodType = pm.type as string;
  let brand: string | null = null;
  let last4: string | null = null;
  if (methodType === 'card' && pm.card) {
    brand = pm.card.brand ?? null;
    last4 = pm.card.last4 ?? null;
  } else if (methodType === 'us_bank_account' && pm.us_bank_account) {
    brand = pm.us_bank_account.bank_name ?? null;
    last4 = pm.us_bank_account.last4 ?? null;
  }
  if (!last4) {
    console.warn('[stripe-webhook] could not derive last4 for', paymentMethodId, methodType);
    return;
  }
  if (methodType !== 'card' && methodType !== 'us_bank_account') {
    console.warn('[stripe-webhook] unsupported payment method type', methodType);
    return;
  }

  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

  // First method for this scope becomes default.
  const { count } = await supabaseAdmin
    .from('payment_methods')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('scope', scope)
    .is('location_id', locationId);

  const isDefault = (count ?? 0) === 0;

  const { error } = await supabaseAdmin
    .from('payment_methods')
    .upsert(
      {
        business_id: businessId,
        scope,
        location_id: scope === 'location' ? locationId : null,
        stripe_customer_id: customerId,
        stripe_payment_method_id: paymentMethodId,
        method_type: methodType,
        brand,
        last4,
        is_default: isDefault,
      },
      { onConflict: 'stripe_payment_method_id' },
    );
  if (error) throw new Error(`payment_methods upsert failed: ${error.message}`);

  await supabaseAdmin.from('client_activity').insert({
    business_id: businessId,
    type: 'info_updated',
    description: `Payment method captured (${methodType === 'card' ? brand : 'ACH'} •••• ${last4}) — scope: ${scope}${locationId ? ` · ${locationId}` : ''}`,
    actor: 'Stripe',
  });
}

async function handlePaymentMethodDetached(pm: any) {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  await supabaseAdmin.from('payment_methods').delete().eq('stripe_payment_method_id', pm.id);
}
