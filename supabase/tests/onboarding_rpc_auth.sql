-- SQL authorization tests for new onboarding RPCs
-- Run against a disposable Supabase-compatible Postgres with _bootstrap.sql applied first
-- Covers: Phase 7 audit requirements (RLS, RPC security, billing protection)

\set ON_ERROR_STOP on

-- Apply migrations in order
\i supabase/tests/_bootstrap.sql
\i supabase/migrations/20240101000000_schema.sql
\i supabase/migrations/20240922000000_realtime.sql
\i supabase/migrations/20260922173139_query_payments.sql
\i supabase/migrations/20260922183709_fix_payments_fk.sql
\i supabase/migrations/20260924000000_subscription_lifecycle.sql
\i supabase/migrations/20260924120000_user_profile_columns.sql
\i supabase/migrations/20260924130000_protect_billing_columns.sql
\i supabase/migrations/20260927230000_consolidate_triggers.sql
\i supabase/migrations/20260927234500_bounded_trial.sql
\i supabase/migrations/20260928000000_billing_authority.sql
\i supabase/migrations/20260928010000_catalog_schema.sql
\i supabase/migrations/20261006000002_mpesa_client_reference.sql
\i supabase/migrations/20261006000003_bind_is_premium_active.sql
\i supabase/migrations/20261010000000_onboarding_state.sql

BEGIN;

-- Setup: two test users
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@test.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@test.com');

INSERT INTO public.users (id, email, full_name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@test.com', 'Alice'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@test.com', 'Bob');

-- ─── Test: save_onboarding_step2 ──────────────────────────────────────────────

-- T-01: anon cannot call save_onboarding_step2
SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.save_onboarding_step2('diabetes', 'Sugar');
    RAISE EXCEPTION 'FAIL: anon should not be able to call save_onboarding_step2';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS T-01: anon cannot call save_onboarding_step2';
  END;
END $$;
RESET ROLE;

-- T-02: authenticated user can save their own step 2
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
SELECT public.save_onboarding_step2('diabetes', 'Sugar');
DO $$
DECLARE v_condition text;
BEGIN
  SELECT condition INTO v_condition FROM public.users WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_condition = 'diabetes' THEN
    RAISE NOTICE 'PASS T-02: authenticated user saved step 2 correctly';
  ELSE
    RAISE EXCEPTION 'FAIL T-02: condition not saved, got %', v_condition;
  END IF;
END $$;
RESET ROLE;

-- T-03: authenticated user cannot update another user's row via step2 RPC
-- (RPC uses auth.uid() internally, so it only affects the caller's row)
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
SELECT public.save_onboarding_step2('hypertension', 'Sodium');
DO $$
DECLARE v_alice_cond text; v_bob_cond text;
BEGIN
  SELECT condition INTO v_alice_cond FROM public.users WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT condition INTO v_bob_cond FROM public.users WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  -- Alice's condition should still be diabetes (from T-02), not overwritten by Bob
  IF v_alice_cond = 'diabetes' THEN
    RAISE NOTICE 'PASS T-03: cross-user write prevented';
  ELSE
    RAISE EXCEPTION 'FAIL T-03: alice condition was mutated by bob: %', v_alice_cond;
  END IF;
  IF v_bob_cond = 'hypertension' THEN
    RAISE NOTICE 'PASS T-03b: bob''s own row updated correctly';
  ELSE
    RAISE EXCEPTION 'FAIL T-03b: bob condition not saved: %', v_bob_cond;
  END IF;
END $$;
RESET ROLE;

-- T-04: save_onboarding_step2 rejects empty condition
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
DO $$
DECLARE v_result jsonb;
BEGIN
  SELECT public.save_onboarding_step2('', '') INTO v_result;
  IF (v_result->>'success')::boolean = false THEN
    RAISE NOTICE 'PASS T-04: empty condition rejected';
  ELSE
    RAISE EXCEPTION 'FAIL T-04: empty condition should be rejected';
  END IF;
END $$;
RESET ROLE;

-- ─── Test: save_onboarding_step3 ──────────────────────────────────────────────

-- T-05: save_onboarding_step3 requires both consent booleans
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
DO $$
DECLARE v_result jsonb;
BEGIN
  -- terms false → must fail
  SELECT public.save_onboarding_step3(false, true, 'v1.0', 'v1.0') INTO v_result;
  IF (v_result->>'success')::boolean = false THEN
    RAISE NOTICE 'PASS T-05a: terms=false rejected';
  ELSE
    RAISE EXCEPTION 'FAIL T-05a: should reject terms=false';
  END IF;
  
  -- privacy false → must fail
  SELECT public.save_onboarding_step3(true, false, 'v1.0', 'v1.0') INTO v_result;
  IF (v_result->>'success')::boolean = false THEN
    RAISE NOTICE 'PASS T-05b: privacy=false rejected';
  ELSE
    RAISE EXCEPTION 'FAIL T-05b: should reject privacy=false';
  END IF;

  -- both true → must succeed
  SELECT public.save_onboarding_step3(true, true, 'v1.0', 'v1.0') INTO v_result;
  IF (v_result->>'success')::boolean = true THEN
    RAISE NOTICE 'PASS T-05c: both accepted';
  ELSE
    RAISE EXCEPTION 'FAIL T-05c: both=true should succeed';
  END IF;
END $$;
RESET ROLE;

-- T-06: save_onboarding_step3 saves version and timestamps
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
DO $$
DECLARE v_ver text; v_ts timestamptz;
BEGIN
  SELECT terms_version, terms_accepted_at INTO v_ver, v_ts FROM public.users 
  WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_ver = 'v1.0' AND v_ts IS NOT NULL THEN
    RAISE NOTICE 'PASS T-06: consent version and timestamp saved';
  ELSE
    RAISE EXCEPTION 'FAIL T-06: terms_version=% terms_accepted_at=%', v_ver, v_ts;
  END IF;
END $$;
RESET ROLE;

-- ─── Test: billing fields protected ───────────────────────────────────────────

-- T-07: authenticated user cannot set premium_expires_at via direct UPDATE
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
DO $$
BEGIN
  -- This should succeed at the SQL level but the billing trigger nullifies the value
  UPDATE public.users 
    SET premium_expires_at = now() + interval '9999 days'
  WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  DECLARE v_exp timestamptz;
  BEGIN
    SELECT premium_expires_at INTO v_exp FROM public.users WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    IF v_exp IS NULL OR v_exp <= now() THEN
      RAISE NOTICE 'PASS T-07: premium_expires_at protected by trigger';
    ELSE
      RAISE EXCEPTION 'FAIL T-07: authenticated user set premium_expires_at to %', v_exp;
    END IF;
  END;
END $$;
RESET ROLE;

-- T-08: grant_premium is NOT accessible to authenticated role
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.grant_premium(gen_random_uuid());
    RAISE EXCEPTION 'FAIL T-08: authenticated should not call grant_premium';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS T-08: grant_premium blocked for authenticated role';
  END;
END $$;
RESET ROLE;

-- T-09: get_my_entitlement returns correct tier/ever_premium
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
DO $$
DECLARE v_ent jsonb;
BEGIN
  SELECT public.get_my_entitlement() INTO v_ent;
  IF v_ent->>'tier' = 'basic' AND (v_ent->>'ever_premium')::boolean = false THEN
    RAISE NOTICE 'PASS T-09: entitlement shows basic, ever_premium=false for new user';
  ELSE
    RAISE EXCEPTION 'FAIL T-09: expected basic/false, got %', v_ent;
  END IF;
END $$;
RESET ROLE;

ROLLBACK;

\echo 'All SQL authorization tests passed.'
