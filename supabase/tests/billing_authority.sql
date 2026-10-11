-- P1 SQL Tests: billing_authority
-- NOTE: These tests were written but not executed because no local Supabase / Postgres stack
-- is available in this environment. They are written against the real schema and should be run
-- with: supabase db test (local stack) or psql against a test database.

-- ============================================================
-- SETUP: helper to create a user and pending payment in test
-- ============================================================
-- test_user_id UUID:  use a stable UUID for isolation
-- test_payment_id UUID: stable UUID for a test payment

DO $$ BEGIN
  -- Ensure plans row exists
  INSERT INTO public.plans VALUES ('premium_30d', 189.00, 30, true)
    ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- TEST 1: authenticated client cannot write billing columns
-- ============================================================
-- As authenticated, the trigger (SECURITY INVOKER) should prevent
-- changes to premium_expires_at, payment_received_at, is_premium, subscription_status.
DO $$ DECLARE
  v_uid uuid := gen_random_uuid();
  v_raised boolean := false;
BEGIN
  -- Insert a basic user row (simulate handle_new_user trigger output)
  INSERT INTO public.users (id, full_name, email)
    VALUES (v_uid, 'Test User', 'test@example.com');

  -- Attempt to forge premium as authenticated role
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims TO json_build_object('sub', v_uid::text)::text;
  BEGIN
    UPDATE public.users
      SET is_premium = true, subscription_status = 'active',
          payment_received_at = now(), premium_expires_at = now() + interval '30d'
      WHERE id = v_uid;
    -- Should not reach here since column grants exclude billing cols
    RAISE EXCEPTION 'TEST FAILED: billing columns should not be writable by authenticated';
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED: expected privilege error not raised';
  END IF;
  RAISE NOTICE 'PASS: authenticated cannot write billing columns';
ROLLBACK;
END $$;

-- ============================================================
-- TEST 2: Profile columns ARE writable by the authenticated user
-- ============================================================
DO $$ DECLARE
  v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.users (id, full_name, email)
    VALUES (v_uid, 'Test User', 'test2@example.com');

  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims TO json_build_object('sub', v_uid::text)::text;
  UPDATE public.users
    SET full_name = 'Updated Name', health_mode = 'diabetes'
    WHERE id = v_uid;
  RAISE NOTICE 'PASS: authenticated can update profile columns';
ROLLBACK;
END $$;

-- ============================================================
-- TEST 3: grant_premium is idempotent
-- ============================================================
DO $$ DECLARE
  v_uid  uuid := gen_random_uuid();
  v_pid  uuid := gen_random_uuid();
  r1     jsonb; r2 jsonb;
BEGIN
  INSERT INTO public.users (id, full_name, email) VALUES (v_uid, 'User3', 'u3@example.com');
  INSERT INTO public.payments (id, user_id, amount, plan, payment_method, transaction_ref, status)
    VALUES (v_pid, v_uid, 189.00, 'premium_30d', 'paystack', 'ref-test-3', 'pending');

  r1 := public.grant_premium(v_pid, 189.00, 'KES');
  IF r1->>'result' <> 'granted' THEN
    RAISE EXCEPTION 'TEST FAILED: first grant expected "granted", got: %', r1;
  END IF;

  r2 := public.grant_premium(v_pid, 189.00, 'KES');
  IF r2->>'result' <> 'already_granted' THEN
    RAISE EXCEPTION 'TEST FAILED: second grant expected "already_granted", got: %', r2;
  END IF;
  RAISE NOTICE 'PASS: grant_premium is idempotent';
ROLLBACK;
END $$;

-- ============================================================
-- TEST 4: grant_premium rejects wrong amount
-- ============================================================
DO $$ DECLARE
  v_uid  uuid := gen_random_uuid();
  v_pid  uuid := gen_random_uuid();
  r      jsonb;
