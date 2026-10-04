-- P2 SQL Tests: catalog RLS
-- Run with: psql <connection_string> -f supabase/tests/catalog_rls.sql
-- Requires: both P1 and P2 migrations applied.

-- ─── TEST 1: anon cannot select from catalog_products ────────────────────────
DO $$ BEGIN
  EXECUTE 'SET ROLE anon';
  BEGIN
    PERFORM * FROM public.catalog_products LIMIT 1;
    RAISE EXCEPTION ''TEST FAILED: anon should not read catalog_products'';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE ''PASS: anon cannot read catalog_products'';
  END;
  EXECUTE 'RESET ROLE';
END $$;

-- ─── TEST 2: anon cannot select from catalog_premium ─────────────────────────
DO $$ BEGIN
  EXECUTE 'SET ROLE anon';
  BEGIN
    PERFORM * FROM public.catalog_premium LIMIT 1;
    RAISE EXCEPTION ''TEST FAILED: anon should not read catalog_premium'';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE ''PASS: anon cannot read catalog_premium'';
  END;
  EXECUTE 'RESET ROLE';
END $$;

-- ─── TEST 3: anon cannot select from catalog_releases ────────────────────────
DO $$ BEGIN
  EXECUTE 'SET ROLE anon';
  BEGIN
    PERFORM * FROM public.catalog_releases LIMIT 1;
    RAISE EXCEPTION ''TEST FAILED: anon should not read catalog_releases'';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE ''PASS: anon cannot read catalog_releases'';
  END;
  EXECUTE 'RESET ROLE';
END $$;

-- ─── TEST 4: authenticated (basic) reads catalog_products but NOT catalog_premium
-- (This test requires a real JWT-based session; in a local psql test we simulate
--  by setting the role and verifying that is_premium_active returns false for new users)
DO $$ DECLARE
  v_uid uuid := gen_random_uuid();
BEGIN
  -- Create a basic user (no premium_expires_at)
  INSERT INTO public.users (id, full_name, email)
    VALUES (v_uid, ''Basic User'', ''basic@example.com'');
  -- Verify is_premium_active is false
  IF public.is_premium_active(v_uid) THEN
    RAISE EXCEPTION ''TEST FAILED: new user should not be premium'';
  END IF;
  RAISE NOTICE ''PASS: basic user is not premium (is_premium_active=false)'';
ROLLBACK;
END $$;

-- ─── TEST 5: user with future premium_expires_at passes is_premium_active ────
DO $$ DECLARE
  v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.users (id, full_name, email, premium_expires_at)
    VALUES (v_uid, ''Premium User'', ''premium@example.com'', now() + interval ''30 days'');
  IF NOT public.is_premium_active(v_uid) THEN
    RAISE EXCEPTION ''TEST FAILED: premium user should have is_premium_active=true'';
  END IF;
  RAISE NOTICE ''PASS: premium user has is_premium_active=true'';
ROLLBACK;
END $$;

-- ─── TEST 6: legacy public.products table is no longer publicly readable ─────
DO $$ BEGIN
  EXECUTE 'SET ROLE anon';
  BEGIN
    PERFORM * FROM public.products LIMIT 1;
    RAISE EXCEPTION ''TEST FAILED: anon should not read public.products after policy drop'';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE ''PASS: anon cannot read public.products'';
  END;
  EXECUTE 'RESET ROLE';
END $$;

RAISE NOTICE ''All P2 SQL tests written. Execute against local Supabase for live verification.'';
