
-- ============================================================
-- TROPHI PORTAL — schema, roles, RLS, storage, triggers
-- ============================================================

-- ROLES
CREATE TYPE public.app_role AS ENUM ('manager', 'sales_rep');

-- PROFILES
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- USER_ROLES
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role helper
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- Profile policies
CREATE POLICY "profiles readable by authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- user_roles policies
CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'));

-- New user handler → profile + default sales_rep role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'sales_rep')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Generic updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- CLIENTS
CREATE TABLE public.clients (
  business_id text PRIMARY KEY,
  company text NOT NULL,
  brands text[] NOT NULL DEFAULT '{}',
  client_type text NOT NULL,
  journey_status text NOT NULL DEFAULT 'Cold Lead',
  last_contact_date date,
  last_contact_method text NOT NULL DEFAULT 'None',
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  is_decision_maker boolean NOT NULL DEFAULT false,
  package_type text NOT NULL DEFAULT 'TBD',
  budget numeric,
  sales_person_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  lead_source text,
  next_follow_up_date date,
  sent_to_onboarding boolean NOT NULL DEFAULT false,
  onboarding_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- business_id generator: TRP-XXXXXX (safe alphabet)
CREATE OR REPLACE FUNCTION public.gen_business_id()
RETURNS text LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
BEGIN
  LOOP
    candidate := 'TRP-';
    FOR i IN 1..6 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.clients WHERE business_id = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_business_id_before_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.business_id IS NULL OR NEW.business_id = '' THEN
    NEW.business_id := public.gen_business_id();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clients_business_id
  BEFORE INSERT ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_business_id_before_insert();
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Approved → onboarding side-effects
CREATE OR REPLACE FUNCTION public.handle_approved_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.journey_status = 'Approved'
     AND (TG_OP = 'INSERT' OR OLD.journey_status IS DISTINCT FROM 'Approved')
     AND NEW.sent_to_onboarding = false THEN
    NEW.sent_to_onboarding := true;
    NEW.onboarding_sent_at := now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_clients_approved_ins
  BEFORE INSERT ON public.clients FOR EACH ROW EXECUTE FUNCTION public.handle_approved_transition();
CREATE TRIGGER trg_clients_approved_upd
  BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.handle_approved_transition();

-- LOCATIONS
CREATE TABLE public.locations (
  location_id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_location_id_before_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  IF NEW.location_id IS NULL OR NEW.location_id = '' THEN
    SELECT COALESCE(MAX(
      CAST(NULLIF(regexp_replace(location_id, '.*-L', ''), '') AS int)
    ), 0) + 1 INTO n
    FROM public.locations WHERE business_id = NEW.business_id;
    NEW.location_id := NEW.business_id || '-L' || lpad(n::text, 2, '0');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_locations_location_id
  BEFORE INSERT ON public.locations FOR EACH ROW EXECUTE FUNCTION public.set_location_id_before_insert();

-- NOTES
CREATE TABLE public.client_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_notes TO authenticated;
GRANT ALL ON public.client_notes TO service_role;
ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;

-- ACTIVITY
CREATE TABLE public.client_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  type text NOT NULL,
  description text NOT NULL,
  actor text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.client_activity TO authenticated;
GRANT ALL ON public.client_activity TO service_role;
ALTER TABLE public.client_activity ENABLE ROW LEVEL SECURITY;

-- ATTACHMENTS (Storage-backed)
CREATE TABLE public.client_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_name text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.client_attachments TO authenticated;
GRANT ALL ON public.client_attachments TO service_role;
ALTER TABLE public.client_attachments ENABLE ROW LEVEL SECURITY;

-- Helper: can current user access a given client
CREATE OR REPLACE FUNCTION public.can_access_client(_business_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.business_id = _business_id
      AND (public.has_role(auth.uid(), 'manager') OR c.sales_person_id = auth.uid())
  )
$$;

-- CLIENTS policies
CREATE POLICY "clients read owner or manager" ON public.clients
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager') OR sales_person_id = auth.uid());
CREATE POLICY "clients insert owner or manager" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'manager') OR sales_person_id = auth.uid());
CREATE POLICY "clients update owner or manager" ON public.clients
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager') OR sales_person_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'manager') OR sales_person_id = auth.uid());
CREATE POLICY "clients delete manager" ON public.clients
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- LOCATIONS policies
CREATE POLICY "locations read via client" ON public.locations
  FOR SELECT TO authenticated USING (public.can_access_client(business_id));
CREATE POLICY "locations write via client" ON public.locations
  FOR INSERT TO authenticated WITH CHECK (public.can_access_client(business_id));
CREATE POLICY "locations update via client" ON public.locations
  FOR UPDATE TO authenticated USING (public.can_access_client(business_id));
CREATE POLICY "locations delete via client" ON public.locations
  FOR DELETE TO authenticated USING (public.can_access_client(business_id));

-- NOTES policies
CREATE POLICY "notes read via client" ON public.client_notes
  FOR SELECT TO authenticated USING (public.can_access_client(business_id));
CREATE POLICY "notes insert via client" ON public.client_notes
  FOR INSERT TO authenticated WITH CHECK (public.can_access_client(business_id) AND author_id = auth.uid());

-- ACTIVITY policies
CREATE POLICY "activity read via client" ON public.client_activity
  FOR SELECT TO authenticated USING (public.can_access_client(business_id));
CREATE POLICY "activity insert via client" ON public.client_activity
  FOR INSERT TO authenticated WITH CHECK (public.can_access_client(business_id));

-- ATTACHMENTS policies
CREATE POLICY "attachments read via client" ON public.client_attachments
  FOR SELECT TO authenticated USING (public.can_access_client(business_id));
CREATE POLICY "attachments insert via client" ON public.client_attachments
  FOR INSERT TO authenticated WITH CHECK (public.can_access_client(business_id) AND uploaded_by = auth.uid());
CREATE POLICY "attachments delete via client" ON public.client_attachments
  FOR DELETE TO authenticated USING (public.can_access_client(business_id));
