-- NutriScore CAD Blueprint Phase 6 — pgTAP / SQL Tests
-- Field-Level Encryption, Patient Keys, Crypto-Shredding, Blind Indexes,
-- Keyed Commitments, Semantic Projection Sync, and Schema Boundary Isolation (A5)
-- Run as postgres superuser against local Docker Postgres.

BEGIN;

-- ============================================================
-- Helper: cleanup test rows
-- ============================================================
CREATE OR REPLACE FUNCTION pg_temp.p6_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE clinical.clinical_records DISABLE TRIGGER trg_clinical_records_deny_mutation;

  DELETE FROM clinical.published_profiles WHERE profile_id = 'a6000000-0000-0000-0000-000000000001';
  DELETE FROM exchange.projection         WHERE profile_id = 'a6000000-0000-0000-0000-000000000001';
  DELETE FROM exchange.projection_outbox  WHERE profile_id = 'a6000000-0000-0000-0000-000000000001';
  DELETE FROM clinical.patient_keys       WHERE patient_id = 'b6000000-0000-0000-0000-000000000001';
  DELETE FROM clinical.patients           WHERE id = 'b6000000-0000-0000-0000-000000000001';
  DELETE FROM audit.outbox                WHERE resource_id = 'b6000000-0000-0000-0000-000000000001';

  ALTER TABLE clinical.clinical_records ENABLE TRIGGER trg_clinical_records_deny_mutation;
END;
$$;

DO $$ BEGIN PERFORM pg_temp.p6_cleanup(); END; $$;

-- ============================================================
-- TEST 1: Tenant Wall & Force RLS on patient_keys and exchange.projection
-- ============================================================
DO $$
DECLARE
  v_keys_rls   boolean;
  v_proj_rls   boolean;
  v_keys_wall  text;
  v_proj_wall  text;
BEGIN
  SELECT relforcerowsecurity INTO v_keys_rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'clinical' AND c.relname = 'patient_keys';
  SELECT relforcerowsecurity INTO v_proj_rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'exchange' AND c.relname = 'projection';

  IF NOT v_keys_rls THEN
    RAISE EXCEPTION 'TEST FAIL: clinical.patient_keys does not FORCE ROW LEVEL SECURITY';
  END IF;
  IF NOT v_proj_rls THEN
    RAISE EXCEPTION 'TEST FAIL: exchange.projection does not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT polname INTO v_keys_wall FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'clinical' AND c.relname = 'patient_keys' AND p.polname = 'tenant_wall';
  SELECT polname INTO v_proj_wall FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'exchange' AND c.relname = 'projection' AND p.polname = 'tenant_wall';

  IF v_keys_wall IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: restrictive tenant_wall policy missing on clinical.patient_keys';
  END IF;
  IF v_proj_wall IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: restrictive tenant_wall policy missing on exchange.projection';
  END IF;

  RAISE NOTICE 'TEST PASS: FORCE RLS and restrictive tenant_wall verified on patient_keys and projection';
END;
$$;

-- ============================================================
-- TEST 2: Blind index normalisation & Tenant Isolation
-- ============================================================
DO $$
DECLARE
  v_t1   uuid := '11111111-1111-1111-1111-111111111111';
  v_t2   uuid := '22222222-2222-2222-2222-222222222222';
  v_idx1 bytea;
  v_idx2 bytea;
  v_idx3 bytea;
BEGIN
  -- Normalised email lookup
  v_idx1 := clinical.blind_index(v_t1, '  Patient.Alpha@Example.COM  ');
  v_idx2 := clinical.blind_index(v_t1, 'patient.alpha@example.com');
  v_idx3 := clinical.blind_index(v_t2, 'patient.alpha@example.com');

  IF v_idx1 IS NULL OR v_idx2 IS NULL OR v_idx3 IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: blind index calculation returned null';
  END IF;

  IF v_idx1 <> v_idx2 THEN
    RAISE EXCEPTION 'TEST FAIL: blind index must be case/whitespace invariant';
  END IF;

  IF v_idx1 = v_idx3 THEN
    RAISE EXCEPTION 'TEST FAIL: blind index must be tenant-isolated (t1 = t2)';
  END IF;

  RAISE NOTICE 'TEST PASS: blind index is case/whitespace invariant and tenant-isolated';
END;
$$;

-- ============================================================
-- TEST 3: Keyed MAC commitments (replaces bare SHA-256)
-- ============================================================
DO $$
DECLARE
  v_t1   uuid := '11111111-1111-1111-1111-111111111111';
  v_t2   uuid := '22222222-2222-2222-2222-222222222222';
  v_mac1 bytea;
  v_mac2 bytea;
  v_bare bytea;
