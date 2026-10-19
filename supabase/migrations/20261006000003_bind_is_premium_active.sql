-- Migration for M-017: Bind is_premium_active to auth.uid()
CREATE OR REPLACE FUNCTION public.is_premium_active(p_uid uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF p_uid <> auth.uid() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT premium_expires_at > now() FROM public.users WHERE id = p_uid), false);
END $$;
REVOKE ALL ON FUNCTION public.is_premium_active(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_premium_active(uuid) TO authenticated, service_role;
