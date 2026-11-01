-- CAD Blueprint Phase 4: Clinical Core, Treatment Relationships, ABAC, and Break-Glass Suite
-- Run on a disposable local Supabase database after Phase 1-4 migrations.

BEGIN;

DO $$
DECLARE
  tenant_a uuid := '51111111-1111-1111-1111-111111111111';
  tenant_b uuid := '52222222-2222-2222-2222-222222222222';

  clinician_a1 uuid := '51111111-1111-1111-1111-111111111110';
  clinician_a2_unlicensed uuid := '51111111-1111-1111-1111-111111111120';
  dietician_a uuid := '51111111-1111-1111-1111-111111111130';
  admin_a uuid := '51111111-1111-1111-1111-111111111140';
  patient_user_a uuid := '51111111-1111-1111-1111-111111111150';

  clinician_b uuid := '52222222-2222-2222-2222-222222222210';

  patient_1 uuid := '53333333-3333-3333-3333-333333333301';
  patient_2 uuid := '53333333-3333-3333-3333-333333333302';
  patient_b uuid := '53333333-3333-3333-3333-333333333303';

  record_id uuid;
  advice_draft_id uuid;
  advice_pub_id uuid;
  grant_id uuid;
  grant_res jsonb;

  has_rel boolean;
  row_count integer;
  caught_exclusion boolean := false;
  caught_24h_check boolean := false;
  caught_tag_fk boolean := false;
  caught_mutation boolean := false;
