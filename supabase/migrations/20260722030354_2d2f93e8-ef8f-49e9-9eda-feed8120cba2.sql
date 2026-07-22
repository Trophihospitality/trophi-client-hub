
-- 1) Add invite failure surfacing columns
ALTER TABLE public.client_users
  ADD COLUMN IF NOT EXISTS invite_last_error text,
  ADD COLUMN IF NOT EXISTS invite_last_attempt_at timestamptz;

-- 2) Fix profiles email-uniqueness trigger to allow the self-match case:
--    a matching client_users row is allowed IFF it is unlinked (user_id IS NULL,
--    about to be linked as this same person accepts) OR already linked to NEW.user_id.
CREATE OR REPLACE FUNCTION public.enforce_email_uniqueness_profiles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  conflict_user uuid;
  conflict_exists boolean;
BEGIN
  SELECT user_id, TRUE
    INTO conflict_user, conflict_exists
  FROM public.client_users
  WHERE lower(email) = lower(NEW.email)
  LIMIT 1;

  IF conflict_exists THEN
    -- Allow when the client_users row is either unlinked (awaiting this same
    -- acceptance) or already linked to this exact auth user.
    IF conflict_user IS NULL OR conflict_user = NEW.user_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'This email is already in use';
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Fix client_users email-uniqueness trigger with symmetric self-match:
--    a matching profile row is allowed IFF it belongs to NEW.user_id.
CREATE OR REPLACE FUNCTION public.enforce_email_uniqueness_client_users()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  conflict_user uuid;
  conflict_exists boolean;
BEGIN
  SELECT user_id, TRUE
    INTO conflict_user, conflict_exists
  FROM public.profiles
  WHERE lower(email) = lower(NEW.email)
  LIMIT 1;

  IF conflict_exists THEN
    IF NEW.user_id IS NOT NULL AND conflict_user = NEW.user_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'This email is already in use';
  END IF;

  RETURN NEW;
END;
$$;

-- 4) Auto-link client_users -> auth.users when the invited person's profile is created.
CREATE OR REPLACE FUNCTION public.link_client_user_on_profile_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.client_users
     SET user_id = NEW.user_id,
         status = 'active',
         activated_at = COALESCE(activated_at, now()),
         invite_last_error = NULL
   WHERE lower(email) = lower(NEW.email)
     AND user_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_link_client_user ON public.profiles;
CREATE TRIGGER trg_profiles_link_client_user
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.link_client_user_on_profile_insert();