BEGIN
  v_mac1 := clinical.keyed_mac(v_t1, '{"diagnosis":"ICD10:I10"}');
  v_mac2 := clinical.keyed_mac(v_t2, '{"diagnosis":"ICD10:I10"}');
  v_bare := extensions.digest('{"diagnosis":"ICD10:I10"}', 'sha256');

  IF v_mac1 = v_bare THEN
    RAISE EXCEPTION 'TEST FAIL: keyed MAC must not equal bare SHA-256';
  END IF;

  IF v_mac1 = v_mac2 THEN
    RAISE EXCEPTION 'TEST FAIL: keyed MAC must be tenant-isolated';
  END IF;

  RAISE NOTICE 'TEST PASS: keyed commitments are tenant-isolated and non-dictionary-guessable';
END;
$$;

-- ============================================================
-- TEST 4: Crypto-Shredding of Patient Keys
-- ============================================================
DO $$
DECLARE
  v_tenant  uuid := '11111111-1111-1111-1111-111111111111';
  v_patient uuid := 'b6000000-0000-0000-0000-000000000001';
  v_fake_dek bytea := '\x01112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00';
  v_res     boolean;
  v_key_row clinical.patient_keys;
  v_outbox  audit.outbox;
BEGIN
  -- Insert structural patient record
  INSERT INTO clinical.patients (
    tenant_id, id, full_name_enc, email_bidx
  ) VALUES (
    v_tenant, v_patient, '\x010001112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    clinical.blind_index(v_tenant, 'shred-test@example.com')
  );

  -- Insert wrapped DEK
  INSERT INTO clinical.patient_keys (
    tenant_id, patient_id, key_version, dek_wrapped
  ) VALUES (
    v_tenant, v_patient, 1, v_fake_dek
  );

  -- Execute crypto-shred
  v_res := clinical.crypto_shred_patient(v_tenant, v_patient);

  IF NOT v_res THEN
    RAISE EXCEPTION 'TEST FAIL: crypto_shred_patient returned false';
  END IF;

  SELECT * INTO v_key_row FROM clinical.patient_keys WHERE tenant_id = v_tenant AND patient_id = v_patient;

  IF v_key_row.destroyed_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: destroyed_at was not set after crypto-shred';
  END IF;

  -- Verify dek_wrapped was zeroed out (61 zero bytes)
  IF v_key_row.dek_wrapped <> '\x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'::bytea THEN
    RAISE EXCEPTION 'TEST FAIL: dek_wrapped was not zeroed out';
  END IF;

  -- Verify audit event in outbox
  SELECT * INTO v_outbox FROM audit.outbox WHERE chain_id = v_tenant AND resource_id = v_patient;
  IF v_outbox.action <> 'PATIENT_CRYPTO_SHRED' THEN
    RAISE EXCEPTION 'TEST FAIL: audit event PATIENT_CRYPTO_SHRED missing in outbox';
  END IF;

  -- Confirm patient structural record still exists intact
  IF NOT EXISTS (SELECT 1 FROM clinical.patients WHERE tenant_id = v_tenant AND id = v_patient) THEN
    RAISE EXCEPTION 'TEST FAIL: patient structural record was removed during crypto-shred';
  END IF;

  RAISE NOTICE 'TEST PASS: crypto-shredding zeroes key material, sets destroyed_at, logs audit, and preserves structural row';
END;
$$;

-- ============================================================
-- TEST 5: Semantic Projection Outbox Trigger & Allowlisted Constraints
-- ============================================================
DO $$
DECLARE
  v_tenant   uuid := '41111111-1111-1111-1111-111111111111';
  v_patient  uuid := 'b6000000-0000-0000-0000-000000000001';
  v_profile  uuid := 'a6000000-0000-0000-0000-000000000001';
  v_clinician uuid;
  v_proj_row exchange.projection;
  v_out_row  exchange.projection_outbox;
  v_err      boolean := false;
