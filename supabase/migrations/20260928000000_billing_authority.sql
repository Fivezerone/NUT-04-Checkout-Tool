-- P1: Billing authority migration
-- Authoritative expiry (D4)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS premium_expires_at timestamptz;
UPDATE public.users SET premium_expires_at = payment_received_at + interval '30 days'
 WHERE payment_received_at IS NOT NULL AND premium_expires_at IS NULL;
ALTER TABLE public.users ALTER COLUMN subscription_status SET DEFAULT 'basic';
-- E-002: Must replace constraint BEFORE updating legacy rows
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_subscription_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_subscription_status_check CHECK (subscription_status IN ('active', 'expired', 'basic'));
-- Convert legacy trialing rows (LOGIC-006 / D7: no free trial)
UPDATE public.users SET subscription_status = 'basic' WHERE subscription_status = 'trialing';

-- Server-owned price
CREATE TABLE IF NOT EXISTS public.plans (
  code text PRIMARY KEY, price_kes numeric(10,2) NOT NULL,
  duration_days int NOT NULL, active boolean NOT NULL DEFAULT true);
INSERT INTO public.plans VALUES ('premium_30d', 189.00, 30, true) ON CONFLICT DO NOTHING;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plans FROM anon, authenticated;
GRANT SELECT ON public.plans TO authenticated;
CREATE POLICY plans_read ON public.plans FOR SELECT TO authenticated USING (active);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'premium_30d',
  ADD COLUMN IF NOT EXISTS provider_amount numeric,
  ADD COLUMN IF NOT EXISTS granted_at timestamptz;

-- SEC-011: column privileges are the primary control
REVOKE INSERT, UPDATE ON public.users FROM authenticated, anon;
GRANT INSERT (id, full_name, email, dob, gender, condition, metric, notification_frequency,
              terms_accepted, privacy_accepted, consent_timestamp, onboarding_completed,
              health_mode, selected_tags) ON public.users TO authenticated;
GRANT UPDATE (id, full_name, email, dob, gender, condition, metric, notification_frequency,
              terms_accepted, privacy_accepted, consent_timestamp, onboarding_completed,
              health_mode, selected_tags) ON public.users TO authenticated;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Defense in depth: ONE trigger, SECURITY INVOKER (fixes the bug from audit SEC-003 where
-- SECURITY DEFINER made current_user the function owner, causing the guard to never fire).
-- Replaces trg_protect_billing_columns and trg_subscription_expiry.
DROP TRIGGER IF EXISTS trg_protect_billing_columns ON public.users;
DROP TRIGGER IF EXISTS trg_subscription_expiry ON public.users;
DROP TRIGGER IF EXISTS trg_enforce_billing_state ON public.users;
CREATE OR REPLACE FUNCTION public.enforce_billing_state() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.premium_expires_at := NULL; NEW.payment_received_at := NULL;
    ELSE
      NEW.premium_expires_at := OLD.premium_expires_at;
      NEW.payment_received_at := OLD.payment_received_at;
    END IF;
  END IF;
  NEW.is_premium := (NEW.premium_expires_at IS NOT NULL AND NEW.premium_expires_at > now());
  NEW.subscription_status := CASE WHEN NEW.premium_expires_at IS NULL THEN 'basic'
       WHEN NEW.premium_expires_at > now() THEN 'active' ELSE 'expired' END;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enforce_billing_state BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_billing_state();

-- Live entitlement helpers
CREATE OR REPLACE FUNCTION public.is_premium_active(p_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT premium_expires_at > now() FROM public.users WHERE id = p_uid), false) $$;
CREATE OR REPLACE FUNCTION public.get_my_entitlement() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'tier', CASE WHEN u.premium_expires_at > now() THEN 'premium' ELSE 'basic' END,
    'premium_expires_at', u.premium_expires_at,
    'ever_premium', u.premium_expires_at IS NOT NULL,
    'server_now', now())
  FROM public.users u WHERE u.id = auth.uid() $$;
REVOKE ALL ON FUNCTION public.is_premium_active(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_premium_active(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_entitlement() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_entitlement() TO authenticated;

-- The ONLY way premium is granted. Idempotent, amount-checked, stacking (A1).
CREATE OR REPLACE FUNCTION public.grant_premium(
  p_payment_id uuid, p_provider_amount numeric DEFAULT NULL, p_provider_currency text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pay public.payments%ROWTYPE; v_plan public.plans%ROWTYPE; v_exp timestamptz;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result','not_found'); END IF;
  IF v_pay.status = 'completed' THEN RETURN jsonb_build_object('result','already_granted'); END IF;
  IF v_pay.status <> 'pending' THEN
    RETURN jsonb_build_object('result','not_pending','status',v_pay.status); END IF;
  SELECT * INTO v_plan FROM public.plans WHERE code = v_pay.plan AND active;
  IF NOT FOUND
     OR v_pay.amount IS DISTINCT FROM v_plan.price_kes
     OR (p_provider_amount IS NOT NULL AND p_provider_amount IS DISTINCT FROM v_plan.price_kes)
     OR (p_provider_currency IS NOT NULL AND upper(p_provider_currency) <> 'KES') THEN
    UPDATE public.payments SET status='amount_mismatch', provider_amount=p_provider_amount,
           updated_at=now() WHERE id = p_payment_id;
    RETURN jsonb_build_object('result','amount_mismatch');
  END IF;
  UPDATE public.payments SET status='completed', granted_at=now(), updated_at=now(),
         provider_amount = COALESCE(p_provider_amount, amount) WHERE id = p_payment_id;
  UPDATE public.users
     SET premium_expires_at = greatest(now(), COALESCE(premium_expires_at, now()))
                              + make_interval(days => v_plan.duration_days),
         payment_received_at = now()
   WHERE id = v_pay.user_id RETURNING premium_expires_at INTO v_exp;
  RETURN jsonb_build_object('result','granted','premium_expires_at', v_exp);
END $$;
REVOKE ALL ON FUNCTION public.grant_premium(uuid,numeric,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_premium(uuid,numeric,text) TO service_role;
