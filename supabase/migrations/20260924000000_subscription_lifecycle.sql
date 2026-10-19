-- ============================================================
-- NUT-04 Subscription Lifecycle Migration
-- Adds strict 30-day premium enforcement columns to public.users
-- ============================================================

-- 1. Add subscription lifecycle columns
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS payment_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status IN ('active', 'expired', 'trialing'));

-- 2. Index for fast expiry queries (used by the guard middleware)
CREATE INDEX IF NOT EXISTS idx_users_subscription_status
  ON public.users (subscription_status);

CREATE INDEX IF NOT EXISTS idx_users_payment_received_at
  ON public.users (payment_received_at)
  WHERE payment_received_at IS NOT NULL;

-- 3. Trigger function: auto-flip status to 'expired' when 30 days have passed.
--    Fires on every UPDATE so the status stays accurate without a scheduled job.
CREATE OR REPLACE FUNCTION public.check_subscription_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_received_at IS NOT NULL
     AND NEW.subscription_status = 'active'
     AND NOW() >= NEW.payment_received_at + INTERVAL '30 days'
  THEN
    NEW.subscription_status := 'expired';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger (idempotent)
DROP TRIGGER IF EXISTS trg_subscription_expiry ON public.users;
CREATE TRIGGER trg_subscription_expiry
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.check_subscription_expiry();

-- 4. Backfill: set payment_received_at + subscription_status for users who
--    already have a completed payment record (status = 'completed').
UPDATE public.users u
SET
  payment_received_at = p.created_at,
  subscription_status = CASE
    WHEN NOW() < p.created_at + INTERVAL '30 days' THEN 'active'
    ELSE 'expired'
  END,
  is_premium = (NOW() < p.created_at + INTERVAL '30 days')
FROM (
  -- Pick the most recent completed payment per user
  SELECT DISTINCT ON (user_id) user_id, created_at
  FROM public.payments
  WHERE status = 'completed'
  ORDER BY user_id, created_at DESC
) p
WHERE u.id = p.user_id
  AND u.payment_received_at IS NULL; -- only backfill once

-- 5. RLS: allow the authenticated user to read their own subscription columns
--    (the existing "Users can view own profile" policy already covers SELECT,
--     so no new policy is needed for reads.)

-- Allow the Edge Function (service role) to flip subscription_status to 'expired'.
-- Service role bypasses RLS, so no additional policy is required for server-side writes.

-- 6. Helper view (optional — useful for admin queries):
CREATE OR REPLACE VIEW public.active_subscriptions WITH (security_invoker = true) AS
  SELECT id, email, full_name, payment_received_at,
         subscription_status,
         (payment_received_at + INTERVAL '30 days') AS expires_at,
         GREATEST(0, EXTRACT(EPOCH FROM
           (payment_received_at + INTERVAL '30 days') - NOW()
         ) / 86400)::INT AS days_remaining
  FROM public.users
  WHERE subscription_status = 'active';

REVOKE ALL ON public.active_subscriptions FROM anon, authenticated, public;
