
-- Storage RLS: files are stored under <business_id>/<uuid>-<filename>
CREATE POLICY "attachments storage read via client"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'client-attachments'
  AND public.can_access_client(split_part(name, '/', 1))
);
CREATE POLICY "attachments storage insert via client"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'client-attachments'
  AND public.can_access_client(split_part(name, '/', 1))
);
CREATE POLICY "attachments storage delete via client"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'client-attachments'
  AND public.can_access_client(split_part(name, '/', 1))
);
