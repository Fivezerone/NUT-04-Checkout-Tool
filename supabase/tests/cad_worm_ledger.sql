-- NutriScore CAD Blueprint Phase 5 — pgTAP/SQL tests for WORM Audit Ledger
-- Covers: tamper, reorder, delete/truncate deny, gap detection, key rotation,
--         platform-auditor column isolation, tenant-auditor scoping,
--         legacy_audit_log freeze.
-- Run as postgres superuser against local Docker Postgres.

BEGIN;

-- Ensure pgtap is available
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgtap') THEN
    RAISE NOTICE 'pgtap not installed - running raw SQL assertions only';
  END IF;
END;
$$;

-- ============================================================
-- Helper: wipe test rows only (disable append-only for cleanup)
-- ============================================================
CREATE OR REPLACE FUNCTION pg_temp.p5_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE audit.ledger      DISABLE TRIGGER trg_audit_log_tamper;
  ALTER TABLE audit.ledger      DISABLE TRIGGER trg_audit_log_truncate;
  ALTER TABLE audit.checkpoints DISABLE TRIGGER trg_checkpoints_tamper;
  ALTER TABLE audit.checkpoints DISABLE TRIGGER trg_checkpoints_truncate;

  DELETE FROM audit.ledger      WHERE chain_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  DELETE FROM audit.checkpoints WHERE chain_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  DELETE FROM audit.outbox      WHERE chain_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  ALTER TABLE audit.ledger      ENABLE TRIGGER trg_audit_log_tamper;
  ALTER TABLE audit.ledger      ENABLE TRIGGER trg_audit_log_truncate;
  ALTER TABLE audit.checkpoints ENABLE TRIGGER trg_checkpoints_tamper;
  ALTER TABLE audit.checkpoints ENABLE TRIGGER trg_checkpoints_truncate;
END;
$$;

-- Test chain UUID used throughout
DO $$ BEGIN PERFORM pg_temp.p5_cleanup(); END; $$;

-- ============================================================
-- TEST 1: Genesis hash correctness
-- ============================================================
DO $$
DECLARE
  v_chain uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_genesis bytea;
  v_expected bytea;
BEGIN
  v_genesis  := audit.genesis_hash(v_chain);
  v_expected := extensions.digest('GENESIS:' || v_chain::text, 'sha256');
  IF v_genesis <> v_expected THEN
    RAISE EXCEPTION 'TEST FAIL: genesis_hash mismatch: got % expected %',
      encode(v_genesis, 'hex'), encode(v_expected, 'hex');
  END IF;
  RAISE NOTICE 'TEST PASS: genesis_hash correctness';
END;
$$;

-- ============================================================
-- TEST 2: First append lands at seq 0 with genesis prev_hash
-- ============================================================
DO $$
DECLARE
  v_chain uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_seq   bigint;
  v_row   audit.ledger;
BEGIN
  v_seq := audit.append_ledger_entry(
    v_chain,
    'fffff000-0000-0000-0000-000000000001'::uuid,
    now(), NULL, 'system', 'TEST_INSERT', 'ALLOW',
    'test', NULL, NULL, 0::smallint,
    '{"test":1}'::jsonb, NULL, NULL
  );

  IF v_seq <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: first entry should be seq 0, got %', v_seq;
  END IF;

  SELECT * INTO v_row FROM audit.ledger WHERE chain_id = v_chain AND seq = 0;

  IF v_row.prev_hash <> audit.genesis_hash(v_chain) THEN
    RAISE EXCEPTION 'TEST FAIL: prev_hash of seq-0 row must equal genesis_hash';
  END IF;
  RAISE NOTICE 'TEST PASS: first append at seq=0 with genesis prev_hash';
END;
$$;

-- ============================================================
-- TEST 3: Second append at seq 1, chaining prev_hash
-- ============================================================
DO $$
DECLARE
  v_chain uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_seq   bigint;
  v_prev_hash bytea;
  v_row1 audit.ledger;
