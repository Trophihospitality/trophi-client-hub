
-- 1. handle_new_user must NOT grant sales_rep by default anymore
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (user_id) DO NOTHING;
  -- Intentionally do NOT insert a default role. Roles are granted explicitly by admins.
  RETURN NEW;
END;
$function$;

-- 2. Strip any sales_rep role that was auto-granted to the Zippy POC via self-signup
DELETE FROM public.user_roles
WHERE user_id IN (
  SELECT cu.user_id FROM public.client_users cu
  WHERE lower(cu.email) = 'billing@trophihospitality.com' AND cu.user_id IS NOT NULL
);

-- 3. Reset Zippy client_users row so resend re-issues a fresh invite
UPDATE public.client_users
SET user_id = NULL,
    status = 'invited',
    activated_at = NULL,
    invite_last_error = NULL,
    invited_at = NULL,
    invite_sent_to = NULL
WHERE lower(email) = 'billing@trophihospitality.com';
