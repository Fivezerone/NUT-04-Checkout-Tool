-- SEC-003 SQL Test Script
-- 1. Insert a test user with payment_received_at 31 days in the past and is_premium=true
INSERT INTO public.users (id, subscription_status, is_premium, payment_received_at)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'active',
    true,
    NOW() - INTERVAL '31 days'
);

-- 2. Run an innocuous UPDATE as the authenticated role
SET ROLE authenticated;
UPDATE public.users SET updated_at = NOW() WHERE id = '00000000-0000-0000-0000-000000000001';

-- 3. Assert is_premium became false
SELECT is_premium, subscription_status FROM public.users WHERE id = '00000000-0000-0000-0000-000000000001';
-- Expected: false, 'expired'