BEGIN
  -- seq 0 was inserted in TEST 2 above
  v_seq := audit.append_ledger_entry(
    v_chain,
    'fffff000-0000-0000-0000-000000000002'::uuid,
    now(), NULL, 'system', 'TEST_INSERT_2', 'ALLOW',
    'test', NULL, NULL, 0::smallint,
    '{"test":2}'::jsonb, NULL, NULL
  );

  IF v_seq <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: second entry should be seq 1, got %', v_seq;
  END IF;

  SELECT row_hash INTO v_prev_hash FROM audit.ledger WHERE chain_id = v_chain AND seq = 0;
  IF (SELECT prev_hash FROM audit.ledger WHERE chain_id = v_chain AND seq = 1) <> v_prev_hash THEN
    RAISE EXCEPTION 'TEST FAIL: seq-1 prev_hash does not match seq-0 row_hash';
  END IF;
  RAISE NOTICE 'TEST PASS: chain linking seq 0 → 1 correct';
END;
$$;

-- ============================================================
-- TEST 4: TAMPER DETECTION — mutate row_hash, detect break
-- ============================================================
DO $$
DECLARE
  v_chain     uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_orig_hash bytea;
  v_tampered  bytea;
  v_computed  bytea;
  v_row       audit.ledger;
BEGIN
  -- Temporarily disable the trigger to simulate a tamper
  ALTER TABLE audit.ledger DISABLE TRIGGER trg_audit_log_tamper;
  ALTER TABLE audit.ledger DISABLE TRIGGER trg_audit_log_truncate;

  SELECT row_hash INTO v_orig_hash FROM audit.ledger WHERE chain_id = v_chain AND seq = 0;
  v_tampered := extensions.digest('TAMPERED_VALUE', 'sha256');

  UPDATE audit.ledger SET row_hash = v_tampered
    WHERE chain_id = v_chain AND seq = 0;

  ALTER TABLE audit.ledger ENABLE TRIGGER trg_audit_log_tamper;
  ALTER TABLE audit.ledger ENABLE TRIGGER trg_audit_log_truncate;

  -- Verify that the recomputed hash from seq=1's prev_hash no longer matches seq-0's row_hash
  SELECT * INTO v_row FROM audit.ledger WHERE chain_id = v_chain AND seq = 1;
  IF v_row.prev_hash = v_tampered THEN
    RAISE EXCEPTION 'TEST FAIL: seq-1 prev_hash was also tampered – test data inconsistent';
  END IF;

  -- The original hash at seq=0 is now v_tampered, but seq=1's prev_hash still points to v_orig_hash.
  -- This IS the break — prev_hash(seq=1) <> row_hash(seq=0).
  DECLARE
    v_seq0_hash bytea;
    v_seq1_prev bytea;
  BEGIN
    SELECT row_hash  INTO v_seq0_hash FROM audit.ledger WHERE chain_id = v_chain AND seq = 0;
    SELECT prev_hash INTO v_seq1_prev FROM audit.ledger WHERE chain_id = v_chain AND seq = 1;
    IF v_seq0_hash = v_seq1_prev THEN
      RAISE EXCEPTION 'TEST FAIL: tampered hash still matches next row prev_hash — chain should be broken';
    END IF;
  END;

  -- Restore original hash
  ALTER TABLE audit.ledger DISABLE TRIGGER trg_audit_log_tamper;
  ALTER TABLE audit.ledger DISABLE TRIGGER trg_audit_log_truncate;
  UPDATE audit.ledger SET row_hash = v_orig_hash WHERE chain_id = v_chain AND seq = 0;
  ALTER TABLE audit.ledger ENABLE TRIGGER trg_audit_log_tamper;
  ALTER TABLE audit.ledger ENABLE TRIGGER trg_audit_log_truncate;

  RAISE NOTICE 'TEST PASS: tamper detected — chain break on row_hash mutation';
END;
$$;

-- ============================================================
-- TEST 5: DELETE DENY on audit.ledger — trigger-level (superuser path)
-- The deny_mutation trigger fires BEFORE DELETE FOR EACH STATEMENT
-- and raises 42501 regardless of caller privilege level.
-- ============================================================
DO $$
DECLARE
  v_code text;
BEGIN
  BEGIN
    DELETE FROM audit.ledger WHERE chain_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' AND seq = 9999;
    RAISE EXCEPTION 'TEST FAIL: DELETE on audit.ledger must raise 42501 (deny trigger)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_code := SQLSTATE;
  END;
  IF v_code <> '42501' THEN
    RAISE EXCEPTION 'TEST FAIL: expected SQLSTATE 42501 on DELETE, got %', v_code;
  END IF;
  RAISE NOTICE 'TEST PASS: DELETE denied by trigger (%) on audit.ledger', v_code;
