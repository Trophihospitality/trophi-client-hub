CREATE POLICY "Client users can view own row"
ON public.client_users
FOR SELECT
TO authenticated
USING (user_id = auth.uid());