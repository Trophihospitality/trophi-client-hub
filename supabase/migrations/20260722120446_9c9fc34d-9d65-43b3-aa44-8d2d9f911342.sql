
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_path text;

-- Storage RLS on trophi-avatars bucket. Path convention: <user_id>/avatar.<ext>
CREATE POLICY "trophi-avatars staff read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'trophi-avatars' AND public.is_trophi_user(auth.uid()));

CREATE POLICY "trophi-avatars self or spiro write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'trophi-avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_spiro(auth.uid())
  )
);

CREATE POLICY "trophi-avatars self or spiro update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'trophi-avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_spiro(auth.uid())
  )
)
WITH CHECK (
  bucket_id = 'trophi-avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_spiro(auth.uid())
  )
);

CREATE POLICY "trophi-avatars self or spiro delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'trophi-avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_spiro(auth.uid())
  )
);
