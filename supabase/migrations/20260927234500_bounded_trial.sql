ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.enforce_billing_state()
RETURNS TRIGGER AS $$
BEGIN
    IF current_user IN ('authenticated', 'anon') THEN
        -- Block client-side writes to billing columns entirely
        NEW.is_premium := OLD.is_premium;
        NEW.subscription_status := OLD.subscription_status;
        NEW.payment_received_at := OLD.payment_received_at;
        NEW.trial_started_at := OLD.trial_started_at;
    END IF;

    -- Apply server-computed expiry for paid subscriptions
    IF NEW.payment_received_at IS NOT NULL
        AND NEW.subscription_status = 'active'
        AND NOW() >= NEW.payment_received_at + INTERVAL '30 days'
    THEN
        NEW.subscription_status := 'expired';
        NEW.is_premium := false;
    END IF;

    -- Apply server-computed expiry for trials
    IF NEW.subscription_status = 'trialing'
        AND NEW.trial_started_at IS NOT NULL
        AND NOW() >= NEW.trial_started_at + INTERVAL '30 days'
    THEN
        NEW.subscription_status := 'expired';
        NEW.is_premium := false;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
