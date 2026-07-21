
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

-- Backfill approved_at from onboarding hand-off timestamp when available.
UPDATE public.clients
   SET approved_at = COALESCE(approved_at, onboarding_sent_at, updated_at)
 WHERE journey_status IN ('Approved','Signed')
   AND approved_at IS NULL;

-- Extend the existing transition trigger to stamp approved_at / signed_at.
CREATE OR REPLACE FUNCTION public.handle_approved_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.journey_status = 'Approved'
     AND (TG_OP = 'INSERT' OR OLD.journey_status IS DISTINCT FROM 'Approved')
     AND NEW.sent_to_onboarding = false THEN
    NEW.sent_to_onboarding := true;
    NEW.onboarding_sent_at := now();
  END IF;

  IF NEW.journey_status = 'Approved'
     AND (TG_OP = 'INSERT' OR OLD.journey_status IS DISTINCT FROM 'Approved')
     AND NEW.approved_at IS NULL THEN
    NEW.approved_at := now();
  END IF;

  IF NEW.journey_status = 'Signed'
     AND (TG_OP = 'INSERT' OR OLD.journey_status IS DISTINCT FROM 'Signed') THEN
    IF NEW.signed_at IS NULL THEN NEW.signed_at := now(); END IF;
    IF NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
  END IF;

  RETURN NEW;
END;
$function$;
