
alter table public.profiles
  add column if not exists invited_at timestamptz,
  add column if not exists invite_last_error text,
  add column if not exists invite_last_attempt_at timestamptz;

update public.profiles p
  set invited_at = u.invited_at
  from auth.users u
  where p.user_id = u.id
    and p.invited_at is null
    and u.invited_at is not null;
