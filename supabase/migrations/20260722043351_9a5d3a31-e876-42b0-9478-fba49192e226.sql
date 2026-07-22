
-- Client users can read THEIR OWN client row.
CREATE POLICY "clients read by client portal user"
ON public.clients FOR SELECT TO authenticated
USING (public.is_client_admin_for(business_id));

-- Client users can read THEIR OWN onboarding record.
CREATE POLICY "onboarding record readable by client user"
ON public.onboarding_records FOR SELECT TO authenticated
USING (public.is_client_admin_for(business_id));

-- Client users can read THEIR OWN onboarding step progress, but only for
-- steps that are flagged client_visible in the definitions table.
CREATE POLICY "onboarding step progress readable by client user"
ON public.onboarding_step_progress FOR SELECT TO authenticated
USING (
  public.is_client_admin_for(business_id)
  AND EXISTS (
    SELECT 1 FROM public.onboarding_step_definitions d
    WHERE d.step_number = onboarding_step_progress.step_number
      AND d.client_visible = true
  )
);
