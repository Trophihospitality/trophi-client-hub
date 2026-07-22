ALTER TABLE public.client_users
  ADD COLUMN IF NOT EXISTS invite_sent_to text;