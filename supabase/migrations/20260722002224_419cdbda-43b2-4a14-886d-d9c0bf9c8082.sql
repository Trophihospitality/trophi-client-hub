
-- 1) Team field on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS team text;

-- 2) client_status_history table
CREATE TABLE IF NOT EXISTS public.client_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name text,
  source text NOT NULL DEFAULT 'live' -- 'live' | 'backfill'
);

GRANT SELECT, INSERT ON public.client_status_history TO authenticated;
GRANT ALL ON public.client_status_history TO service_role;

ALTER TABLE public.client_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "status history readable via client access"
  ON public.client_status_history FOR SELECT TO authenticated
  USING (public.can_access_client(business_id));

CREATE POLICY "status history insert via client access"
  ON public.client_status_history FOR INSERT TO authenticated
  WITH CHECK (public.can_access_client(business_id));

CREATE INDEX IF NOT EXISTS client_status_history_business_id_idx
  ON public.client_status_history(business_id);
CREATE INDEX IF NOT EXISTS client_status_history_changed_at_idx
  ON public.client_status_history(changed_at);

-- 3) Trigger to auto-write history on journey_status changes going forward
CREATE OR REPLACE FUNCTION public.log_client_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT name INTO actor_name FROM public.profiles WHERE user_id = actor;
    INSERT INTO public.client_status_history
      (business_id, from_status, to_status, changed_at, changed_by, changed_by_name, source)
    VALUES (NEW.business_id, NULL, NEW.journey_status, COALESCE(NEW.created_at, now()), actor, actor_name, 'live');
    RETURN NEW;
  END IF;

  IF NEW.journey_status IS DISTINCT FROM OLD.journey_status THEN
    SELECT name INTO actor_name FROM public.profiles WHERE user_id = actor;
    INSERT INTO public.client_status_history
      (business_id, from_status, to_status, changed_at, changed_by, changed_by_name, source)
    VALUES (NEW.business_id, OLD.journey_status, NEW.journey_status, now(), actor, actor_name, 'live');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_log_status_change ON public.clients;
CREATE TRIGGER clients_log_status_change
AFTER INSERT OR UPDATE OF journey_status ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.log_client_status_change();

-- 4) Backfill from client_activity status_change entries + client creation
DO $$
DECLARE
  c RECORD;
  a RECORD;
  m text[];
  from_s text;
  to_s text;
  initial_status text;
BEGIN
  -- Wipe any existing backfill rows so this migration is idempotent.
  DELETE FROM public.client_status_history WHERE source = 'backfill';

  FOR c IN SELECT business_id, journey_status, created_at FROM public.clients LOOP
    -- Determine initial status: earliest activity's from_status if parseable, else current journey_status.
    initial_status := c.journey_status;
    SELECT (regexp_matches(description, 'Status changed:\s*(.+?)\s*→'))[1]
      INTO initial_status
      FROM public.client_activity
     WHERE business_id = c.business_id AND type = 'status_change'
     ORDER BY timestamp ASC LIMIT 1;

    IF initial_status IS NULL THEN initial_status := c.journey_status; END IF;

    INSERT INTO public.client_status_history
      (business_id, from_status, to_status, changed_at, changed_by, changed_by_name, source)
    VALUES (c.business_id, NULL, initial_status, c.created_at, NULL, 'System (backfill)', 'backfill');

    FOR a IN
      SELECT description, actor, actor_id, timestamp
        FROM public.client_activity
       WHERE business_id = c.business_id AND type = 'status_change'
       ORDER BY timestamp ASC
    LOOP
      m := regexp_matches(a.description, 'Status changed:\s*(.+?)\s*→\s*([^·]+?)(?:\s*·.*)?$');
      IF m IS NOT NULL THEN
        from_s := trim(m[1]);
        to_s := trim(m[2]);
        INSERT INTO public.client_status_history
          (business_id, from_status, to_status, changed_at, changed_by, changed_by_name, source)
        VALUES (c.business_id, from_s, to_s, a.timestamp, a.actor_id, a.actor, 'backfill');
      END IF;
    END LOOP;
  END LOOP;
END $$;
