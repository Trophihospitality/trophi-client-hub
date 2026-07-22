
-- ============================================================
-- PROFILES: employee_id + HR fields + active flag
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS employee_id INTEGER UNIQUE,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS hire_date DATE,
  ADD COLUMN IF NOT EXISTS hire_role public.app_role,
  ADD COLUMN IF NOT EXISTS mentor_id UUID REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_role_started_at DATE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_idx ON public.profiles(lower(email));

-- Sequence starting at 1 (Spiro will be 01, then chronological)
CREATE SEQUENCE IF NOT EXISTS public.employee_id_seq START WITH 1 INCREMENT BY 1;

-- Backfill: Spiro first, then by created_at
DO $$
DECLARE
  r RECORD;
  spiro_uid UUID;
BEGIN
  SELECT user_id INTO spiro_uid FROM public.profiles
   WHERE lower(email) = 'spiro@trophihospitality.com' LIMIT 1;

  IF spiro_uid IS NOT NULL THEN
    UPDATE public.profiles SET employee_id = 1 WHERE user_id = spiro_uid AND employee_id IS NULL;
  END IF;

  FOR r IN
    SELECT user_id FROM public.profiles
     WHERE employee_id IS NULL
     ORDER BY created_at ASC, user_id ASC
  LOOP
    UPDATE public.profiles SET employee_id = nextval('public.employee_id_seq') + 1
      WHERE user_id = r.user_id;
    -- Skip 1 (Spiro's slot)
  END LOOP;

  -- Advance sequence past the highest assigned id
  PERFORM setval('public.employee_id_seq', GREATEST((SELECT COALESCE(MAX(employee_id), 1) FROM public.profiles), 1));
END $$;

-- Guard: employee_id is immutable once set
CREATE OR REPLACE FUNCTION public.guard_employee_id_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.employee_id IS NOT NULL AND NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    RAISE EXCEPTION 'employee_id is immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_guard_employee_id ON public.profiles;
CREATE TRIGGER trg_profiles_guard_employee_id
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_id_immutable();

-- Auto-assign employee_id on new profile insert
CREATE OR REPLACE FUNCTION public.assign_employee_id()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.employee_id IS NULL THEN
    NEW.employee_id := nextval('public.employee_id_seq');
    IF NEW.employee_id = 1 THEN
      -- Reserve 1 for Spiro; if he ever exists later he takes it manually
      NEW.employee_id := nextval('public.employee_id_seq');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_assign_employee_id ON public.profiles;
CREATE TRIGGER trg_profiles_assign_employee_id
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.assign_employee_id();

-- ============================================================
-- IS_SPIRO helper (Employee 01 only, enforced by employee_id)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_spiro(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = _user_id AND employee_id = 1)
$$;

-- ============================================================
-- ROLE HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS public.role_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  started_on DATE NOT NULL,
  ended_on DATE,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.role_history TO authenticated;
GRANT ALL ON public.role_history TO service_role;

ALTER TABLE public.role_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own role history" ON public.role_history
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_privileged(auth.uid()));

CREATE POLICY "System inserts role history" ON public.role_history
  FOR INSERT TO authenticated
  WITH CHECK (public.is_privileged(auth.uid()));

-- Trigger: when profiles.current_role_started_at changes or role changes (via user_roles), archive prior
CREATE OR REPLACE FUNCTION public.archive_role_on_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prior_role public.app_role;
  prior_started DATE;
