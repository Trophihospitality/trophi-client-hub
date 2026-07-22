
-- 1) Guard handle_new_user: never create a Trophi profile row for a client-portal invitee.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- If this auth user matches a client_users row by email, they are a CLIENT.
  -- Do NOT create an internal Trophi profile (which would auto-assign an
  -- employee_id and make them look like staff).
  IF EXISTS (
    SELECT 1 FROM public.client_users
    WHERE lower(email) = lower(NEW.email)
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (user_id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 2) Guard user_roles: reject any Trophi role grant to a user who has a client_users row.
CREATE OR REPLACE FUNCTION public.prevent_trophi_role_on_client_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  client_email text;
BEGIN
  SELECT u.email INTO client_email FROM auth.users u WHERE u.id = NEW.user_id;
  IF client_email IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.client_users
    WHERE lower(email) = lower(client_email)
  ) THEN
    RAISE EXCEPTION 'Cannot grant Trophi role % to client portal user (%)', NEW.role, client_email
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_roles_block_client ON public.user_roles;
CREATE TRIGGER trg_user_roles_block_client
BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.prevent_trophi_role_on_client_user();

-- 3) Also guard profiles: reject creation of a Trophi profile for an auth user
-- whose email is a client portal user. Defense in depth for any code path that
-- inserts profiles directly (server functions, backfills, admin scripts).
CREATE OR REPLACE FUNCTION public.prevent_profile_for_client_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.client_users
    WHERE lower(email) = lower(NEW.email)
  ) THEN
    RAISE EXCEPTION 'Cannot create Trophi employee profile for client portal email %', NEW.email
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_block_client ON public.profiles;
CREATE TRIGGER trg_profiles_block_client
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_for_client_user();

-- 4) Clean up contamination: Basile (client user) accidentally received a profile
-- row with employee_id=12. Remove it. Any dependent rows (role_history for this
-- user) are also cleared. His client_users row is preserved.
DELETE FROM public.role_history
 WHERE user_id = '47c67e80-f80c-467f-b680-1906b88c76b5';
DELETE FROM public.user_roles
 WHERE user_id = '47c67e80-f80c-467f-b680-1906b88c76b5';
DELETE FROM public.profiles
 WHERE user_id = '47c67e80-f80c-467f-b680-1906b88c76b5';