BEGIN
  -- 1. Setup Auth Users & Tenants Fixtures
  INSERT INTO auth.users (id, email) VALUES
    (clinician_a1, 'clinician-a1@fixture.test'),
    (clinician_a2_unlicensed, 'clinician-a2@fixture.test'),
    (dietician_a, 'dietician-a@fixture.test'),
    (admin_a, 'admin-a@fixture.test'),
    (patient_user_a, 'patient-a@fixture.test'),
    (clinician_b, 'clinician-b@fixture.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO iam.tenants (id, name, slug, status) VALUES
    (tenant_a, 'ABAC Fixture Tenant A', 'abac-fixture-a', 'active'),
    (tenant_b, 'ABAC Fixture Tenant B', 'abac-fixture-b', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO iam.members (tenant_id, user_id, role, status, licence_verified) VALUES
    (tenant_a, clinician_a1, 'writing_clinician', 'active', true),
    (tenant_a, clinician_a2_unlicensed, 'writing_clinician', 'active', false),
    (tenant_a, dietician_a, 'viewing_dietician', 'active', false),
    (tenant_a, admin_a, 'tenant_admin', 'active', false),
    (tenant_a, patient_user_a, 'patient', 'active', false),
    (tenant_b, clinician_b, 'writing_clinician', 'active', true)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET status = EXCLUDED.status, role = EXCLUDED.role, licence_verified = EXCLUDED.licence_verified;

  -- 2. Setup Patients
  INSERT INTO clinical.patients (tenant_id, id, user_id, full_name_enc) VALUES
    (tenant_a, patient_1, patient_user_a, '\x010203'),
    (tenant_a, patient_2, NULL, '\x010204'),
    (tenant_b, patient_b, NULL, '\x010205')
  ON CONFLICT (tenant_id, id) DO NOTHING;

  -- 3. Test Treatment Relationships GiST Exclusion Constraint
  -- Insert primary relationship for patient_1
  INSERT INTO clinical.treatment_relationships (
    tenant_id, patient_id, staff_id, kind, can_write, valid_from, valid_to, created_by
  ) VALUES (
    tenant_a, patient_1, clinician_a1, 'primary', true, now() - interval '1 hour', NULL, admin_a
  );

  -- Attempt overlapping primary relationship: MUST fail with exclusion violation
  BEGIN
    INSERT INTO clinical.treatment_relationships (
      tenant_id, patient_id, staff_id, kind, can_write, valid_from, valid_to, created_by
    ) VALUES (
      tenant_a, patient_1, clinician_a2_unlicensed, 'primary', true, now() - interval '30 minutes', NULL, admin_a
    );
  EXCEPTION WHEN exclusion_violation THEN
    caught_exclusion := true;
  END;

  IF NOT caught_exclusion THEN
    RAISE EXCEPTION 'GiST exclusion constraint failed to prevent overlapping primary relationships';
  END IF;

  -- Insert expired referral relationship for patient_2
  INSERT INTO clinical.treatment_relationships (
    tenant_id, patient_id, staff_id, kind, can_write, valid_from, valid_to, created_by
  ) VALUES (
    tenant_a, patient_2, clinician_a1, 'referral', true, now() - interval '10 days', now() - interval '1 day', admin_a
  );

  -- Insert covering relationship for clinician_a2 on patient_1 (can_write = true, but clinician_a2 licence_verified is false)
  INSERT INTO clinical.treatment_relationships (
    tenant_id, patient_id, staff_id, kind, can_write, valid_from, valid_to, created_by
  ) VALUES (
    tenant_a, patient_1, clinician_a2_unlicensed, 'covering', true, now() - interval '1 day', NULL, admin_a
  );

  -- Insert referral relationship for dietician_a on patient_1 (can_write = false)
  INSERT INTO clinical.treatment_relationships (
    tenant_id, patient_id, staff_id, kind, can_write, valid_from, valid_to, created_by
  ) VALUES (
    tenant_a, patient_1, dietician_a, 'referral', false, now() - interval '1 day', NULL, admin_a
  );

  -- 4. Test app_private.has_relationship()
  -- Test 4a: clinician_a1 on patient_1 (active, can_write=true, licence_verified=true)
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', clinician_a1::text, 'sid', 'test-s1',
    'tenant_id', tenant_a::text, 'app_role', 'writing_clinician', 'lic_ok', true, 'ver', 1
  )::text, true);

  IF NOT app_private.has_relationship(patient_1, false) THEN
    RAISE EXCEPTION 'has_relationship(patient_1, read) should be true for clinician_a1';
  END IF;
  IF NOT app_private.has_relationship(patient_1, true) THEN
    RAISE EXCEPTION 'has_relationship(patient_1, write) should be true for clinician_a1';
  END IF;

  -- Test 4b: clinician_a1 on patient_2 (expired relationship)
  IF app_private.has_relationship(patient_2, false) THEN
    RAISE EXCEPTION 'has_relationship(patient_2, read) should be false due to expired validity';
  END IF;
  IF app_private.has_relationship(patient_2, true) THEN
    RAISE EXCEPTION 'has_relationship(patient_2, write) should be false due to expired validity';
  END IF;

  -- Test 4c: clinician_a2_unlicensed on patient_1 (active covering, but licence_verified = false)
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', clinician_a2_unlicensed::text, 'sid', 'test-s2',
    'tenant_id', tenant_a::text, 'app_role', 'writing_clinician', 'lic_ok', false, 'ver', 1
  )::text, true);

  IF NOT app_private.has_relationship(patient_1, false) THEN
    RAISE EXCEPTION 'has_relationship(patient_1, read) should be true for covering clinician_a2';
  END IF;
  IF app_private.has_relationship(patient_1, true) THEN
    RAISE EXCEPTION 'has_relationship(patient_1, write) should be false for unlicensed clinician_a2';
  END IF;

  -- Test 4d: Immediate revocation check
  -- When clinician_a1 status is set to suspended, access ceases immediately on next query
  UPDATE iam.members SET status = 'suspended' WHERE tenant_id = tenant_a AND user_id = clinician_a1;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', clinician_a1::text, 'sid', 'test-s1',
    'tenant_id', tenant_a::text, 'app_role', 'writing_clinician', 'lic_ok', true, 'ver', 1
  )::text, true);

  IF app_private.has_relationship(patient_1, false) THEN
    RAISE EXCEPTION 'immediate revocation failed: suspended member retained relationship access';
  END IF;
  -- Restore clinician_a1
  UPDATE iam.members SET status = 'active' WHERE tenant_id = tenant_a AND user_id = clinician_a1;

  -- 5. Test clinical.clinical_records Policies & Append-Only Behavior
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', clinician_a1::text, 'sid', 'test-s1',
    'tenant_id', tenant_a::text, 'app_role', 'writing_clinician', 'lic_ok', true, 'ver', 1
  )::text, true);
  SET LOCAL ROLE authenticated;

  -- Clinician a1 can insert record on related patient_1
  INSERT INTO clinical.clinical_records (
    tenant_id, patient_id, author_id, record_type, body_enc, body_mac
  ) VALUES (
    tenant_a, patient_1, clinician_a1, 'note', '\xdeadbeef', '\x123456'
  ) RETURNING id INTO record_id;

  -- Clinician a1 cannot insert record on patient_2 (expired relationship)
  BEGIN
    INSERT INTO clinical.clinical_records (
      tenant_id, patient_id, author_id, record_type, body_enc, body_mac
    ) VALUES (
      tenant_a, patient_2, clinician_a1, 'note', '\xdeadbeef', '\x123456'
    );
    RAISE EXCEPTION 'clinician inserted record on expired relationship patient without break-glass';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected RLS check failure
    NULL;
  END;

  -- Append-only test: Attempting UPDATE on clinical_records MUST fail
  BEGIN
    UPDATE clinical.clinical_records SET version = 2 WHERE id = record_id;
  EXCEPTION WHEN OTHERS THEN
    caught_mutation := true;
  END;
  IF NOT caught_mutation THEN
    RAISE EXCEPTION 'append-only invariant violated: UPDATE on clinical_records was allowed';
  END IF;

  caught_mutation := false;
  -- Append-only test: Attempting DELETE on clinical_records MUST fail
  BEGIN
    DELETE FROM clinical.clinical_records WHERE id = record_id;
  EXCEPTION WHEN OTHERS THEN
    caught_mutation := true;
  END;
  IF NOT caught_mutation THEN
    RAISE EXCEPTION 'append-only invariant violated: DELETE on clinical_records was allowed';
  END IF;

  RESET ROLE;

  -- Test unlicensed clinician cannot insert clinical_record
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', clinician_a2_unlicensed::text, 'sid', 'test-s2',
    'tenant_id', tenant_a::text, 'app_role', 'writing_clinician', 'lic_ok', false, 'ver', 1
  )::text, true);
  SET LOCAL ROLE authenticated;

  -- Read works because relationship exists
  SELECT count(*) INTO row_count FROM clinical.clinical_records WHERE id = record_id;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'unlicensed clinician should be allowed to read related patient records';
  END IF;

  -- Write fails because licence_verified is false
  BEGIN
    INSERT INTO clinical.clinical_records (
      tenant_id, patient_id, author_id, record_type, body_enc, body_mac
    ) VALUES (
      tenant_a, patient_1, clinician_a2_unlicensed, 'note', '\xdeadbeef', '\x123456'
    );
    RAISE EXCEPTION 'unlicensed clinician was able to insert clinical_records';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  -- 6. Test Dietary Tags & Controlled Vocabulary
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', dietician_a::text, 'sid', 'test-s3',
    'tenant_id', tenant_a::text, 'app_role', 'viewing_dietician', 'lic_ok', false, 'ver', 1
  )::text, true);
  SET LOCAL ROLE authenticated;

  -- Valid tag from controlled vocabulary
  INSERT INTO clinical.dietary_tags (tenant_id, patient_id, author_id, tag)
  VALUES (tenant_a, patient_1, dietician_a, 'low_sodium');

  -- Tag not in controlled vocabulary fails foreign key
  BEGIN
    INSERT INTO clinical.dietary_tags (tenant_id, patient_id, author_id, tag)
    VALUES (tenant_a, patient_1, dietician_a, 'nonexistent_dietary_tag');
  EXCEPTION WHEN foreign_key_violation THEN
    caught_tag_fk := true;
  END;
  IF NOT caught_tag_fk THEN
    RAISE EXCEPTION 'dietary tag outside controlled vocabulary was allowed';
  END IF;

  -- Dietician cannot read clinical_records (PHI-1)
  SELECT count(*) INTO row_count FROM clinical.clinical_records WHERE id = record_id;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'viewing_dietician must not be able to read clinical_records';
  END IF;
  RESET ROLE;

  -- 7. Test Clinical Advice & Patient Published View
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', clinician_a1::text, 'sid', 'test-s1',
    'tenant_id', tenant_a::text, 'app_role', 'writing_clinician', 'lic_ok', true, 'ver', 1
  )::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO clinical.clinical_advice (tenant_id, patient_id, author_id, status, body_enc)
  VALUES (tenant_a, patient_1, clinician_a1, 'draft', '\x01020304')
  RETURNING id INTO advice_draft_id;

  INSERT INTO clinical.clinical_advice (tenant_id, patient_id, author_id, status, body_enc)
  VALUES (tenant_a, patient_1, clinician_a1, 'published', '\x05060708')
  RETURNING id INTO advice_pub_id;

  RESET ROLE;

  -- Patient can see published advice about self, but NEVER draft advice
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', patient_user_a::text, 'sid', 'test-sp',
    'tenant_id', tenant_a::text, 'app_role', 'patient', 'lic_ok', false, 'ver', 1
  )::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO row_count FROM clinical.clinical_advice WHERE id = advice_pub_id;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'patient could not see own published clinical_advice';
  END IF;

  SELECT count(*) INTO row_count FROM clinical.clinical_advice WHERE id = advice_draft_id;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'patient was able to see draft clinical_advice';
  END IF;

  RESET ROLE;

  -- 8. Test Break-Glass Emergency Grant (24-Hour Boundary & Read-Only)
  -- 8a: 24h check constraint
  BEGIN
    INSERT INTO clinical.emergency_grants (
      tenant_id, patient_id, grantee_id, granted_by, incident_no, reason_enc, starts_at, expires_at
    ) VALUES (
      tenant_a, patient_2, clinician_a1, admin_a, 'INC-999', '\x112233', now(), now() + interval '25 hours'
    );
  EXCEPTION WHEN check_violation THEN
    caught_24h_check := true;
  END;
  IF NOT caught_24h_check THEN
    RAISE EXCEPTION 'emergency_grants failed to enforce 24-hour lifetime ceiling';
  END IF;

  -- 8b: Insert a record for patient_2 as superuser so break-glass can be tested
  INSERT INTO clinical.clinical_records (
    tenant_id, patient_id, author_id, record_type, body_enc, body_mac
  ) VALUES (
    tenant_a, patient_2, admin_a, 'note', '\x445566', '\x123456'
  ) RETURNING id INTO record_id;

  -- 8c: Grant break-glass at hour 23 (starts_at = now() - 23h, expires_at = now() + 1h)
  INSERT INTO clinical.emergency_grants (
    tenant_id, patient_id, grantee_id, granted_by, incident_no, reason_enc, starts_at, expires_at
  ) VALUES (
    tenant_a, patient_2, clinician_a1, admin_a, 'INC-100', '\x112233',
    now() - interval '23 hours', now() + interval '1 hour'
  ) RETURNING id INTO grant_id;

  -- Clinician a1 at hour 23: Can READ patient_2 clinical_records via break_glass_select
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', clinician_a1::text, 'sid', 'test-s1',
    'tenant_id', tenant_a::text, 'app_role', 'writing_clinician', 'lic_ok', true, 'ver', 1
  )::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO row_count FROM clinical.clinical_records WHERE id = record_id;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'clinician at hour 23 could not read clinical_record via break-glass grant';
  END IF;

  -- Clinician a1 at hour 23: CANNOT WRITE (break-glass is strictly read-only)
  BEGIN
    INSERT INTO clinical.clinical_records (
      tenant_id, patient_id, author_id, record_type, body_enc, body_mac
    ) VALUES (
      tenant_a, patient_2, clinician_a1, 'note', '\x778899', '\x123456'
    );
    RAISE EXCEPTION 'clinician was able to write under break-glass grant';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  RESET ROLE;

  -- 8d: Hour 25 (expired grant: starts_at = now() - 25h, expires_at = now() - 1h)
  UPDATE clinical.emergency_grants
  SET starts_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
  WHERE id = grant_id;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', clinician_a1::text, 'sid', 'test-s1',
    'tenant_id', tenant_a::text, 'app_role', 'writing_clinician', 'lic_ok', true, 'ver', 1
  )::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO row_count FROM clinical.clinical_records WHERE id = record_id;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'clinician was able to read clinical_records after break-glass expired (hour 25)';
  END IF;

  RESET ROLE;

  -- 9. Test Retention Policies Seed per D5
  IF NOT EXISTS (
    SELECT 1 FROM clinical.retention_policies
    WHERE tenant_id = tenant_a AND record_class = 'shopping_ledger'
      AND retain_years = 3 AND retain_from = 'deactivation'
  ) THEN
    RAISE EXCEPTION 'D5 retention policy for shopping_ledger missing or incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM clinical.retention_policies
    WHERE tenant_id = tenant_a AND record_class = 'commercial_orders'
      AND retain_years = 3 AND retain_from = 'deactivation'
  ) THEN
    RAISE EXCEPTION 'D5 retention policy for commercial_orders missing or incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM clinical.retention_policies
    WHERE tenant_id = tenant_a AND record_class = 'transaction_logs'
      AND retain_years = 3 AND retain_from = 'deactivation'
  ) THEN
    RAISE EXCEPTION 'D5 retention policy for transaction_logs missing or incorrect';
  END IF;

  -- 10. Test Consent Records Lawful Basis (A3)
  INSERT INTO clinical.consent_records (
    tenant_id, patient_id, purpose, lawful_basis, policy_version
  ) VALUES (
    tenant_a, patient_1, 'dietary_profile_sharing', ARRAY['contract', 'explicit_consent'], 1
  );

  IF NOT EXISTS (
    SELECT 1 FROM clinical.consent_records
    WHERE tenant_id = tenant_a AND patient_id = patient_1
      AND purpose = 'dietary_profile_sharing'
      AND lawful_basis = ARRAY['contract', 'explicit_consent']
  ) THEN
    RAISE EXCEPTION 'consent record with lawful_basis array was not stored correctly';
  END IF;

  -- Clean up test records
  DELETE FROM clinical.consent_records WHERE tenant_id IN (tenant_a, tenant_b);
  DELETE FROM clinical.emergency_grants WHERE tenant_id IN (tenant_a, tenant_b);
  DELETE FROM clinical.clinical_advice WHERE tenant_id IN (tenant_a, tenant_b);
  DELETE FROM clinical.dietary_tags WHERE tenant_id IN (tenant_a, tenant_b);
  -- Disable append-only trigger temporarily for clean test fixture teardown
  ALTER TABLE clinical.clinical_records DISABLE TRIGGER trg_clinical_records_deny_mutation;
  DELETE FROM clinical.clinical_records WHERE tenant_id IN (tenant_a, tenant_b);
  DELETE FROM clinical.treatment_relationships WHERE tenant_id IN (tenant_a, tenant_b);
  DELETE FROM clinical.patients WHERE tenant_id IN (tenant_a, tenant_b);
  DELETE FROM iam.members WHERE tenant_id IN (tenant_a, tenant_b);
  DELETE FROM iam.tenants WHERE id IN (tenant_a, tenant_b);
  DELETE FROM auth.users WHERE id IN (
    clinician_a1, clinician_a2_unlicensed, dietician_a, admin_a, patient_user_a, clinician_b
  );
  ALTER TABLE clinical.clinical_records ENABLE TRIGGER trg_clinical_records_deny_mutation;
END
$$;

COMMIT;
