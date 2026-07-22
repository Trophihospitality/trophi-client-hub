
-- Fix client portal helper to check client_users (real linkage), not legacy client_portal_users.
CREATE OR REPLACE FUNCTION public.is_client_admin_for(_business_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_users
    WHERE user_id = auth.uid()
      AND business_id = _business_id
      AND status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.client_portal_users
    WHERE user_id = auth.uid() AND business_id = _business_id
  )
$$;

-- Auto-complete Step 3 (Client Portal Access) and open Step 4 when a client
-- user is linked to an auth account. Called from both link triggers.
CREATE OR REPLACE FUNCTION public.advance_after_portal_access(_business_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.onboarding_step_progress
     SET status = 'complete', completed_at = COALESCE(completed_at, now())
   WHERE business_id = _business_id AND step_number = 3 AND status <> 'complete';

  UPDATE public.onboarding_step_progress
     SET status = 'in_progress', started_at = COALESCE(started_at, now())
   WHERE business_id = _business_id AND step_number = 4 AND status = 'locked';

  UPDATE public.onboarding_records
     SET current_step = 4
   WHERE business_id = _business_id AND current_step < 4;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_client_user_on_profile_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid text;
BEGIN
  UPDATE public.client_users
     SET user_id = NEW.user_id,
         status = 'active',
         activated_at = COALESCE(activated_at, now()),
         invite_last_error = NULL
   WHERE lower(email) = lower(NEW.email) AND user_id IS NULL
   RETURNING business_id INTO _bid;
  IF _bid IS NOT NULL THEN
    PERFORM public.advance_after_portal_access(_bid);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_client_user_on_email_confirm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid text;
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND (OLD.email_confirmed_at IS NULL OR OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
  THEN
    UPDATE public.client_users
       SET user_id = NEW.id,
           status = 'active',
           activated_at = COALESCE(activated_at, now()),
           invite_last_error = NULL
     WHERE lower(email) = lower(NEW.email) AND user_id IS NULL
     RETURNING business_id INTO _bid;
    IF _bid IS NOT NULL THEN
      PERFORM public.advance_after_portal_access(_bid);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill Zippy's since Basile already accepted before this fix.
SELECT public.advance_after_portal_access('TRP-U8RZKR');
