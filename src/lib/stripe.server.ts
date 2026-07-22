// Server-only Stripe client. Never import from *.functions.ts or route
// files at module scope; load dynamically inside handlers:
//   const { stripe, getStripeWebhookSecret } = await import('@/lib/stripe.server');
//
// Runs on Cloudflare Workers via Stripe's fetch HTTP client. The async
// webhook verifier uses SubtleCrypto (no Node crypto needed).
import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  _stripe = new Stripe(key, {
    apiVersion: '2024-06-20' as any,
    httpClient: Stripe.createFetchHttpClient(),
  });
  return _stripe;
}

// Alias so call sites read naturally.
export const stripe = new Proxy({} as Stripe, {
  get(_t, prop, receiver) {
    return Reflect.get(getStripe(), prop, receiver);
  },
});

// Phase 1 discipline: refuse to treat placeholder / empty webhook
// secrets as valid. Real Stripe webhook signing secrets always begin
// with `whsec_`. If a caller has stubbed something else in for local
// development, we hard-fail so a "green" webhook can never lie.
export function getStripeWebhookSecret(): string {
  const raw = process.env.STRIPE_WEBHOOK_SECRET;
  if (!raw || !raw.trim()) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  const v = raw.trim();
  if (!v.startsWith('whsec_')) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET does not look like a real Stripe signing secret (must start with "whsec_"). ' +
        'Replace the placeholder with the value from Stripe → Developers → Webhooks before enabling payments.',
    );
  }
  return v;
}

export function isStripeWebhookSecretReal(): boolean {
  try {
    getStripeWebhookSecret();
    return true;
  } catch {
    return false;
  }
}
