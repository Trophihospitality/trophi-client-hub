
-- 1. New columns
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','closed')),
  ADD COLUMN IF NOT EXISTS needs_onboarding boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid;

-- 2. Auto-flag needs_onboarding on insert when parent client already sent to onboarding
CREATE OR REPLACE FUNCTION public.set_location_needs_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_sent boolean;
BEGIN
  SELECT sent_to_onboarding INTO parent_sent
  FROM public.clients WHERE business_id = NEW.business_id;
  IF parent_sent THEN
    NEW.needs_onboarding := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_location_needs_onboarding ON public.locations;
CREATE TRIGGER trg_location_needs_onboarding
BEFORE INSERT ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.set_location_needs_onboarding();

-- 3. Immutability + status-change authorization guard
CREATE OR REPLACE FUNCTION public.guard_location_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'business_id is immutable';
  END IF;
  IF NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    RAISE EXCEPTION 'location_id is immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.is_privileged(auth.uid()) THEN
      RAISE EXCEPTION 'Only managers or admins can change a location status';
    END IF;
    IF NEW.status NOT IN ('active','closed') THEN
      RAISE EXCEPTION 'Invalid location status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_location_update ON public.locations;
CREATE TRIGGER trg_guard_location_update
BEFORE UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.guard_location_update();

-- 4. Forbid hard deletion — drop DELETE policy so no role can delete via Data API
DROP POLICY IF EXISTS "locations delete via client" ON public.locations;
