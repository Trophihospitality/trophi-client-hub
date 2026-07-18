
-- Add contact role column and interpret budget as monthly-per-location.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contact_role text;

-- Migrate existing budget values: they were previously "Annual total budget";
-- new semantics are "Monthly budget per location". Convert by /12 then / active locations.
UPDATE public.clients c
SET budget = ROUND(
  (c.budget::numeric / 12.0) /
  GREATEST(
    (SELECT COUNT(*) FROM public.locations l
       WHERE l.business_id = c.business_id AND COALESCE(l.status,'active') = 'active'),
    1
  )
)
WHERE c.budget IS NOT NULL;

COMMENT ON COLUMN public.clients.budget IS 'Monthly budget per active location (USD).';
COMMENT ON COLUMN public.clients.contact_role IS 'Role of the point of contact (Owner, Partner, C-Suite, Director, Leadership, Manager, Admin, Other).';
