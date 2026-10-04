-- ============================================================
-- Protect Billing Columns
-- Revokes client-side write access to billing state by resetting
-- protected columns to their OLD values unless the request comes
-- from the service_role (e.g. Edge Functions).
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_billing_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- 'authenticated' and 'anon' are the roles used by client SDKs.
  -- 'service_role' is used by Edge Functions.
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.is_premium = OLD.is_premium;
    NEW.subscription_status = OLD.subscription_status;
    NEW.payment_received_at = OLD.payment_received_at;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_billing_columns ON public.users;
CREATE TRIGGER trg_protect_billing_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_billing_columns();
