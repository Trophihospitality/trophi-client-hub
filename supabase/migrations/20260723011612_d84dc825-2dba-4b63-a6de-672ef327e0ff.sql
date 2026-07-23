
-- Helper: onboarding-based visibility of a client
CREATE OR REPLACE FUNCTION public.can_view_client_via_onboarding(_business_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.onboarding_records o
    WHERE o.business_id = _business_id
      AND (
        -- Assigned staff always sees the client
        o.specialist_id = auth.uid()
        OR o.account_manager_id = auth.uid()
        -- Unassigned incoming preview for specialists: steps 1-6 with no specialist yet
        OR (
          public.has_role(auth.uid(), 'onboarding_specialist'::public.app_role)
          AND o.specialist_id IS NULL
          AND o.current_step BETWEEN 1 AND 6
        )
      )
  )
$$;

GRANT EXECUTE ON FUNCTION public.can_view_client_via_onboarding(text) TO authenticated;

-- Clients: allow read via onboarding assignment / incoming preview
DROP POLICY IF EXISTS "clients read via onboarding" ON public.clients;
CREATE POLICY "clients read via onboarding"
  ON public.clients FOR SELECT
  TO authenticated
  USING (public.can_view_client_via_onboarding(business_id));

-- Extend can_access_client so location reads follow the same rule
CREATE OR REPLACE FUNCTION public.can_access_client(_business_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.business_id = _business_id
      AND (public.is_privileged(auth.uid()) OR c.sales_person_id = auth.uid())
  )
  OR public.can_view_client_via_onboarding(_business_id)
$$;
