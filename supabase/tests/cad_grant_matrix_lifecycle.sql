-- CAD Blueprint Phase 3: grant matrix, partner/regulator and lifecycle checks.
-- Run after the Phase 1–3 migrations on a disposable local Supabase database.

GRANT USAGE ON SCHEMA auth TO authenticated;

DO $$
DECLARE
  expected_grants text[] := ARRAY[
    'super_admin:tenant_admin:platform',
    'super_admin:compliance_auditor:platform',
    'super_admin:commercial_stakeholder:platform',
    'tenant_admin:writing_clinician:tenant',
    'tenant_admin:viewing_dietician:tenant',
    'tenant_admin:compliance_auditor:tenant',
    'tenant_admin:patient:tenant',
    'writing_clinician:patient:own_patients'
  ];
  actual_grants text[];
BEGIN
  SELECT array_agg(grantor_role || ':' || grantee_role || ':' || scope ORDER BY grantor_role || ':' || grantee_role || ':' || scope)
  INTO actual_grants
  FROM iam.role_grants;

  IF actual_grants IS DISTINCT FROM (SELECT array_agg(value ORDER BY value) FROM unnest(expected_grants) value) THEN
    RAISE EXCEPTION 'grant matrix drifted: %', actual_grants;
  END IF;
END
$$;