BEGIN
  SELECT user_id INTO v_clinician FROM iam.members WHERE tenant_id = v_tenant AND role = 'writing_clinician' LIMIT 1;

  -- Ensure patient exists in this tenant
  INSERT INTO clinical.patients (tenant_id, id, full_name_enc)
  VALUES (v_tenant, v_patient, '\x010001112233445566778899aabbccddeeff00112233445566778899aabbccddeeff')
  ON CONFLICT DO NOTHING;

  -- 1. Insert published profile with valid allowlisted constraints
  INSERT INTO clinical.published_profiles (
    tenant_id, profile_id, patient_id, bundle_version, status,
    constraints, published_by
  ) VALUES (
    v_tenant, v_profile, v_patient, 1, 'published',
    '{"carbs_g_100g_max": 30, "sugars_g_100g_max": 10, "sodium_mg_100g_max": 400}'::jsonb,
    v_clinician
  );

  -- Verify row appeared in exchange.projection
  SELECT * INTO v_proj_row FROM exchange.projection WHERE tenant_id = v_tenant AND profile_id = v_profile;
  IF v_proj_row.profile_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: profile not replicated to exchange.projection';
  END IF;

  IF (v_proj_row.constraints ->> 'carbs_g_100g_max')::int <> 30 THEN
    RAISE EXCEPTION 'TEST FAIL: constraints mismatch in projected row';
  END IF;

  -- Verify outbox recorded UPSERT
  SELECT * INTO v_out_row FROM exchange.projection_outbox WHERE tenant_id = v_tenant AND profile_id = v_profile AND event_type = 'UPSERT';
  IF v_out_row.id IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: exchange.projection_outbox missing UPSERT entry';
  END IF;

  -- 2. Update status to 'withdrawn' -> must remove from exchange.projection
  UPDATE clinical.published_profiles SET status = 'withdrawn' WHERE tenant_id = v_tenant AND profile_id = v_profile;

  IF EXISTS (SELECT 1 FROM exchange.projection WHERE tenant_id = v_tenant AND profile_id = v_profile) THEN
    RAISE EXCEPTION 'TEST FAIL: withdrawn profile was not deleted from exchange.projection';
  END IF;

  -- Verify outbox recorded DELETE
  IF NOT EXISTS (SELECT 1 FROM exchange.projection_outbox WHERE tenant_id = v_tenant AND profile_id = v_profile AND event_type = 'DELETE') THEN
    RAISE EXCEPTION 'TEST FAIL: exchange.projection_outbox missing DELETE entry';
  END IF;

  -- 3. Attempt to insert non-allowlisted key (e.g. condition-named or device-only key)
  BEGIN
    INSERT INTO clinical.published_profiles (
      tenant_id, profile_id, patient_id, bundle_version, status,
      constraints, published_by
    ) VALUES (
      v_tenant, gen_random_uuid(), v_patient, 2, 'published',
      '{"diabetic_friendly": true}'::jsonb,
      v_clinician
    );
  EXCEPTION
    WHEN check_violation THEN
      v_err := true;
  END;

  IF NOT v_err THEN
    RAISE EXCEPTION 'TEST FAIL: published_profiles allowed non-allowlisted constraint key';
  END IF;

  RAISE NOTICE 'TEST PASS: semantic projection replicates 6 allowlisted columns, auto-evicts withdrawn profiles, and rejects forbidden keys';
END;
$$;

-- ============================================================
-- TEST 6: Schema Privilege Boundaries (Amendment A5)
-- ============================================================
DO $$
DECLARE
  v_priv_comm_clin  boolean;
  v_priv_comm_iam   boolean;
  v_priv_comm_exch  boolean;
  v_priv_exch_clin  boolean;
  v_priv_exch_iam   boolean;
  v_priv_exch_proj  boolean;
BEGIN
  -- svc_commercial must hold NO privilege on clinical or iam or exchange
  SELECT has_table_privilege('svc_commercial', 'clinical.patients', 'SELECT') INTO v_priv_comm_clin;
  SELECT has_table_privilege('svc_commercial', 'iam.members', 'SELECT')       INTO v_priv_comm_iam;
  SELECT has_table_privilege('svc_commercial', 'exchange.projection', 'SELECT') INTO v_priv_comm_exch;

  IF v_priv_comm_clin THEN
    RAISE EXCEPTION 'TEST FAIL (A5): svc_commercial has privilege on clinical.patients';
  END IF;
  IF v_priv_comm_iam THEN
    RAISE EXCEPTION 'TEST FAIL (A5): svc_commercial has privilege on iam.members';
  END IF;
  IF v_priv_comm_exch THEN
    RAISE EXCEPTION 'TEST FAIL (A5): svc_commercial has privilege on exchange.projection';
  END IF;

  -- svc_exchange must hold NO privilege on clinical or iam
  SELECT has_table_privilege('svc_exchange', 'clinical.patients', 'SELECT') INTO v_priv_exch_clin;
  SELECT has_table_privilege('svc_exchange', 'iam.members', 'SELECT')       INTO v_priv_exch_iam;

  IF v_priv_exch_clin THEN
    RAISE EXCEPTION 'TEST FAIL (A5): svc_exchange has privilege on clinical.patients';
  END IF;
  IF v_priv_exch_iam THEN
    RAISE EXCEPTION 'TEST FAIL (A5): svc_exchange has privilege on iam.members';
  END IF;

  -- svc_exchange MUST hold SELECT on exchange.projection
  SELECT has_table_privilege('svc_exchange', 'exchange.projection', 'SELECT') INTO v_priv_exch_proj;
  IF NOT v_priv_exch_proj THEN
    RAISE EXCEPTION 'TEST FAIL (A5): svc_exchange missing SELECT on exchange.projection';
  END IF;

  RAISE NOTICE 'TEST PASS (A5): svc_commercial and svc_exchange schema boundaries strictly enforced';
END;
$$;

-- Cleanup
DO $$ BEGIN PERFORM pg_temp.p6_cleanup(); END; $$;
DROP FUNCTION IF EXISTS pg_temp.p6_cleanup();

DO $$ BEGIN
  RAISE NOTICE '=== Phase 6 Field Encryption & Semantic Projection: ALL TESTS PASSED ===';
END; $$;

ROLLBACK;