BEGIN
  INSERT INTO public.users (id, full_name, email) VALUES (v_uid, 'User4', 'u4@example.com');
  INSERT INTO public.payments (id, user_id, amount, plan, payment_method, transaction_ref, status)
    VALUES (v_pid, v_uid, 189.00, 'premium_30d', 'paystack', 'ref-test-4', 'pending');

  r := public.grant_premium(v_pid, 50.00, 'KES');
  IF r->>'result' <> 'amount_mismatch' THEN
    RAISE EXCEPTION 'TEST FAILED: expected amount_mismatch, got: %', r;
  END IF;
  RAISE NOTICE 'PASS: grant_premium rejects wrong amount';
ROLLBACK;
END $$;

-- ============================================================
-- TEST 5: grant_premium rejects wrong currency
-- ============================================================
DO $$ DECLARE
  v_uid  uuid := gen_random_uuid();
  v_pid  uuid := gen_random_uuid();
  r      jsonb;
BEGIN
  INSERT INTO public.users (id, full_name, email) VALUES (v_uid, 'User5', 'u5@example.com');
  INSERT INTO public.payments (id, user_id, amount, plan, payment_method, transaction_ref, status)
    VALUES (v_pid, v_uid, 189.00, 'premium_30d', 'paystack', 'ref-test-5', 'pending');

  r := public.grant_premium(v_pid, 189.00, 'USD');
  IF r->>'result' <> 'amount_mismatch' THEN
    RAISE EXCEPTION 'TEST FAILED: expected amount_mismatch for wrong currency, got: %', r;
  END IF;
  RAISE NOTICE 'PASS: grant_premium rejects wrong currency';
ROLLBACK;
END $$;

-- ============================================================
-- TEST 6: grant_premium stacks (extends from current expiry)
-- ============================================================
DO $$ DECLARE
  v_uid  uuid := gen_random_uuid();
  v_pid1 uuid := gen_random_uuid();
  v_pid2 uuid := gen_random_uuid();
  v_exp1 timestamptz; v_exp2 timestamptz;
  r1     jsonb; r2 jsonb;
BEGIN
  INSERT INTO public.users (id, full_name, email) VALUES (v_uid, 'User6', 'u6@example.com');
  INSERT INTO public.payments (id, user_id, amount, plan, payment_method, transaction_ref, status)
    VALUES (v_pid1, v_uid, 189.00, 'premium_30d', 'paystack', 'ref-6a', 'pending');
  INSERT INTO public.payments (id, user_id, amount, plan, payment_method, transaction_ref, status)
    VALUES (v_pid2, v_uid, 189.00, 'premium_30d', 'paystack', 'ref-6b', 'pending');

  r1 := public.grant_premium(v_pid1, 189.00, 'KES');
  SELECT premium_expires_at INTO v_exp1 FROM public.users WHERE id = v_uid;

  r2 := public.grant_premium(v_pid2, 189.00, 'KES');
  SELECT premium_expires_at INTO v_exp2 FROM public.users WHERE id = v_uid;

  IF v_exp2 <= v_exp1 THEN
    RAISE EXCEPTION 'TEST FAILED: second grant should extend expiry beyond first, exp1=% exp2=%', v_exp1, v_exp2;
  END IF;
  RAISE NOTICE 'PASS: grant_premium stacks correctly (exp1=%, exp2=%)', v_exp1, v_exp2;
ROLLBACK;
END $$;

-- ============================================================
-- TEST 7: is_premium_active returns false after expiry
-- ============================================================
DO $$ DECLARE
  v_uid  uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.users (id, full_name, email, premium_expires_at)
    VALUES (v_uid, 'User7', 'u7@example.com', now() - interval '1 second');

  IF public.is_premium_active(v_uid) THEN
    RAISE EXCEPTION 'TEST FAILED: is_premium_active should be false for expired user';
  END IF;
  RAISE NOTICE 'PASS: is_premium_active returns false after expiry';
ROLLBACK;
END $$;

-- NOTE: Tests 1 & 2 (column grant checks) require running at the DB role level; they will
-- behave correctly only on a Postgres instance where the column grants have been applied.
-- All other tests operate as service_role (superuser in local dev) and verify logic only.
