CREATE OR REPLACE FUNCTION public.enforce_trophi_avatar_limits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sz bigint;
  mt text;
BEGIN
  IF NEW.bucket_id <> 'trophi-avatars' THEN
    RETURN NEW;
  END IF;
  sz := COALESCE((NEW.metadata->>'size')::bigint, 0);
  mt := lower(COALESCE(NEW.metadata->>'mimetype', ''));
  IF sz > 5242880 THEN
    RAISE EXCEPTION 'Avatar must be 5 MB or smaller' USING ERRCODE = 'check_violation';
  END IF;
  IF mt NOT IN ('image/jpeg','image/png','image/webp') THEN
    RAISE EXCEPTION 'Avatar must be a JPEG, PNG, or WebP image' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_trophi_avatar_limits ON storage.objects;
CREATE TRIGGER trg_enforce_trophi_avatar_limits
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.enforce_trophi_avatar_limits();