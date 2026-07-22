
-- 1) Privilege escalation guard on profiles
CREATE OR REPLACE FUNCTION public.guard_profile_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_priv boolean;
BEGIN
  -- Service role / no auth context (triggers, admin client) always allowed
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Spiro can change anything
  SELECT public.is_spiro(auth.uid()) INTO is_priv;
  IF is_priv THEN
    RETURN NEW;
  END IF;

  -- For self-updates, block changes to privileged columns
  IF auth.uid() = NEW.user_id THEN
    IF NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.hire_role IS DISTINCT FROM OLD.hire_role
       OR NEW.hire_date IS DISTINCT FROM OLD.hire_date
       OR NEW.mentor_id IS DISTINCT FROM OLD.mentor_id
       OR NEW.mentor_status IS DISTINCT FROM OLD.mentor_status
       OR NEW.mentor_assigned_at IS DISTINCT FROM OLD.mentor_assigned_at
       OR NEW.team IS DISTINCT FROM OLD.team
       OR NEW.current_role_started_at IS DISTINCT FROM OLD.current_role_started_at
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION 'You may only update your name, phone, and photo'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- Non-self, non-Spiro updates are blocked (RLS should already prevent this)
  RAISE EXCEPTION 'Not permitted to update this profile'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_self_update_trg ON public.profiles;
CREATE TRIGGER guard_profile_self_update_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_self_update();

-- Also lock INSERT: a user inserting their own profile cannot claim privileged fields
CREATE OR REPLACE FUNCTION public.guard_profile_self_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.is_spiro(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF auth.uid() = NEW.user_id THEN
    -- Force privileged fields to safe defaults on self-insert
    NEW.employee_id := NULL;         -- assign_employee_id trigger will set
    NEW.hire_role := NULL;
    NEW.hire_date := NULL;
    NEW.mentor_id := NULL;
    NEW.mentor_status := NULL;
    NEW.mentor_assigned_at := NULL;
    NEW.team := NULL;
    NEW.current_role_started_at := NULL;
    NEW.is_active := TRUE;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Not permitted to insert this profile'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_self_insert_trg ON public.profiles;
CREATE TRIGGER guard_profile_self_insert_trg
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_self_insert();

-- 2) Restrict client_contracts policies to authenticated only
DROP POLICY IF EXISTS "Trophi + client_admin read contracts" ON public.client_contracts;
CREATE POLICY "Trophi + client_admin read contracts"
  ON public.client_contracts FOR SELECT
  TO authenticated
  USING (
    is_trophi_staff_for(business_id)
    OR (kind = ANY (ARRAY['bundle','msa','order_form','client_authorization','payment_authorization'])
        AND is_client_admin_for(business_id))
  );

DROP POLICY IF EXISTS "Trophi deletes contracts" ON public.client_contracts;
CREATE POLICY "Trophi deletes contracts"
  ON public.client_contracts FOR DELETE
  TO authenticated
  USING (is_trophi_staff_for(business_id));

-- 3) Revoke EXECUTE from anon/authenticated on internal trigger + helper functions
--    that should never be callable from the API. Keep RLS helper functions
--    (has_role, is_privileged, is_spiro, is_trophi_user, is_trophi_staff_for,
--    is_client_admin_for, can_access_client, can_view_onboarding, business_hours_since)
--    callable so RLS policies and app code continue to work.
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'set_business_id_before_insert()',
    'gen_business_id()',
    'set_updated_at()',
    'sync_client_next_follow_up(text)',
    'follow_ups_sync_client()',
    'guard_location_update()',
    'set_location_needs_onboarding()',
    'on_client_sent_to_onboarding()',
    'ensure_onboarding_for_client(text)',
    'enforce_email_uniqueness_profiles()',
    'enforce_email_uniqueness_client_users()',
    'enforce_client_admin_cap()',
    'guard_employee_id_immutable()',
    'assign_employee_id()',
    'log_client_status_change()',
    'link_client_user_on_email_confirm()',
    'link_client_user_on_profile_insert()',
    'archive_role_on_change()',
    'prevent_last_admin_removal()',
    'prevent_profile_for_client_user()',
    'advance_after_portal_access(text)',
    'prevent_trophi_role_on_client_user()',
    'set_location_id_before_insert()',
    'handle_new_user()',
    'handle_approved_transition()',
    'enforce_trophi_avatar_limits()',
    'guard_profile_self_update()',
    'guard_profile_self_insert()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;
