# Production Cutover Checklist

Durable checklist for moving the Trophi Client Hub from sandbox / test infrastructure to live production. Every item must be verified before real clients are onboarded.

Owner: Trophi Hospitality Ops + Engineering
Last reviewed: 2026-07-22

---

## 1. PandaDoc — production account

- [ ] Complete PandaDoc sales process for production API tier (sandbox blocks external-domain sends — this is a fixed tier restriction, no workspace toggle).
- [ ] Swap `PANDADOC_API_KEY` (secret) from sandbox → production key.
- [ ] Re-verify all template UUIDs (MSA, Order Form, Client Authorization, Payment Authorization) exist in the production workspace and either carry over or are re-pasted in `PandaDoc Templates` admin page.
- [ ] Confirm merge-field names on production templates match sandbox names exactly (no field-name drift).
- [ ] Run a full external-domain client end-to-end: bundle generation → client sign → Trophi countersign → webhook cascade → PDF archived in Storage. **Test Tavern (TRP-5PNE8R) is the designated cutover test case** — it is currently blocked-by-sandbox with its three contracts in the friendly error state.
- [ ] Re-register the PandaDoc webhook against the production account.
- [ ] Rotate `PANDADOC_WEBHOOK_KEY` (secret) to a new shared key and paste into PandaDoc production webhook config.
- [ ] Verify webhook signature validation against production payloads.

## 2. Stripe — live mode

- [ ] Complete Stripe live-account activation (business verification + bank account connected + payout schedule confirmed).
- [ ] Swap `STRIPE_SECRET_KEY` (secret) test → live.
- [ ] Swap client publishable key wherever consumed by Stripe Elements → live publishable key.
- [ ] Create production Stripe webhook endpoint pointing at `https://<prod-domain>/api/public/hooks/stripe`.
- [ ] Rotate `STRIPE_WEBHOOK_SECRET` (secret) to the live endpoint's signing secret.
- [ ] Confirm `payment_methods` upsert path fires end-to-end with a real card/bank in live mode.
- [ ] Confirm Payment Authorization document (Step 5) is generated and archived after live setup intent succeeds.

## 3. Domain + auth

- [ ] Provision custom domain (e.g. `portal.trophihospitality.com`) and complete DNS + SSL in Lovable.
- [ ] Update `PROD_BASE_URL` in `src/lib/app-urls.ts` to the new domain.
- [ ] Update Supabase Auth **Site URL** and add the new domain to the redirect allow-list.
- [ ] Re-register PandaDoc webhook and Stripe webhook with the new domain.
- [ ] Verify invite links, password reset, and OAuth redirects all resolve on the new domain.
- [ ] Verify no code path hard-codes `trophi-client-hub.lovable.app`.

## 4. Legal templates

- [ ] Replace placeholder MSA, Order Form, Client Authorization, and Payment Authorization templates with the attorney-reviewed final documents.
- [ ] Preserve the exact merge-field names — swapping in a new template with renamed fields will silently produce blank contracts.
- [ ] Regenerate a test bundle against each new template and API-readback confirm every required field is populated.

## 5. Email hardening

- [ ] Publish SPF record for the sending domain.
- [ ] Publish DKIM record and confirm signing.
- [ ] Publish DMARC record (start at `p=none` for monitoring, tighten to `quarantine`/`reject` after 2 weeks of clean reports).
- [ ] Set sender display name (e.g. `Trophi Hospitality <no-reply@trophihospitality.com>`) — no bare emails.
- [ ] Deliverability test against Gmail, Outlook/O365, Yahoo, and at least one corporate M365 tenant. Confirm inbox placement, not spam.
- [ ] Configure a monitored reply-to address so client responses don't go to a black hole.

## 6. Data hygiene

- [ ] Delete or clearly segregate all test clients: Test Tavern, Tie Break residue, any dev accounts. Real clients must not share the CRM with test records at cutover.
- [ ] Delete or reset any test auth users created during sandbox testing.
- [ ] Verify no test PandaDoc documents or Stripe customers are referenced by production rows.
- [ ] Verify all demo/seed data is either removed or clearly flagged as `demo`.

## 7. Security + RLS

- [ ] Run the pre-publish security scanner. Every finding must be either fixed or explicitly dispositioned in `@security-memory`.
- [ ] Re-verify RLS as a live client session: sign in as a real client_user and confirm they cannot read another client's data via direct table queries.
- [ ] Re-verify RLS as each Trophi role (admin, manager, account_manager, onboarding_specialist, sales_rep) — confirm scope matches spec.
- [ ] Confirm `service_role` key is not referenced anywhere client-side and only loaded dynamically inside server handlers.
- [ ] Confirm no publishable/anon key grants unintended write access (spot-check `GRANT` statements on public schema).
- [ ] Verify Storage bucket policies: `client-documents` folders enforce business_id scoping, `payment/` folder never exposed to client role.
- [ ] Confirm `enforce_email_uniqueness_*` triggers are active and self-match exemption still works.

## 8. Observability + support

- [ ] Confirm audit_log captures all critical mutations (client status changes, role changes, admin resets, contract voids).
- [ ] Confirm error reporting (Lovable error capture) is wired to a monitored channel — not just console.
- [ ] Document the "admin reset & reinvite" runbook so support can unblock client login issues without engineering.
- [ ] Document the "regenerate contract bundle" runbook for POC email changes / merge-field drift.
- [ ] Establish an on-call rotation or single accountable owner for webhook failures during first 30 days.

## 9. Operational rehearsal

- [ ] Dry-run a full client lifecycle in production before the first real client: Prospecting → Signed → onboarding Steps 1–16 → Go-Live. Time-box each step and note any friction.
- [ ] Verify all reminder / escalation cron jobs (`pg_cron`) fire in production and skip weekends.
- [ ] Verify leaderboards and reports render with real (not seeded) data.

---

## Notes

- Test Tavern's blocked-by-sandbox state is expected and preserved on purpose — it is the canary for item 1 (external-recipient sending in production).
- This document is also rendered at **Admin → Cutover Checklist** inside the portal for at-a-glance status; both copies must stay in sync when edited.
