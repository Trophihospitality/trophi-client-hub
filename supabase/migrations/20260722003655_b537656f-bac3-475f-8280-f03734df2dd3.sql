
CREATE TABLE public.awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  period_type text NOT NULL CHECK (period_type IN ('monthly','quarterly','yearly')),
  period text NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_key text,
  metric_label text,
  metric_value numeric,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  awarded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX awards_recipient_idx ON public.awards(recipient_user_id);
CREATE INDEX awards_period_idx ON public.awards(period);

GRANT SELECT ON public.awards TO authenticated;
GRANT ALL ON public.awards TO service_role;

ALTER TABLE public.awards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view awards"
  ON public.awards FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins manage awards"
  ON public.awards FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_awards_updated_at
  BEFORE UPDATE ON public.awards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
