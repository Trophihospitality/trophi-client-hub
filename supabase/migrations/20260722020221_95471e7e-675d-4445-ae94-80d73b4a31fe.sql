
ALTER TABLE public.role_history
  ADD COLUMN IF NOT EXISTS trainer_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mentor_status text NOT NULL DEFAULT 'assigned',
  ADD COLUMN IF NOT EXISTS mentor_assigned_at timestamptz;

-- Set mentor_assigned_at for existing mentors so timeline is not blank
UPDATE public.profiles SET mentor_assigned_at = now()
  WHERE mentor_id IS NOT NULL AND mentor_assigned_at IS NULL;
