
CREATE TABLE public.onboarding_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL,
  step_number integer,
  kind text NOT NULL,
  recipient text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_onb_notif_lookup ON public.onboarding_notifications (business_id, kind, step_number, sent_at DESC);
GRANT SELECT ON public.onboarding_notifications TO authenticated;
GRANT ALL ON public.onboarding_notifications TO service_role;
ALTER TABLE public.onboarding_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read notifications" ON public.onboarding_notifications FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