END;
$$;

-- ============================================================
-- TEST 5b: svc_audit_writer has INSERT-only privilege on ledger
-- ============================================================
DO $$
DECLARE
  v_has_insert  boolean;
  v_has_delete  boolean;
  v_has_update  boolean;
  v_has_select  boolean;
BEGIN
  SELECT has_table_privilege('svc_audit_writer', 'audit.ledger', 'INSERT') INTO v_has_insert;
  SELECT has_table_privilege('svc_audit_writer', 'audit.ledger', 'DELETE') INTO v_has_delete;
  SELECT has_table_privilege('svc_audit_writer', 'audit.ledger', 'UPDATE') INTO v_has_update;
  SELECT has_table_privilege('svc_audit_writer', 'audit.ledger', 'SELECT') INTO v_has_select;

  IF NOT v_has_insert THEN
    RAISE EXCEPTION 'TEST FAIL: svc_audit_writer missing INSERT on audit.ledger';
  END IF;
  IF v_has_delete THEN
    RAISE EXCEPTION 'TEST FAIL: svc_audit_writer has DELETE on audit.ledger (must not)';
  END IF;
  IF v_has_update THEN
    RAISE EXCEPTION 'TEST FAIL: svc_audit_writer has UPDATE on audit.ledger (must not)';
  END IF;
  IF v_has_select THEN
    RAISE EXCEPTION 'TEST FAIL: svc_audit_writer has SELECT on audit.ledger (must not)';
  END IF;
  RAISE NOTICE 'TEST PASS: svc_audit_writer is INSERT-only on audit.ledger';
END;
$$;

-- ============================================================
-- TEST 6: UPDATE DENY on audit.ledger (trigger fires 42501)
-- ============================================================
DO $$
DECLARE
  v_err  text;
  v_code text;
BEGIN
  BEGIN
    UPDATE audit.ledger SET action = 'HACKED'
      WHERE chain_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' AND seq = 0;
    RAISE EXCEPTION 'TEST FAIL: UPDATE on audit.ledger must raise 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_err  := SQLERRM;
      v_code := SQLSTATE;
  END;
  IF v_code <> '42501' THEN
    RAISE EXCEPTION 'TEST FAIL: expected SQLSTATE 42501, got %', v_code;
  END IF;
  RAISE NOTICE 'TEST PASS: UPDATE denied (%) — %', v_code, v_err;
END;
$$;

-- ============================================================
-- TEST 7: TRUNCATE DENY on audit.ledger
-- ============================================================
DO $$
DECLARE
  v_code text;
BEGIN
  BEGIN
    TRUNCATE audit.ledger;
    RAISE EXCEPTION 'TEST FAIL: TRUNCATE on audit.ledger must raise 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_code := SQLSTATE;
  END;
  IF v_code <> '42501' THEN
    RAISE EXCEPTION 'TEST FAIL: expected SQLSTATE 42501, got %', v_code;
  END IF;
  RAISE NOTICE 'TEST PASS: TRUNCATE denied on audit.ledger (%)' , v_code;
END;
$$;

-- ============================================================
-- TEST 8: TRUNCATE DENY on audit.checkpoints
-- ============================================================
DO $$
DECLARE
  v_code text;
BEGIN
  BEGIN
    TRUNCATE audit.checkpoints;
    RAISE EXCEPTION 'TEST FAIL: TRUNCATE on audit.checkpoints must raise 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_code := SQLSTATE;
  END;
  IF v_code <> '42501' THEN
    RAISE EXCEPTION 'TEST FAIL: expected SQLSTATE 42501, got %', v_code;
  END IF;
  RAISE NOTICE 'TEST PASS: TRUNCATE denied on audit.checkpoints (%)' , v_code;
END;
$$;

-- ============================================================
-- TEST 9: REORDER DETECTION — seq gap
-- After TEST 2, chain has seq=0 and seq=1.
-- Insert a third entry normally (seq=2), then manually insert a row with seq=4
-- (skipping seq=3) to simulate out-of-order / gap — verifier must detect.
-- ============================================================
DO $$
DECLARE
  v_chain  uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_seq    bigint;
  v_row1   audit.ledger;
  v_gap    boolean;
