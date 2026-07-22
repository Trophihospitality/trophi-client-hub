
-- Make the two invoker trigger functions run as owner so their internal helper
-- calls succeed even when EXECUTE on those helpers is revoked from clients.

CREATE OR REPLACE FUNCTION public.set_business_id_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.business_id IS NULL OR NEW.business_id = '' THEN
    NEW.business_id := public.gen_business_id();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.follow_ups_sync_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_client_next_follow_up(OLD.business_id);
    RETURN OLD;
  ELSE
    PERFORM public.sync_client_next_follow_up(NEW.business_id);
    RETURN NEW;
  END IF;
END;
$function$;

-- Now that the trigger path is privileged, re-revoke the helpers from the API roles.
REVOKE EXECUTE ON FUNCTION public.gen_business_id()             FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_client_next_follow_up(text) FROM anon, authenticated, PUBLIC;
