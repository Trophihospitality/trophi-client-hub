
-- Step definitions reference table
CREATE TABLE IF NOT EXISTS public.onboarding_step_definitions (
  step_number int PRIMARY KEY,
  name text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('account_owner','system','client','specialist','account_manager')),
  client_visible boolean NOT NULL DEFAULT false,
  description text
);
GRANT SELECT ON public.onboarding_step_definitions TO authenticated;
GRANT ALL ON public.onboarding_step_definitions TO service_role;
ALTER TABLE public.onboarding_step_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Step defs readable by authenticated"
  ON public.onboarding_step_definitions FOR SELECT
  TO authenticated USING (true);

INSERT INTO public.onboarding_step_definitions (step_number, name, actor, client_visible) VALUES
  (1,  'Generate Contract',                  'account_owner',   false),
  (2,  'Generate Payment Authorization',     'account_owner',   false),
  (3,  'Client Portal Access',               'system',          true),
  (4,  'Sign Contract & Authorization',      'client',          true),
  (5,  'Payment Authorization',              'client',          true),
  (6,  'Assign Onboarding Specialist',       'account_owner',   true),
  (7,  'Intake Form',                        'client',          true),
  (8,  'Schedule Kickoff',                   'client',          true),
  (9,  'Upload Assets',                      'client',          true),
  (10, 'Platform IDs',                       'specialist',      false),
  (11, 'Menu Review',                        'specialist',      true),
  (12, 'Package Features',                   'specialist',      false),
  (13, 'Assign Account Manager',             'account_owner',   true),
  (14, 'Account Transition Call',            'account_manager', true),
  (15, 'Recurring Client Tasks',             'account_manager', false),
  (16, 'Go Live',                            'account_manager', false)
ON CONFLICT (step_number) DO UPDATE
  SET name = EXCLUDED.name, actor = EXCLUDED.actor, client_visible = EXCLUDED.client_visible;

-- Onboarding records (one per client)
CREATE TABLE IF NOT EXISTS public.onboarding_records (
  business_id text PRIMARY KEY REFERENCES public.clients(business_id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  current_step int NOT NULL DEFAULT 1 REFERENCES public.onboarding_step_definitions(step_number),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','live')),
  specialist_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  account_manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  went_live_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.onboarding_records TO authenticated;
GRANT ALL ON public.onboarding_records TO service_role;
ALTER TABLE public.onboarding_records ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER onboarding_records_touch
  BEFORE UPDATE ON public.onboarding_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Step progress
CREATE TABLE IF NOT EXISTS public.onboarding_step_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL REFERENCES public.onboarding_records(business_id) ON DELETE CASCADE,
  step_number int NOT NULL REFERENCES public.onboarding_step_definitions(step_number),
  status text NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','in_progress','complete')),
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, step_number)
);
GRANT SELECT ON public.onboarding_step_progress TO authenticated;
GRANT ALL ON public.onboarding_step_progress TO service_role;
ALTER TABLE public.onboarding_step_progress ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER onboarding_step_progress_touch
  BEFORE UPDATE ON public.onboarding_step_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Access helper (enum values are now committed)
CREATE OR REPLACE FUNCTION public.can_view_onboarding(_business_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.onboarding_records o
    JOIN public.clients c ON c.business_id = o.business_id
    WHERE o.business_id = _business_id
      AND (
        public.is_privileged(auth.uid())
        OR c.sales_person_id = auth.uid()
        OR o.specialist_id = auth.uid()
        OR o.account_manager_id = auth.uid()
        OR (
          public.has_role(auth.uid(), 'onboarding_specialist'::public.app_role)
          AND o.current_step BETWEEN 1 AND 5
        )
      )
  )
$$;

CREATE POLICY "View onboarding records"
  ON public.onboarding_records FOR SELECT TO authenticated
  USING (public.can_view_onboarding(business_id));

CREATE POLICY "View onboarding progress"
  ON public.onboarding_step_progress FOR SELECT TO authenticated
  USING (public.can_view_onboarding(business_id));

-- Auto-create onboarding when a client is flagged for onboarding
CREATE OR REPLACE FUNCTION public.ensure_onboarding_for_client(_business_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.onboarding_records (business_id, current_step, status)
  VALUES (_business_id, 1, 'active')
  ON CONFLICT (business_id) DO NOTHING;

  INSERT INTO public.onboarding_step_progress (business_id, step_number, status, started_at)
  SELECT _business_id, d.step_number,
         CASE WHEN d.step_number = 1 THEN 'in_progress' ELSE 'locked' END,
         CASE WHEN d.step_number = 1 THEN now() ELSE NULL END
  FROM public.onboarding_step_definitions d
  ON CONFLICT (business_id, step_number) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_client_sent_to_onboarding()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.sent_to_onboarding = true
     AND (TG_OP = 'INSERT' OR OLD.sent_to_onboarding IS DISTINCT FROM true) THEN
    PERFORM public.ensure_onboarding_for_client(NEW.business_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_create_onboarding ON public.clients;
CREATE TRIGGER clients_create_onboarding
  AFTER INSERT OR UPDATE OF sent_to_onboarding ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.on_client_sent_to_onboarding();

-- Backfill
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT business_id FROM public.clients WHERE sent_to_onboarding = true LOOP
    PERFORM public.ensure_onboarding_for_client(r.business_id);
  END LOOP;
END $$;

-- Business-hours elapsed helper (skips weekends)
CREATE OR REPLACE FUNCTION public.business_hours_since(_ts timestamptz)
RETURNS int
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH RECURSIVE days AS (
    SELECT date_trunc('day', _ts) AS d
    UNION ALL SELECT d + interval '1 day' FROM days WHERE d + interval '1 day' <= date_trunc('day', now())
  )
  SELECT COALESCE(SUM(
    CASE
      WHEN extract(isodow FROM d) IN (6,7) THEN 0
      WHEN d = date_trunc('day', _ts) AND d = date_trunc('day', now())
        THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - _ts))/3600)::int
      WHEN d = date_trunc('day', _ts)
        THEN GREATEST(0, 24 - EXTRACT(HOUR FROM _ts))::int
      WHEN d = date_trunc('day', now())
        THEN EXTRACT(HOUR FROM now())::int
      ELSE 24
    END
  )::int, 0)
  FROM days;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_onboarding_for_client(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_onboarding(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_hours_since(timestamptz) TO authenticated;