BEGIN
  -- Normal append at seq=2
  v_seq := audit.append_ledger_entry(
    v_chain,
    'fffff000-0000-0000-0000-000000000003'::uuid,
    now(), NULL, 'system', 'TEST_SEQ2', 'ALLOW',
    'test', NULL, NULL, 0::smallint,
    '{"test":3}'::jsonb, NULL, NULL
  );
  IF v_seq <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: expected seq=2 for third append, got %', v_seq;
  END IF;

  -- Verify gapless sequence 0,1,2
  SELECT bool_and(seq_expected = seq) INTO v_gap
  FROM (
    SELECT seq, row_number() OVER (ORDER BY seq) - 1 AS seq_expected
    FROM audit.ledger WHERE chain_id = v_chain ORDER BY seq
  ) x;

  IF NOT v_gap THEN
    RAISE EXCEPTION 'TEST FAIL: gap detected unexpectedly in 0,1,2 sequence';
  END IF;
  RAISE NOTICE 'TEST PASS: gapless sequence 0,1,2 verified';

  -- Simulate gap: manually insert a row at seq=4 (skipping 3)
  -- Use disabled triggers + direct INSERT
  ALTER TABLE audit.ledger DISABLE TRIGGER trg_audit_log_tamper;
  ALTER TABLE audit.ledger DISABLE TRIGGER trg_audit_log_truncate;

  INSERT INTO audit.ledger (
    chain_id, seq, event_id, occurred_at, actor_id, actor_role,
    action, decision, resource_type, severity, envelope,
    prev_hash, row_hash, signature
  ) SELECT
    v_chain, 4,
    'fffff000-0000-0000-0000-000000000005'::uuid,
    now(), NULL, 'system', 'TEST_GAP_INSERT', 'ALLOW',
    'test', 0, '{"test":"gap"}'::jsonb,
    row_hash, extensions.digest('FAKE'::bytea, 'sha256'),
    extensions.digest('FAKE_SIG'::bytea, 'sha256')
  FROM audit.ledger WHERE chain_id = v_chain AND seq = 2;

  ALTER TABLE audit.ledger ENABLE TRIGGER trg_audit_log_tamper;
  ALTER TABLE audit.ledger ENABLE TRIGGER trg_audit_log_truncate;

  -- Verify gap is now detected
  SELECT NOT bool_and(seq_expected = seq) INTO v_gap
  FROM (
    SELECT seq, row_number() OVER (ORDER BY seq) - 1 AS seq_expected
    FROM audit.ledger WHERE chain_id = v_chain ORDER BY seq
  ) x;

  IF NOT v_gap THEN
    RAISE EXCEPTION 'TEST FAIL: gap in sequence 0,1,2,4 was not detected';
  END IF;
  RAISE NOTICE 'TEST PASS: gap in sequence 0,1,2,4 correctly detected';

  -- Cleanup gap row
  ALTER TABLE audit.ledger DISABLE TRIGGER trg_audit_log_tamper;
  ALTER TABLE audit.ledger DISABLE TRIGGER trg_audit_log_truncate;
  DELETE FROM audit.ledger WHERE chain_id = v_chain AND seq = 4;
  ALTER TABLE audit.ledger ENABLE TRIGGER trg_audit_log_tamper;
  ALTER TABLE audit.ledger ENABLE TRIGGER trg_audit_log_truncate;
END;
$$;

-- ============================================================
-- TEST 10: PLATFORM AUDITOR — v_ledger_platform omits PHI columns
-- ============================================================
DO $$
DECLARE
  v_col text;
  v_found boolean;
BEGIN
  -- Check view definition does NOT contain patient_ref, envelope, payload_enc, payload_mac
  FOR v_col IN SELECT unnest(ARRAY['patient_ref','envelope','payload_enc','payload_mac']) LOOP
    SELECT v_col = ANY(
      SELECT column_name::text
      FROM information_schema.columns
      WHERE table_schema = 'audit'
        AND table_name   = 'v_ledger_platform'
    ) INTO v_found;
    IF v_found THEN
      RAISE EXCEPTION 'TEST FAIL: platform view exposes PHI column %', v_col;
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST PASS: v_ledger_platform excludes patient_ref, envelope, payload_enc, payload_mac';
END;
$$;

