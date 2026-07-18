ALTER FUNCTION public.gen_business_id() SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.gen_business_id() TO authenticated;