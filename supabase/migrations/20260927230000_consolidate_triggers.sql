CREATE OR REPLACE FUNCTION public.enforce_billing_state()
RETURNS TRIGGER AS $$
BEGIN
    IF current_user IN ('authenticated', 'anon') THEN
        -- Block client-side writes to billing columns entirely
        NEW.is_premium := OLD.is_premium;
        NEW.subscription_status := OLD.subscription_status;
        NEW.payment_received_at := OLD.payment_received_at;
    END IF;

    -- ALWAYS apply server-computed expiry, regardless of who triggered the update
    IF NEW.payment_received_at IS NOT NULL
        AND NEW.subscription_status = 'active'
        AND NOW() >= NEW.payment_received_at + INTERVAL '30 days'
    THEN
        NEW.subscription_status := 'expired';
        NEW.is_premium := false;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old triggers
DROP TRIGGER IF EXISTS trg_protect_billing_columns ON public.users;
DROP TRIGGER IF EXISTS trg_subscription_expiry ON public.users;

-- Attach consolidated trigger
CREATE TRIGGER trg_enforce_billing_state
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_billing_state();
