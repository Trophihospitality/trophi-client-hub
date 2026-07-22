
-- Drop the too-early trigger on profiles insert
DROP TRIGGER IF EXISTS trg_profiles_link_client_user ON public.profiles;

-- Replace with an auth.users trigger that fires when email_confirmed_at
-- transitions from NULL -> not NULL (true acceptance moment).
CREATE OR REPLACE FUNCTION public.link_client_user_on_email_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND (OLD.email_confirmed_at IS NULL OR OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
  THEN
    UPDATE public.client_users
       SET user_id = NEW.id,
           status = 'active',
           activated_at = COALESCE(activated_at, now()),
           invite_last_error = NULL
     WHERE lower(email) = lower(NEW.email)
       AND user_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_users_link_client_user ON auth.users;
CREATE TRIGGER trg_auth_users_link_client_user
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.link_client_user_on_email_confirm();

-- Undo the premature link on Zippy's row (the invited auth user hasn't accepted yet)
UPDATE public.client_users
   SET user_id = NULL,
       status = 'invited',
       activated_at = NULL
 WHERE business_id = 'TRP-U8RZKR'
   AND lower(email) = 'billing@trophihospitality.com'
   AND NOT EXISTS (
     SELECT 1 FROM auth.users u
      WHERE u.id = client_users.user_id
        AND u.email_confirmed_at IS NOT NULL
   );
