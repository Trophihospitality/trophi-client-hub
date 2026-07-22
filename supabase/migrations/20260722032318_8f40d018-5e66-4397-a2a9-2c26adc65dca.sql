
-- Helper: is the user a Trophi employee (any non-client role)?
CREATE OR REPLACE FUNCTION public.is_trophi_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin','manager','sales_rep','onboarding_specialist','account_manager')
  )
$$;
REVOKE ALL ON FUNCTION public.is_trophi_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trophi_user(uuid) TO authenticated, service_role;

-- profiles: restrict SELECT
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
CREATE POLICY "profiles readable by trophi or self"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.is_trophi_user(auth.uid()) OR user_id = auth.uid());

-- awards: restrict SELECT to Trophi roles
DROP POLICY IF EXISTS "Authenticated can view awards" ON public.awards;
CREATE POLICY "Trophi staff view awards"
  ON public.awards FOR SELECT
  TO authenticated
  USING (public.is_trophi_user(auth.uid()));

-- onboarding_step_definitions: Trophi sees all; client_admin sees client_visible only
DROP POLICY IF EXISTS "Step defs readable by authenticated" ON public.onboarding_step_definitions;
CREATE POLICY "Step defs readable by trophi"
  ON public.onboarding_step_definitions FOR SELECT
  TO authenticated
  USING (public.is_trophi_user(auth.uid()));
CREATE POLICY "Client-visible step defs readable by client users"
  ON public.onboarding_step_definitions FOR SELECT
  TO authenticated
  USING (client_visible = true);

-- Lock down SECURITY DEFINER functions not meant to be user-callable.
-- Trigger functions: revoke from PUBLIC + roles.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_role_on_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_client_user_on_email_confirm() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_client_user_on_profile_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_client_status_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.on_client_sent_to_onboarding() FROM PUBLIC, anon, authenticated;

-- Internal helpers not meant to be called directly by clients.
REVOKE ALL ON FUNCTION public.ensure_onboarding_for_client(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gen_business_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_client_next_follow_up(text) FROM PUBLIC, anon, authenticated;

-- Ensure RLS helpers used inside policies remain callable by authenticated (needed at policy eval time).
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_privileged(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_trophi_staff_for(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_client_admin_for(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_client(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_onboarding(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_spiro(uuid) TO authenticated;
