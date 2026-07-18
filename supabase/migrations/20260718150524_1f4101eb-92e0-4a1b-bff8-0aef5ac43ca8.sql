
-- Helper: privileged = manager or admin
CREATE OR REPLACE FUNCTION public.is_privileged(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('manager','admin')
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_privileged(uuid) TO authenticated;

-- Update can_access_client to include admin (via is_privileged)
CREATE OR REPLACE FUNCTION public.can_access_client(_business_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.business_id = _business_id
      AND (public.is_privileged(auth.uid()) OR c.sales_person_id = auth.uid())
  )
$$;

-- Update clients policies
DROP POLICY IF EXISTS "clients read owner or manager" ON public.clients;
DROP POLICY IF EXISTS "clients insert owner or manager" ON public.clients;
DROP POLICY IF EXISTS "clients update owner or manager" ON public.clients;
DROP POLICY IF EXISTS "clients delete manager" ON public.clients;

CREATE POLICY "clients read owner or privileged" ON public.clients
FOR SELECT TO authenticated
USING (public.is_privileged(auth.uid()) OR sales_person_id = auth.uid());

CREATE POLICY "clients insert owner or privileged" ON public.clients
FOR INSERT TO authenticated
WITH CHECK (public.is_privileged(auth.uid()) OR sales_person_id = auth.uid());

CREATE POLICY "clients update owner or privileged" ON public.clients
FOR UPDATE TO authenticated
USING (public.is_privileged(auth.uid()) OR sales_person_id = auth.uid())
WITH CHECK (public.is_privileged(auth.uid()) OR sales_person_id = auth.uid());

CREATE POLICY "clients delete privileged" ON public.clients
FOR DELETE TO authenticated
USING (public.is_privileged(auth.uid()));

-- user_roles: expand read + admin write policies
DROP POLICY IF EXISTS "users read own roles" ON public.user_roles;

CREATE POLICY "roles read own or admin" ON public.user_roles
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "roles insert admin" ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "roles update admin" ON public.user_roles
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "roles delete admin" ON public.user_roles
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Lockout protection: cannot remove or demote the last admin
CREATE OR REPLACE FUNCTION public.prevent_last_admin_removal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  admin_count int;
  was_admin boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    was_admin := OLD.role = 'admin';
  ELSIF TG_OP = 'UPDATE' THEN
    was_admin := OLD.role = 'admin' AND NEW.role IS DISTINCT FROM 'admin';
  ELSE
    RETURN NEW;
  END IF;

  IF was_admin THEN
    SELECT COUNT(*) INTO admin_count FROM public.user_roles WHERE role = 'admin';
    IF admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last remaining admin';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_admin_update ON public.user_roles;
DROP TRIGGER IF EXISTS trg_prevent_last_admin_delete ON public.user_roles;

CREATE TRIGGER trg_prevent_last_admin_update
BEFORE UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.prevent_last_admin_removal();

CREATE TRIGGER trg_prevent_last_admin_delete
BEFORE DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.prevent_last_admin_removal();

-- Grant admin to Spiro@TrophiHospitality.com (case-insensitive)
INSERT INTO public.user_roles (user_id, role)
SELECT p.user_id, 'admin'::app_role
FROM public.profiles p
WHERE lower(p.email) = lower('Spiro@TrophiHospitality.com')
ON CONFLICT (user_id, role) DO NOTHING;
