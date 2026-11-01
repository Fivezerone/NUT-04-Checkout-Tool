-- CAD Blueprint Phase 2: canonical claims and immediate token revocation.

DO $$
DECLARE
  fixture_tenant_id uuid := '33333333-3333-3333-3333-333333333333';
  fixture_user_id uuid := '33333333-3333-3333-3333-333333333330';
  hook_result jsonb;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (fixture_user_id, 'claims.user@fixture.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO iam.tenants (id, name, slug, status)
  VALUES (fixture_tenant_id, 'Claims Tenant', 'claims-tenant', 'active')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO iam.members (tenant_id, user_id, role, status, licence_verified)
  VALUES (fixture_tenant_id, fixture_user_id, 'writing_clinician', 'active', true)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET status = 'active', licence_verified = true;

  DELETE FROM iam.token_denylist WHERE sid = 'claims-session' OR user_id = fixture_user_id;

  hook_result := public.custom_access_token_hook(jsonb_build_object(
    'user_id', fixture_user_id::text,
    'claims', jsonb_build_object(
      'sub', fixture_user_id::text,
      'session_id', 'claims-session',
      'role', 'authenticated',
      'email', 'claims.user@fixture.test',
      'health_mode', 'sensitive-value'
    )
  ));

  IF hook_result #>> '{claims,app_role}' <> 'writing_clinician'
    OR (hook_result #>> '{claims,lic_ok}')::boolean IS NOT TRUE
    OR hook_result #>> '{claims,ver}' <> '1'
    OR hook_result #>> '{claims,role}' <> 'authenticated'
    OR hook_result #> '{claims,email}' IS NOT NULL
    OR hook_result #> '{claims,health_mode}' IS NOT NULL THEN
    RAISE EXCEPTION 'canonical claim hook output is invalid: %', hook_result;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', fixture_user_id::text,
      'sid', 'claims-session',
      'tenant_id', fixture_tenant_id::text,
      'app_role', 'writing_clinician',
      'lic_ok', true,
      'ver', 1
    )::text,
    true
  );
  IF NOT app_private.is_active_member() THEN
    RAISE EXCEPTION 'active member must be allowed before revocation';
  END IF;

  INSERT INTO iam.token_denylist (sid, user_id, reason_code, expires_at)
  VALUES ('claims-session', fixture_user_id, 'TEST_REVOCATION', now() + interval '5 minutes');

  IF app_private.is_active_member() THEN
    RAISE EXCEPTION 'denylisted current token was accepted';
  END IF;

  BEGIN
    UPDATE iam.members member_row SET status = 'deactivated'
    WHERE member_row.tenant_id = fixture_tenant_id AND member_row.user_id = fixture_user_id;
    PERFORM public.custom_access_token_hook(jsonb_build_object(
      'user_id', fixture_user_id::text,
      'claims', jsonb_build_object('sub', fixture_user_id::text, 'session_id', 'other-session', 'role', 'authenticated')
    ));
    RAISE EXCEPTION 'inactive member received a token';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

