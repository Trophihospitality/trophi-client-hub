
UPDATE public.client_users
   SET user_id = NULL,
       status = 'invited',
       activated_at = NULL,
       invite_last_error = NULL
 WHERE business_id = 'TRP-U8RZKR'
   AND lower(email) = 'billing@trophihospitality.com';