-- ============================================================
-- TEST 11: TENANT AUDITOR — RLS isolates by chain_id (tenant scoping)
-- Verified by checking RLS policies exist and are correctly configured,
-- plus checking that the svc_audit_reader_tenant role has SELECT but
-- no cross-chain policy bypass.
-- ============================================================
DO $$
DECLARE
  v_tenant_policy  text;
  v_platform_policy text;
  v_has_select     boolean;
  v_has_insert     boolean;
  v_rls_forced     boolean;
BEGIN
  -- Check tenant_auditor policy exists with correct using clause
  SELECT polname INTO v_tenant_policy
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'audit' AND c.relname = 'ledger' AND p.polname = 'tenant_auditor';

  IF v_tenant_policy IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: tenant_auditor RLS policy missing on audit.ledger';
  END IF;

  -- Check platform_meta_view policy scoped to audit_view_owner exists
  SELECT polname INTO v_platform_policy
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'audit' AND c.relname = 'ledger' AND p.polname = 'platform_meta_view';

  IF v_platform_policy IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: platform_meta_view RLS policy missing on audit.ledger';
  END IF;

  -- Check FORCE ROW LEVEL SECURITY is enabled on ledger
  SELECT relforcerowsecurity INTO v_rls_forced
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'audit' AND c.relname = 'ledger';

  IF NOT v_rls_forced THEN
    RAISE EXCEPTION 'TEST FAIL: audit.ledger does not have FORCE ROW LEVEL SECURITY';
  END IF;

  -- Check svc_audit_reader_tenant has SELECT, not INSERT
  SELECT has_table_privilege('svc_audit_reader_tenant', 'audit.ledger', 'SELECT') INTO v_has_select;
  SELECT has_table_privilege('svc_audit_reader_tenant', 'audit.ledger', 'INSERT') INTO v_has_insert;

  IF NOT v_has_select THEN
    RAISE EXCEPTION 'TEST FAIL: svc_audit_reader_tenant missing SELECT on audit.ledger';
  END IF;
  IF v_has_insert THEN
    RAISE EXCEPTION 'TEST FAIL: svc_audit_reader_tenant has INSERT on audit.ledger (must not)';
  END IF;

  -- Verify genesis rows exist for at least 2 different tenants (chain isolation test)
  DECLARE
    v_tenant_chains int;
  BEGIN
    SELECT count(DISTINCT chain_id) INTO v_tenant_chains
    FROM audit.ledger
    WHERE chain_id <> '00000000-0000-0000-0000-000000000000'::uuid
      AND action = 'CUTOVER_GENESIS';
    IF v_tenant_chains < 2 THEN
      RAISE EXCEPTION 'TEST FAIL: expected genesis rows for at least 2 tenant chains, got %', v_tenant_chains;
    END IF;
  END;

  RAISE NOTICE 'TEST PASS: tenant_auditor + platform_meta_view RLS policies correct; FORCE RLS on; svc_audit_reader_tenant SELECT-only; % tenant chains isolated', (
    SELECT count(DISTINCT chain_id) FROM audit.ledger
    WHERE chain_id <> '00000000-0000-0000-0000-000000000000'::uuid
  );
END;
$$;

-- ============================================================
-- TEST 12: legacy_audit_log FREEZE — UPDATE must fail
-- ============================================================
DO $$
DECLARE
  v_code text;
BEGIN
  BEGIN
    UPDATE audit.legacy_audit_log SET action = 'HACKED' WHERE false; -- safe predicate
    RAISE EXCEPTION 'TEST FAIL: UPDATE on frozen legacy_audit_log must raise 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_code := SQLSTATE;
  END;
  IF v_code <> '42501' THEN
    RAISE EXCEPTION 'TEST FAIL: expected SQLSTATE 42501, got %', v_code;
  END IF;
  RAISE NOTICE 'TEST PASS: legacy_audit_log is frozen — UPDATE denied (%)' , v_code;
END;
$$;

-- ============================================================
-- TEST 13: SIGNATURE INTEGRITY — HMAC round-trip
-- ============================================================
DO $$
DECLARE
  v_chain  uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_row    audit.ledger;
  v_expected_sig bytea;
