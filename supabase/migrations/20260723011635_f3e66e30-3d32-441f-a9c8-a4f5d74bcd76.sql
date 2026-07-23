
CREATE OR REPLACE FUNCTION public.can_view_onboarding(_business_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.onboarding_records o
    JOIN public.clients c ON c.business_id = o.business_id
    WHERE o.business_id = _business_id
      AND (
        public.is_privileged(auth.uid())
        OR c.sales_person_id = auth.uid()
        OR o.specialist_id = auth.uid()
        OR o.account_manager_id = auth.uid()
        OR (
          public.has_role(auth.uid(), 'onboarding_specialist'::public.app_role)
          AND o.current_step BETWEEN 1 AND 6
        )
      )
  )
$$;
