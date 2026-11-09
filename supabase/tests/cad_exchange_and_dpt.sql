-- NutriScore CAD Blueprint Phase 7 — pgTAP / SQL Tests
-- Token Revocations, Pairwise Epoch Alias Map, Consent Withdrawal Notices,
-- and Schema Boundary Privileges (Amendment A5)
-- Run as postgres superuser against local Docker Postgres.

BEGIN;

-- ============================================================
-- Helper: cleanup test rows
-- ============================================================
CREATE OR REPLACE FUNCTION pg_temp.p7_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE clinical.clinical_records DISABLE TRIGGER trg_clinical_records_deny_mutation;

  DELETE FROM exchange.revocations WHERE jti IN (
    'c7000000-0000-0000-0000-000000000001'::uuid,
    'c7000000-0000-0000-0000-000000000002'::uuid
  );
  DELETE FROM exchange.alias_map WHERE patient_id = 'b7000000-0000-0000-0000-000000000001'::uuid;
  DELETE FROM clinical.consent_records WHERE patient_id = 'b7000000-0000-0000-0000-000000000001'::uuid;
  DELETE FROM clinical.patients WHERE id = 'b7000000-0000-0000-0000-000000000001'::uuid;
  DELETE FROM audit.outbox WHERE chain_id = '11111111-1111-1111-1111-111111111111' AND resource_id = 'b7000000-0000-0000-0000-000000000001'::uuid;

  ALTER TABLE clinical.clinical_records ENABLE TRIGGER trg_clinical_records_deny_mutation;
END;
$$;

DO $$ BEGIN PERFORM pg_temp.p7_cleanup(); END; $$;

-- ============================================================
-- TEST 1: Token Revocations (Insert, Query, Expiry)
-- ============================================================
DO $$
DECLARE
  v_jti1 uuid := 'c7000000-0000-0000-0000-000000000001';
  v_jti2 uuid := 'c7000000-0000-0000-0000-000000000002';
  v_revoked boolean;
BEGIN
  -- Insert revocation expiring in 15 minutes
  PERFORM exchange.revoke_token(v_jti1, now() + interval '15 minutes', 'patient_logout');

  -- Insert already-expired revocation
  PERFORM exchange.revoke_token(v_jti2, now() - interval '1 minute', 'expired_session');

  -- Active revocation must return true
  SELECT exchange.is_token_revoked(v_jti1) INTO v_revoked;
  IF NOT v_revoked THEN
    RAISE EXCEPTION 'TEST FAIL: is_token_revoked returned false for active revocation';
  END IF;

  -- Expired revocation must return false
  SELECT exchange.is_token_revoked(v_jti2) INTO v_revoked;
  IF v_revoked THEN
    RAISE EXCEPTION 'TEST FAIL: is_token_revoked returned true for expired revocation';
  END IF;

  -- Unrevoked token must return false
  SELECT exchange.is_token_revoked(gen_random_uuid()) INTO v_revoked;
  IF v_revoked THEN
    RAISE EXCEPTION 'TEST FAIL: is_token_revoked returned true for unknown token';
  END IF;

  RAISE NOTICE 'TEST PASS: token revocations and expiry check correctly verified';
END;
$$;

-- ============================================================
-- TEST 2: Alias Map & Pairwise Epoch Isolation
-- ============================================================
DO $$
DECLARE
  v_tenant  uuid := '11111111-1111-1111-1111-111111111111';
  v_patient uuid := 'b7000000-0000-0000-0000-000000000001';
  v_dup_err boolean := false;
  v_erased  int;
BEGIN
  -- Insert patient first for foreign keys
  INSERT INTO clinical.patients (tenant_id, id, full_name_enc)
  VALUES (v_tenant, v_patient, '\x010001112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');

  -- Insert alias for Q4
  INSERT INTO exchange.alias_map (tenant_id, patient_id, epoch, alias)
  VALUES (v_tenant, v_patient, '2026-Q4', 'shp_alias_q4_random123');

  -- Insert alias for Q1 next year (different epoch, same patient -> allowed)
  INSERT INTO exchange.alias_map (tenant_id, patient_id, epoch, alias)
  VALUES (v_tenant, v_patient, '2027-Q1', 'shp_alias_q1_random456');

  -- Duplicate in same epoch -> must be rejected
  BEGIN
    INSERT INTO exchange.alias_map (tenant_id, patient_id, epoch, alias)
    VALUES (v_tenant, v_patient, '2026-Q4', 'shp_alias_duplicate');
  EXCEPTION
    WHEN unique_violation THEN
      v_dup_err := true;
  END;

  IF NOT v_dup_err THEN
    RAISE EXCEPTION 'TEST FAIL: duplicate alias in same epoch was not rejected';
  END IF;

  -- Test manual alias erasure
  v_erased := exchange.erase_alias(v_tenant, v_patient);
  IF v_erased <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 2 aliases erased, got %', v_erased;
  END IF;

  IF EXISTS (SELECT 1 FROM exchange.alias_map WHERE tenant_id = v_tenant AND patient_id = v_patient) THEN
    RAISE EXCEPTION 'TEST FAIL: aliases still present after erase_alias';
  END IF;

  RAISE NOTICE 'TEST PASS: pairwise epoch alias map uniqueness and manual erasure verified';
