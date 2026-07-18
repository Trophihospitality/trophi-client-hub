
-- ==============================
-- CONTACT LOGS
-- ==============================
CREATE TABLE public.contact_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  contact_date DATE NOT NULL,
  method TEXT NOT NULL,
  discussion TEXT NOT NULL CHECK (length(btrim(discussion)) > 0),
  logged_by UUID NOT NULL,
  logged_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contact_logs_business_id_idx ON public.contact_logs(business_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_logs TO authenticated;
GRANT ALL ON public.contact_logs TO service_role;

ALTER TABLE public.contact_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_logs read by client access"
  ON public.contact_logs FOR SELECT TO authenticated
  USING (public.can_access_client(business_id));
CREATE POLICY "contact_logs insert by client access"
  ON public.contact_logs FOR INSERT TO authenticated
  WITH CHECK (public.can_access_client(business_id) AND logged_by = auth.uid());
CREATE POLICY "contact_logs update by privileged"
  ON public.contact_logs FOR UPDATE TO authenticated
  USING (public.is_privileged(auth.uid()));
CREATE POLICY "contact_logs delete by privileged"
  ON public.contact_logs FOR DELETE TO authenticated
  USING (public.is_privileged(auth.uid()));

-- ==============================
-- FOLLOW-UPS (task-ready)
-- ==============================
CREATE TABLE public.follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.clients(business_id) ON DELETE CASCADE,
  assigned_to UUID NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','rescheduled')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  rescheduled_to UUID REFERENCES public.follow_ups(id) ON DELETE SET NULL
);
CREATE INDEX follow_ups_business_status_idx ON public.follow_ups(business_id, status);
CREATE INDEX follow_ups_assigned_idx ON public.follow_ups(assigned_to, status, due_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.follow_ups TO authenticated;
GRANT ALL ON public.follow_ups TO service_role;

ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follow_ups read by client access"
  ON public.follow_ups FOR SELECT TO authenticated
  USING (public.can_access_client(business_id));
CREATE POLICY "follow_ups insert by client access"
  ON public.follow_ups FOR INSERT TO authenticated
  WITH CHECK (public.can_access_client(business_id) AND created_by = auth.uid());
CREATE POLICY "follow_ups update by client access"
  ON public.follow_ups FOR UPDATE TO authenticated
  USING (public.can_access_client(business_id));
CREATE POLICY "follow_ups delete by privileged"
  ON public.follow_ups FOR DELETE TO authenticated
  USING (public.is_privileged(auth.uid()));

CREATE TRIGGER follow_ups_set_updated
  BEFORE UPDATE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Keep clients.next_follow_up_date in sync with the earliest pending follow_up.
CREATE OR REPLACE FUNCTION public.sync_client_next_follow_up(_business_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE next_due DATE;
BEGIN
  SELECT MIN(due_date) INTO next_due
  FROM public.follow_ups
  WHERE business_id = _business_id AND status = 'pending';
  UPDATE public.clients SET next_follow_up_date = next_due WHERE business_id = _business_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_client_next_follow_up(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.follow_ups_sync_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_client_next_follow_up(OLD.business_id);
    RETURN OLD;
  ELSE
    PERFORM public.sync_client_next_follow_up(NEW.business_id);
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER follow_ups_sync_client_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.follow_ups_sync_client();