BEGIN
  IF NEW.current_role_started_at IS DISTINCT FROM OLD.current_role_started_at THEN
    -- Find current role from user_roles (highest rank as source of truth is complicated;
    -- take any existing open history row and close it, else use user's max role)
    SELECT role, started_on INTO prior_role, prior_started
      FROM public.role_history
      WHERE user_id = NEW.user_id AND ended_on IS NULL
      ORDER BY started_on DESC LIMIT 1;

    IF prior_role IS NOT NULL THEN
      UPDATE public.role_history SET ended_on = COALESCE(NEW.current_role_started_at, CURRENT_DATE) - 1
        WHERE user_id = NEW.user_id AND ended_on IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_archive_role ON public.profiles;
CREATE TRIGGER trg_profiles_archive_role
  AFTER UPDATE OF current_role_started_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.archive_role_on_change();

-- ============================================================
-- CLIENT USERS (unified with client_portal_users)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.client_permission_level AS ENUM ('admin_full', 'leadership_mid', 'manager_view');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.client_user_status AS ENUM ('invited', 'active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.client_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  business_id TEXT NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  location_ids TEXT[] NOT NULL DEFAULT '{}',
  permission_level public.client_permission_level NOT NULL DEFAULT 'admin_full',
  status public.client_user_status NOT NULL DEFAULT 'invited',
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS client_users_email_unique_idx ON public.client_users(lower(email));

GRANT SELECT, INSERT, UPDATE ON public.client_users TO authenticated;
GRANT ALL ON public.client_users TO service_role;

ALTER TABLE public.client_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trophi staff view client users they can access" ON public.client_users
  FOR SELECT TO authenticated
  USING (public.is_trophi_staff_for(business_id));

CREATE POLICY "Trophi staff insert client users they can access" ON public.client_users
  FOR INSERT TO authenticated
  WITH CHECK (public.is_trophi_staff_for(business_id));

CREATE POLICY "Admins update client users" ON public.client_users
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Enforce max 5 admins per client
CREATE OR REPLACE FUNCTION public.enforce_client_admin_cap()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  admin_count INT;
BEGIN
  IF NEW.permission_level = 'admin_full' AND NEW.status <> 'inactive' THEN
    SELECT COUNT(*) INTO admin_count FROM public.client_users
      WHERE business_id = NEW.business_id
        AND permission_level = 'admin_full'
        AND status <> 'inactive'
        AND id <> COALESCE(NEW.id, gen_random_uuid());
    IF admin_count >= 5 THEN
      RAISE EXCEPTION 'This client already has the maximum of 5 admins';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_client_users_admin_cap ON public.client_users;
CREATE TRIGGER trg_client_users_admin_cap
  BEFORE INSERT OR UPDATE ON public.client_users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_client_admin_cap();

-- Enforce cross-table email uniqueness (profiles + client_users)
CREATE OR REPLACE FUNCTION public.enforce_email_uniqueness_client_users()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = lower(NEW.email)) THEN
    RAISE EXCEPTION 'This email is already in use';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_client_users_email_unique ON public.client_users;
CREATE TRIGGER trg_client_users_email_unique
  BEFORE INSERT OR UPDATE OF email ON public.client_users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_email_uniqueness_client_users();

CREATE OR REPLACE FUNCTION public.enforce_email_uniqueness_profiles()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.client_users WHERE lower(email) = lower(NEW.email)) THEN
    RAISE EXCEPTION 'This email is already in use';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_email_unique ON public.profiles;
CREATE TRIGGER trg_profiles_email_unique
  BEFORE INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_email_uniqueness_profiles();

DROP TRIGGER IF EXISTS trg_client_users_updated_at ON public.client_users;
CREATE TRIGGER trg_client_users_updated_at
  BEFORE UPDATE ON public.client_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- AUDIT LOG
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.audit_actor_type AS ENUM ('trophi', 'client', 'system', 'anonymous');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_email TEXT,
  actor_type public.audit_actor_type NOT NULL DEFAULT 'trophi',
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before JSONB,
  after JSONB,
  metadata JSONB,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_id_idx ON public.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON public.audit_log(action);

GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Admin-only read; no updates or deletes at all
CREATE POLICY "Admins read audit log" ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Any authenticated caller can insert their own audit rows (server fns will use service role)
CREATE POLICY "Authenticated can insert audit rows" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() OR actor_id IS NULL);

-- Explicitly no UPDATE or DELETE policies → immutable to app users.
