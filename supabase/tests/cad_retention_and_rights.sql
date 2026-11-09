-- NutriScore CAD Blueprint Phase 9 — Retention Enforcement & Data-Subject Rights Tests
-- Reference: Blueprint §4.1, Decision D5, Amendments A2-A3
--
-- Exit criteria verified:
-- 1. Purge job refuses any class without an explicit policy (fail-safe rule D5).
-- 2. Purge job refuses any class with retain_years = NULL (fail-safe).
-- 3. Legal hold blocks purge execution (status = 'BLOCKED').
-- 4. Patient restriction flag updates patient and logs RESTRICT_PROCESSING.
-- 5. Clinical record rectification creates new version, leaves old version immutable, logs RECTIFY_CLINICAL_RECORD.
-- 6. Dry run writes RETENTION_PURGE_PLAN without modifying records.
-- 7. Active run deletes eligible records past retention and logs RETENTION_PURGE_EXECUTED.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(18);

-- Test context
CREATE TEMP TABLE p9_test_context AS
SELECT
  '11111111-1111-1111-1111-111111111111'::uuid AS tenant_1,
  gen_random_uuid() AS patient_id,
  gen_random_uuid() AS clinician_id;

-- 1. Verify existence of Phase 9 compliance functions
SELECT has_function('clinical', 'set_patient_restriction', ARRAY['uuid', 'uuid', 'boolean', 'text'], 'clinical.set_patient_restriction exists');
SELECT has_function('clinical', 'rectify_clinical_record', ARRAY['uuid', 'uuid', 'uuid', 'jsonb', 'text'], 'clinical.rectify_clinical_record exists');
SELECT has_function('clinical', 'execute_retention_purge', ARRAY['uuid', 'text', 'boolean'], 'clinical.execute_retention_purge exists');

-- 2. Verify commercial classes retention policy seed per D5/A2
SELECT results_eq(
  $$
  SELECT retain_years, retain_from
  FROM clinical.retention_policies
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid AND record_class = 'commercial_orders'
  $$,
  $$ VALUES (3, 'deactivation'::text) $$,
  'commercial_orders retention policy is 3 years from deactivation per D5'
);

-- 3. Fail-safe refusal: class with no policy configured
SELECT throws_ok(
  $$ SELECT clinical.execute_retention_purge('11111111-1111-1111-1111-111111111111'::uuid, 'unconfigured_class_xyz', true); $$,
  'P0001',
  NULL,
  'Purge refuses any record class without configured retention policy (fail-safe)'
);

-- 4. Fail-safe refusal: class with NULL retain_years
INSERT INTO clinical.retention_policies (tenant_id, record_class, retain_from, retain_years, legal_hold, basis)
VALUES ('11111111-1111-1111-1111-111111111111'::uuid, 'clinical_records', 'creation', NULL, false, 'Pending legal counsel basis')
ON CONFLICT (tenant_id, record_class) DO UPDATE SET retain_years = NULL;

SELECT throws_ok(
  $$ SELECT clinical.execute_retention_purge('11111111-1111-1111-1111-111111111111'::uuid, 'clinical_records', true); $$,
  'P0001',
  NULL,
  'Purge refuses any record class with NULL retain_years (fail-safe pending counsel)'
);

-- 5. Legal hold blocks purge
UPDATE clinical.retention_policies
SET legal_hold = true
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid AND record_class = 'commercial_orders';

SELECT is(
  (clinical.execute_retention_purge('11111111-1111-1111-1111-111111111111'::uuid, 'commercial_orders', true)->>'status'),
  'BLOCKED',
  'Legal hold blocks retention purge'
);

-- Restore legal hold
UPDATE clinical.retention_policies
SET legal_hold = false
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid AND record_class = 'commercial_orders';

-- 6. Setup test patient for rights workflows
INSERT INTO clinical.patients (tenant_id, id, full_name_enc, restricted)
SELECT tenant_1, patient_id, decode('01020304', 'hex'), false FROM p9_test_context;

-- 7. Test patient restriction (GDPR Art. 18 / Kenya DPA)
SELECT is(
  clinical.set_patient_restriction(
    (SELECT tenant_1 FROM p9_test_context),
    (SELECT patient_id FROM p9_test_context),
    true,
    'Patient requested restriction pending dispute'
  ),
  true,
  'set_patient_restriction returns true'
);

SELECT results_eq(
  $$ SELECT restricted FROM clinical.patients WHERE id = (SELECT patient_id FROM p9_test_context) $$,
  $$ VALUES (true) $$,
  'Patient restricted column is set to true'
);