END;
$$;

-- ============================================================
-- TEST 3: Consent Withdrawal Notice Trigger
-- ============================================================
DO $$
DECLARE
  v_tenant   uuid := '11111111-1111-1111-1111-111111111111';
  v_patient  uuid := 'b7000000-0000-0000-0000-000000000001';
  v_consent  uuid := gen_random_uuid();
  v_outbox   audit.outbox;
BEGIN
  -- Re-insert an alias for patient
  INSERT INTO exchange.alias_map (tenant_id, patient_id, epoch, alias)
  VALUES (v_tenant, v_patient, '2026-Q4', 'shp_alias_to_be_withdrawn');

  -- Insert active consent record
  INSERT INTO clinical.consent_records (
    id, tenant_id, patient_id, purpose, policy_version, lawful_basis
  ) VALUES (
    v_consent, v_tenant, v_patient, 'dietary_profile_sharing', 4,
    ARRAY['Data Protection Act 2019 s.32', 'explicit_consent']
  );

  -- Alias should still exist
  IF NOT EXISTS (SELECT 1 FROM exchange.alias_map WHERE tenant_id = v_tenant AND patient_id = v_patient) THEN
    RAISE EXCEPTION 'TEST FAIL: alias prematurely erased';
  END IF;

  -- Withdraw consent
  UPDATE clinical.consent_records SET withdrawn_at = now() WHERE id = v_consent;

  -- Trigger must have automatically erased all aliases
  IF EXISTS (SELECT 1 FROM exchange.alias_map WHERE tenant_id = v_tenant AND patient_id = v_patient) THEN
    RAISE EXCEPTION 'TEST FAIL: consent withdrawal trigger failed to erase aliases';
  END IF;

  -- Trigger must have written CONSENT_WITHDRAWN to audit outbox
  SELECT * INTO v_outbox FROM audit.outbox WHERE chain_id = v_tenant AND resource_type = 'consent_records' AND resource_id = v_consent;
  IF v_outbox.action <> 'CONSENT_WITHDRAWN' THEN
    RAISE EXCEPTION 'TEST FAIL: CONSENT_WITHDRAWN event missing in audit.outbox';
  END IF;

  RAISE NOTICE 'TEST PASS: consent withdrawal trigger automatically erases exchange aliases and audits revocation';
END;
$$;

-- ============================================================
-- TEST 4: Schema Privileges on Revocations & Alias Map (A5)
-- ============================================================
DO $$
DECLARE
  v_comm_check_rev  boolean;
  v_comm_read_alias boolean;
  v_exch_write_rev  boolean;
  v_exch_read_alias boolean;
BEGIN
  -- svc_commercial CAN check revocations
  SELECT has_table_privilege('svc_commercial', 'exchange.revocations', 'SELECT') INTO v_comm_check_rev;
  IF NOT v_comm_check_rev THEN
    RAISE EXCEPTION 'TEST FAIL: svc_commercial missing SELECT on exchange.revocations';
  END IF;

  -- svc_commercial CANNOT access alias_map
  SELECT has_table_privilege('svc_commercial', 'exchange.alias_map', 'SELECT') INTO v_comm_read_alias;
  IF v_comm_read_alias THEN
    RAISE EXCEPTION 'TEST FAIL (A5): svc_commercial must not have access to exchange.alias_map';
  END IF;

  -- svc_exchange CAN insert/check revocations and manage alias_map
  SELECT has_table_privilege('svc_exchange', 'exchange.revocations', 'INSERT') INTO v_exch_write_rev;
  SELECT has_table_privilege('svc_exchange', 'exchange.alias_map', 'SELECT')   INTO v_exch_read_alias;

  IF NOT v_exch_write_rev THEN
    RAISE EXCEPTION 'TEST FAIL: svc_exchange missing INSERT on exchange.revocations';
  END IF;
  IF NOT v_exch_read_alias THEN
    RAISE EXCEPTION 'TEST FAIL: svc_exchange missing SELECT on exchange.alias_map';
  END IF;

  RAISE NOTICE 'TEST PASS (A5): schema privilege boundaries strictly enforced for revocations and aliases';
END;
$$;

-- Cleanup
DO $$ BEGIN PERFORM pg_temp.p7_cleanup(); END; $$;
DROP FUNCTION IF EXISTS pg_temp.p7_cleanup();

DO $$ BEGIN
  RAISE NOTICE '=== Phase 7 Exchange & DPT Revocations: ALL TESTS PASSED ===';
END; $$;

ROLLBACK;