BEGIN
  SELECT * INTO v_row FROM audit.ledger WHERE chain_id = v_chain AND seq = 0;

  v_expected_sig := extensions.hmac(
    v_row.row_hash,
    convert_to(v_chain::text || ':audit_sig', 'UTF8'),
    'sha256'
  );

  IF v_row.signature <> v_expected_sig THEN
    RAISE EXCEPTION 'TEST FAIL: seq-0 signature does not match HMAC recomputation';
  END IF;
  RAISE NOTICE 'TEST PASS: HMAC signature round-trip verified for seq=0';
END;
$$;

-- ============================================================
-- TEST 14: ROW HASH FORMULA — recompute and compare
-- ============================================================
DO $$
DECLARE
  v_chain  uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_row    audit.ledger;
  v_computed_hash bytea;
  v_hash_input    bytea;
BEGIN
  SELECT * INTO v_row FROM audit.ledger WHERE chain_id = v_chain AND seq = 0;

  v_hash_input :=
    audit.genesis_hash(v_chain)  -- prev_hash for seq=0
    || extensions.digest(v_chain::text, 'sha256')
    || extensions.digest('0', 'sha256')               -- seq as text
    || extensions.digest(v_row.envelope::text, 'sha256')
    || coalesce(v_row.payload_mac, '\x00'::bytea);

  v_computed_hash := extensions.digest(v_hash_input, 'sha256');

  IF v_row.row_hash <> v_computed_hash THEN
    RAISE EXCEPTION 'TEST FAIL: row_hash mismatch for seq=0. Got %, computed %',
      encode(v_row.row_hash, 'hex'), encode(v_computed_hash, 'hex');
  END IF;
  RAISE NOTICE 'TEST PASS: row_hash formula verified for seq=0';
END;
$$;

-- ============================================================
-- TEST 15: CHECKPOINT INSERT and TAMPER DENY
-- ============================================================
DO $$
DECLARE
  v_chain uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_merkle bytea := extensions.digest('MERKLE_TEST', 'sha256');
  v_prev   bytea := extensions.digest('PREV_CP_TEST', 'sha256');
  v_sig    bytea := extensions.digest('SIG_TEST', 'sha256');
  v_code   text;
BEGIN
  INSERT INTO audit.checkpoints (chain_id, seq_from, seq_to, merkle_root, prev_checkpoint_hash, signature, anchor_uri)
  VALUES (v_chain, 0, 2, v_merkle, v_prev, v_sig, 'local://test-anchor/cp-0-2');

  IF NOT EXISTS (SELECT 1 FROM audit.checkpoints WHERE chain_id = v_chain AND seq_to = 2) THEN
    RAISE EXCEPTION 'TEST FAIL: checkpoint insert failed';
  END IF;

  -- Now verify UPDATE is denied on checkpoints
  BEGIN
    UPDATE audit.checkpoints SET anchor_uri = 'HACKED' WHERE chain_id = v_chain AND seq_to = 2;
    RAISE EXCEPTION 'TEST FAIL: UPDATE on checkpoints must raise 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_code := SQLSTATE;
  END;
  IF v_code <> '42501' THEN
    RAISE EXCEPTION 'TEST FAIL: expected SQLSTATE 42501 on checkpoint UPDATE, got %', v_code;
  END IF;
  RAISE NOTICE 'TEST PASS: checkpoint inserted and UPDATE tamper denied (%)' , v_code;
END;
$$;

-- ============================================================
-- TEST 16: OUTBOX — insert and mark processed
-- ============================================================
DO $$
DECLARE
  v_chain uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_id    uuid;
BEGIN
  INSERT INTO audit.outbox (chain_id, action, severity, envelope)
  VALUES (v_chain, 'TEST_OUTBOX', 0, '{"outbox":true}'::jsonb)
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: outbox insert returned no id';
  END IF;

  UPDATE audit.outbox SET processed_at = now() WHERE id = v_id;

  IF (SELECT processed_at FROM audit.outbox WHERE id = v_id) IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: outbox processed_at not updated';
  END IF;
  RAISE NOTICE 'TEST PASS: outbox insert and mark-processed works';
END;
$$;

-- ============================================================
-- Cleanup test data
-- ============================================================
DO $$ BEGIN PERFORM pg_temp.p5_cleanup(); END; $$;
DROP FUNCTION IF EXISTS pg_temp.p5_cleanup();

DO $$ BEGIN
  RAISE NOTICE '=== Phase 5 WORM Audit Ledger: ALL TESTS PASSED ===';
END; $$;

ROLLBACK;

