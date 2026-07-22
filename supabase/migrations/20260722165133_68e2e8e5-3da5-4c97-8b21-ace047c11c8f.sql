
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS signed_active_locations INTEGER;

CREATE OR REPLACE FUNCTION public.handle_approved_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  loc_count INT;
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
    IF NEW.signed_active_locations IS NULL THEN
      SELECT COUNT(*) INTO loc_count
        FROM public.locations
        WHERE business_id = NEW.business_id AND status = 'active';
      NEW.signed_active_locations := COALESCE(loc_count, 0);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill snapshot for existing signed clients
UPDATE public.clients c
   SET signed_active_locations = sub.n
  FROM (
    SELECT business_id, COUNT(*) AS n
      FROM public.locations
      WHERE status = 'active'
      GROUP BY business_id
  ) sub
 WHERE c.business_id = sub.business_id
   AND c.journey_status = 'Signed'
   AND c.signed_active_locations IS NULL;

UPDATE public.clients
   SET signed_active_locations = 0
 WHERE journey_status = 'Signed'
   AND signed_active_locations IS NULL;
