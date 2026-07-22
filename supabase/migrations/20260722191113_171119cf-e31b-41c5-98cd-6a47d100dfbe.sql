
-- 1. Payment scope on onboarding_records
ALTER TABLE public.onboarding_records
  ADD COLUMN IF NOT EXISTS payment_scope text,
  ADD COLUMN IF NOT EXISTS payment_scope_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_scope_recorded_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_records_payment_scope_chk'
  ) THEN
    ALTER TABLE public.onboarding_records
      ADD CONSTRAINT onboarding_records_payment_scope_chk
      CHECK (payment_scope IS NULL OR payment_scope IN ('brand','per_location'));
  END IF;
END $$;

-- 2. Rename step 2 and step 5 for clarity
UPDATE public.onboarding_step_definitions
   SET name = 'Record Payment Scope',
       actor = 'account_owner',
       client_visible = false,
       description = 'Account owner records whether payment is brand-wide (one method) or per-location (one per active location). No document is created at this step; the Payment Authorization is generated at Step 5 after Stripe captures the actual payment methods.'
 WHERE step_number = 2;

UPDATE public.onboarding_step_definitions
   SET name = 'Payment Authorization',
       actor = 'client',
       client_visible = true,
       description = 'Client captures payment method(s) via Stripe per the recorded scope, then signs the Payment Authorization in-portal. Auto-completes on the PandaDoc completion webhook.'
 WHERE step_number = 5;

-- 3. Register the PandaDoc template key. Staff pastes the real UUID
--    in Admin → PandaDoc Templates before Step 5 can be signed.
INSERT INTO public.pandadoc_templates (key, template_id, label, notes)
VALUES ('payment_authorization', NULL, 'Payment Authorization',
        'Signed at onboarding Step 5. Required merge fields (case-sensitive): Company, BusinessId, ContactName, ContactRole, ContactEmail, PaymentScope, PaymentSummary. Optional: PaymentLast4 (only populated when brand-scope with a single method).')
ON CONFLICT (key) DO NOTHING;

-- 4. Extend client_contracts SELECT so client_admin can see the
--    Payment Authorization row on their own client. Trophi visibility
--    is unchanged. INSERT/UPDATE/DELETE policies remain Trophi-only —
--    all client-driven writes happen via SECURITY DEFINER server fns.
DROP POLICY IF EXISTS "Trophi + client_admin read contracts" ON public.client_contracts;
CREATE POLICY "Trophi + client_admin read contracts"
ON public.client_contracts
FOR SELECT
USING (
  public.is_trophi_staff_for(business_id)
  OR (
    kind = ANY (ARRAY['bundle','msa','order_form','client_authorization','payment_authorization'])
    AND public.is_client_admin_for(business_id)
  )
);