DO $$
DECLARE
  tenant_one uuid := '41111111-1111-1111-1111-111111111111';
  tenant_two uuid := '42222222-2222-2222-2222-222222222222';
  tenant_admin uuid := '41111111-1111-1111-1111-111111111110';
  super_admin uuid := '40000000-0000-0000-0000-000000000001';
  commercial_target uuid := '41111111-1111-1111-1111-111111111120';
  lifecycle_target uuid := '41111111-1111-1111-1111-111111111130';
  second_tenant_target uuid := '42222222-2222-2222-2222-222222222220';
  result jsonb;
  started_at timestamptz;
  denied_events integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (tenant_admin, 'grant-tenant-admin@fixture.test'),
    (super_admin, 'grant-super-admin@fixture.test'),
    (commercial_target, 'grant-commercial-target@fixture.test'),
    (lifecycle_target, 'grant-lifecycle-target@fixture.test'),
    (second_tenant_target, 'grant-second-tenant-target@fixture.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO iam.tenants (id, name, slug, status) VALUES
    (tenant_one, 'Grant Fixture Tenant One', 'grant-fixture-one', 'active'),
    (tenant_two, 'Grant Fixture Tenant Two', 'grant-fixture-two', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO iam.members (tenant_id, user_id, role, status, licence_verified) VALUES
    (tenant_one, tenant_admin, 'tenant_admin', 'active', false),
    (tenant_one, commercial_target, 'writing_clinician', 'active', true),
    (tenant_one, lifecycle_target, 'writing_clinician', 'active', true),
    (tenant_two, second_tenant_target, 'writing_clinician', 'active', true)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET status = 'active', role = EXCLUDED.role, licence_verified = EXCLUDED.licence_verified;

  INSERT INTO iam.platform_members (user_id, role, status)
  VALUES (super_admin, 'super_admin', 'active')
  ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin', status = 'active';

  -- Tenant admin cannot make a partner account; the direct RPC returns a
  -- generic denial and commits the audit record instead of rolling it back.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', tenant_admin::text, 'sid', 'grant-tenant-admin-session',
    'tenant_id', tenant_one::text, 'app_role', 'tenant_admin', 'lic_ok', false, 'ver', 1
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.update_tenant_member_role(
    tenant_one, commercial_target, 'commercial_stakeholder', 'fixture-partner', 'test'
  ) INTO result;
  RESET ROLE;

  IF result <> jsonb_build_object('success', false, 'error', 'forbidden') THEN
    RAISE EXCEPTION 'tenant admin stakeholder transition was not denied: %', result;
  END IF;
  SELECT count(*) INTO denied_events
  FROM audit.legacy_audit_log
  WHERE tenant_id = tenant_one AND actor_id = tenant_admin
    AND action = 'AUTHZ_DENY' AND reason = 'GRANT_MATRIX';
  IF denied_events < 1 THEN
    RAISE EXCEPTION 'grant denial did not produce AUTHZ_DENY / GRANT_MATRIX audit event';
  END IF;

  -- The same tenant admin cannot affect a target outside the caller tenant.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', tenant_admin::text, 'sid', 'grant-tenant-admin-cross-tenant',
    'tenant_id', tenant_one::text, 'app_role', 'tenant_admin', 'lic_ok', false, 'ver', 1
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.update_tenant_member_role(
    tenant_two, second_tenant_target, 'patient', NULL, 'test'
  ) INTO result;
  RESET ROLE;
  IF result <> jsonb_build_object('success', false, 'error', 'forbidden') THEN
    RAISE EXCEPTION 'cross-tenant role transition was not denied: %', result;
  END IF;

  -- A platform super admin can create the stakeholder transition and must
  -- supply partner_org; the member remains tenant-scoped.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', super_admin::text, 'sid', 'grant-super-admin-session',
    'app_role', 'super_admin', 'lic_ok', false, 'ver', 1
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.update_tenant_member_role(
    tenant_one, commercial_target, 'commercial_stakeholder', 'fixture-partner', 'test'
  ) INTO result;
  RESET ROLE;
  IF result ->> 'success' <> 'true' THEN
    RAISE EXCEPTION 'super admin stakeholder transition failed: %', result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM iam.members
    WHERE tenant_id = tenant_one AND user_id = commercial_target
      AND role = 'commercial_stakeholder' AND partner_org = 'fixture-partner'
  ) THEN
    RAISE EXCEPTION 'partner organisation / one-tenant invariant failed';
  END IF;

  -- A tenant admin retains the narrow stakeholder suspension safeguard, and
  -- session purge completes within the five-second Phase 3 objective.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', tenant_admin::text, 'sid', 'grant-tenant-admin-lifecycle',
    'tenant_id', tenant_one::text, 'app_role', 'tenant_admin', 'lic_ok', false, 'ver', 1
  )::text, true);
  SET LOCAL ROLE authenticated;
  started_at := clock_timestamp();
  SELECT public.deactivate_tenant_member(
    tenant_one, commercial_target, 'suspended', 'fixture suspension'
  ) INTO result;
  RESET ROLE;
  IF result ->> 'success' <> 'true' OR clock_timestamp() - started_at > interval '5 seconds' THEN
    RAISE EXCEPTION 'stakeholder suspension/session purge objective failed: %', result;
  END IF;

  -- Restore the target role before asserting a standard lifecycle transition.
  UPDATE iam.members SET role = 'writing_clinician', partner_org = NULL, status = 'active'
  WHERE tenant_id = tenant_one AND user_id = commercial_target;
END
$$;

DO $$
DECLARE
  auditor_id uuid := '40000000-0000-0000-0000-000000000002';
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (auditor_id, 'grant-regulator@fixture.test')
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    INSERT INTO iam.platform_members (
      user_id, role, auditor_scope, regulator_body, mandate_ref, status
    ) VALUES (
      auditor_id, 'compliance_auditor', 'platform', 'OTHER', 'fixture-mandate', 'active'
    );
    RAISE EXCEPTION 'non-DHA/ODPC platform auditor was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO iam.platform_members (
    user_id, role, auditor_scope, regulator_body, mandate_ref, status
  ) VALUES (
    auditor_id, 'compliance_auditor', 'platform', 'DHA', 'fixture-mandate', 'active'
  ) ON CONFLICT (user_id) DO UPDATE
  SET role = EXCLUDED.role,
      auditor_scope = EXCLUDED.auditor_scope,
      regulator_body = EXCLUDED.regulator_body,
      mandate_ref = EXCLUDED.mandate_ref,
      status = EXCLUDED.status;
END
$$;