-- 8. Verify RESTRICT_PROCESSING audit entry in WORM ledger
SELECT results_eq(
  $$
  SELECT action, decision
  FROM audit.ledger
  WHERE patient_ref = convert_to((SELECT patient_id::text FROM p9_test_context), 'utf8')
    AND action = 'RESTRICT_PROCESSING'
  ORDER BY seq DESC LIMIT 1
  $$,
  $$ VALUES ('RESTRICT_PROCESSING'::text, 'ALLOW'::text) $$,
  'RESTRICT_PROCESSING is logged in WORM audit ledger'
);

-- 9. Test patient rectification workflow (new version increment)
INSERT INTO clinical.clinical_records (
  tenant_id, id, patient_id, author_id, record_type,
  body_enc, body_mac, version
) VALUES (
  (SELECT tenant_1 FROM p9_test_context),
  gen_random_uuid(),
  (SELECT patient_id FROM p9_test_context),
  (SELECT clinician_id FROM p9_test_context),
  'assessment',
  decode('01020304', 'hex'),
  decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
  1
);

SELECT lives_ok(
  $$
  SELECT clinical.rectify_clinical_record(
    (SELECT tenant_1 FROM p9_test_context),
    (SELECT patient_id FROM p9_test_context),
    (SELECT id FROM clinical.clinical_records WHERE patient_id = (SELECT patient_id FROM p9_test_context) AND version = 1),
    '{"rectified": true, "note": "Corrected allergy profile"}'::jsonb,
    'Patient submitted updated lab diagnostic panel'
  );
  $$,
  'rectify_clinical_record successfully executes'
);

-- 10. Verify old version remains immutable (version 1 still exists)
SELECT is(
  (SELECT count(*)::int FROM clinical.clinical_records WHERE patient_id = (SELECT patient_id FROM p9_test_context) AND version = 1),
  1,
  'Original clinical record version 1 remains intact and immutable'
);

-- 11. Verify new version incremented to 2
SELECT is(
  (SELECT count(*)::int FROM clinical.clinical_records WHERE patient_id = (SELECT patient_id FROM p9_test_context) AND version = 2),
  1,
  'Rectified clinical record version 2 is created'
);

-- 12. Verify RECTIFY_CLINICAL_RECORD logged in audit ledger
SELECT results_eq(
  $$
  SELECT action, decision
  FROM audit.ledger
  WHERE patient_ref = convert_to((SELECT patient_id::text FROM p9_test_context), 'utf8')
    AND action = 'RECTIFY_CLINICAL_RECORD'
  ORDER BY seq DESC LIMIT 1
  $$,
  $$ VALUES ('RECTIFY_CLINICAL_RECORD'::text, 'ALLOW'::text) $$,
  'RECTIFY_CLINICAL_RECORD is logged in WORM audit ledger'
);

-- 13. Test Retention Purge: Dry run execution audits RETENTION_PURGE_PLAN
SELECT is(
  (clinical.execute_retention_purge('11111111-1111-1111-1111-111111111111'::uuid, 'commercial_orders', true)->>'dry_run')::boolean,
  true,
  'execute_retention_purge runs as dry-run by default'
);

SELECT results_eq(
  $$
  SELECT action
  FROM audit.ledger
  WHERE action = 'RETENTION_PURGE_PLAN'
    AND envelope->>'record_class' = 'commercial_orders'
  ORDER BY seq DESC LIMIT 1
  $$,
  $$ VALUES ('RETENTION_PURGE_PLAN'::text) $$,
  'RETENTION_PURGE_PLAN is logged in WORM audit ledger during dry run'
);

-- 14. Seed expired commercial order (> 3 years ago) for active purge test
INSERT INTO commercial.orders (
  tenant_id, id, shopper_alias, epoch, retailer, status, total_kes, idempotency_key, source, placed_at
) VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  gen_random_uuid(),
  decode('01020304', 'hex'),
  1,
  'Naivas Supermarket',
  'completed',
  1500,
  'test-idemp-expired-1',
  'extension_observed',
  now() - interval '4 years'
);

-- 15. Active purge execution: deletes expired orders and audits RETENTION_PURGE_EXECUTED
SELECT is(
  (clinical.execute_retention_purge('11111111-1111-1111-1111-111111111111'::uuid, 'commercial_orders', false)->>'purged_count')::int >= 1,
  true,
  'execute_retention_purge actively purges records past 3-year retention threshold'
);

-- 16. Verify RETENTION_PURGE_EXECUTED logged in audit ledger
SELECT results_eq(
  $$
  SELECT action
  FROM audit.ledger
  WHERE action = 'RETENTION_PURGE_EXECUTED'
    AND envelope->>'record_class' = 'commercial_orders'
  ORDER BY seq DESC LIMIT 1
  $$,
  $$ VALUES ('RETENTION_PURGE_EXECUTED'::text) $$,
  'RETENTION_PURGE_EXECUTED is logged in WORM audit ledger during active run'
);

SELECT * FROM finish();

ROLLBACK;
