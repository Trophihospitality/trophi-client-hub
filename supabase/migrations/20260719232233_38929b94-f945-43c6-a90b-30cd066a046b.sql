-- =========================================================
-- Turn 1: contracts + payments foundation
-- =========================================================

-- ---------- pandadoc_templates (admin config) ----------
CREATE TABLE public.pandadoc_templates (
  key text PRIMARY KEY CHECK (key IN ('msa','order_form','client_authorization','payment_authorization')),
  template_id text,
  label text NOT NULL,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

GRANT SELECT, INSERT, UPDATE ON public.pandadoc_templates TO authenticated;
GRANT ALL ON public.pandadoc_templates TO service_role;

ALTER TABLE public.pandadoc_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read templates config"
  ON public.pandadoc_templates FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins write templates config"
  ON public.pandadoc_templates FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update templates config"
  ON public.pandadoc_templates FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER pandadoc_templates_updated
  BEFORE UPDATE ON public.pandadoc_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.pandadoc_templates (key, label, notes) VALUES
  ('msa', 'Master Services Agreement', 'Trophi ↔ Client MSA; signed by client then Trophi.'),
  ('order_form', 'Order Form', 'Package, monthly budget per location, active locations list.'),
  ('client_authorization', 'Client Authorization', 'Authorizes Trophi to act on client behalf across platforms.'),
  ('payment_authorization', 'Payment Authorization (ACH / Card)', 'Standard ACH/card authorization language. Trophi-only storage.');

-- ---------- client_portal_users (client_admin → business scope) ----------
CREATE TABLE public.client_portal_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id text NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.client_portal_users TO authenticated;
GRANT ALL ON public.client_portal_users TO service_role;

ALTER TABLE public.client_portal_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own portal mapping"
  ON public.client_portal_users FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_privileged(auth.uid()));

-- Helper: is the caller the client_admin for this business?
CREATE OR REPLACE FUNCTION public.is_client_admin_for(_business_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_portal_users
    WHERE user_id = auth.uid() AND business_id = _business_id
  )
$$;

-- Helper: is caller Trophi staff attached to this client (any role in the chain)?
CREATE OR REPLACE FUNCTION public.is_trophi_staff_for(_business_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.is_privileged(auth.uid())
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.business_id = _business_id AND c.sales_person_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.onboarding_records o
               WHERE o.business_id = _business_id
                 AND (o.specialist_id = auth.uid() OR o.account_manager_id = auth.uid()))
$$;

-- ---------- client_contracts ----------
CREATE TABLE public.client_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('bundle','payment_authorization')),
  pandadoc_document_id text UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent_to_client','client_signed','completed','voided')),
  signed_pdf_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX client_contracts_business_idx ON public.client_contracts(business_id);
CREATE INDEX client_contracts_document_idx ON public.client_contracts(pandadoc_document_id);

GRANT SELECT, INSERT, UPDATE ON public.client_contracts TO authenticated;
GRANT ALL ON public.client_contracts TO service_role;

ALTER TABLE public.client_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trophi + client_admin read contracts"
  ON public.client_contracts FOR SELECT TO authenticated
  USING (
    public.is_trophi_staff_for(business_id)
    OR (kind = 'bundle' AND public.is_client_admin_for(business_id))
  );

CREATE POLICY "Trophi writes contracts"
  ON public.client_contracts FOR INSERT TO authenticated
  WITH CHECK (public.is_trophi_staff_for(business_id));

CREATE POLICY "Trophi updates contracts"
  ON public.client_contracts FOR UPDATE TO authenticated
  USING (public.is_trophi_staff_for(business_id))
  WITH CHECK (public.is_trophi_staff_for(business_id));

CREATE TRIGGER client_contracts_updated
  BEFORE UPDATE ON public.client_contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- payment_methods (tokens only, never PAN/ACH numbers) ----------
CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('brand','location')),
  location_id text REFERENCES public.locations(location_id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_payment_method_id text NOT NULL,
  method_type text NOT NULL CHECK (method_type IN ('card','us_bank_account')),
  brand text,          -- 'visa','mastercard','ach', etc.
  last4 text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'brand' AND location_id IS NULL)
    OR (scope = 'location' AND location_id IS NOT NULL)
  ),
  UNIQUE (stripe_payment_method_id)
);

CREATE INDEX payment_methods_business_idx ON public.payment_methods(business_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

-- Trophi-only. Client_admin never sees payment records.
CREATE POLICY "Trophi manages payment methods"
  ON public.payment_methods FOR ALL TO authenticated
  USING (public.is_trophi_staff_for(business_id))
  WITH CHECK (public.is_trophi_staff_for(business_id));

CREATE TRIGGER payment_methods_updated
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- payment_authorizations ----------
CREATE TABLE public.payment_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  choice text NOT NULL CHECK (choice IN ('brand','per_location')),
  pandadoc_document_id text UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent_to_client','completed','voided')),
  signed_pdf_path text,
  signer_name text,
  signer_role text,
  signer_email text,
  signed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_auth_business_idx ON public.payment_authorizations(business_id);

GRANT SELECT, INSERT, UPDATE ON public.payment_authorizations TO authenticated;
GRANT ALL ON public.payment_authorizations TO service_role;

ALTER TABLE public.payment_authorizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trophi manages payment authorizations"
  ON public.payment_authorizations FOR ALL TO authenticated
  USING (public.is_trophi_staff_for(business_id))
  WITH CHECK (public.is_trophi_staff_for(business_id));

CREATE TRIGGER payment_authorizations_updated
  BEFORE UPDATE ON public.payment_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Storage policies: contracts bucket ----------
-- Path convention: {businessId}/contracts/... (first path segment is businessId)

CREATE POLICY "contracts read: trophi + client_admin"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'contracts'
    AND (
      public.is_trophi_staff_for((storage.foldername(name))[1])
      OR public.is_client_admin_for((storage.foldername(name))[1])
    )
  );

CREATE POLICY "contracts write: trophi only"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contracts'
    AND public.is_trophi_staff_for((storage.foldername(name))[1])
  );

CREATE POLICY "contracts update: trophi only"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'contracts' AND public.is_trophi_staff_for((storage.foldername(name))[1]))
  WITH CHECK (bucket_id = 'contracts' AND public.is_trophi_staff_for((storage.foldername(name))[1]));

CREATE POLICY "contracts delete: admins only"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'contracts'
    AND public.has_role(auth.uid(), 'admin')
  );

-- ---------- Storage policies: payment bucket (Trophi only) ----------
CREATE POLICY "payment read: trophi only"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment'
    AND public.is_trophi_staff_for((storage.foldername(name))[1])
  );

CREATE POLICY "payment write: trophi only"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment'
    AND public.is_trophi_staff_for((storage.foldername(name))[1])
  );

CREATE POLICY "payment update: trophi only"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payment' AND public.is_trophi_staff_for((storage.foldername(name))[1]))
  WITH CHECK (bucket_id = 'payment' AND public.is_trophi_staff_for((storage.foldername(name))[1]));

CREATE POLICY "payment delete: admins only"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment'
    AND public.has_role(auth.uid(), 'admin')
  );