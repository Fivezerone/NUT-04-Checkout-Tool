-- CAD Blueprint Phase 1 live tenant-wall and service-boundary assertions.
-- Run through scripts/db-test.sh against a disposable local Postgres database.

-- The schema-only validation clone intentionally omits grants. Existing legacy
-- policies still call auth.jwt() until the Phase 2 claim cutover, so model the
-- normal Supabase authenticated-role schema access explicitly.
GRANT USAGE ON SCHEMA auth TO authenticated;

DO $$
DECLARE
  missing_walls text[];
BEGIN
  SELECT array_agg(c.oid::regclass::text ORDER BY c.oid::regclass::text)
  INTO missing_walls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('clinical', 'commercial', 'exchange', 'audit', 'iam')
    AND c.relkind = 'r'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    )
    AND (
      NOT c.relrowsecurity OR NOT c.relforcerowsecurity
      OR NOT EXISTS (
        SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid
          AND p.polname = 'tenant_wall'
          AND NOT p.polpermissive
      )
    );

  IF missing_walls IS NOT NULL THEN
    RAISE EXCEPTION 'tenant-wall gate failed: %', missing_walls;
  END IF;
END
$$;

DO $$
BEGIN
  IF has_schema_privilege('svc_commercial', 'clinical', 'USAGE')
    OR has_schema_privilege('svc_commercial', 'iam', 'USAGE')
    OR has_schema_privilege('svc_commercial', 'exchange', 'USAGE')
    OR has_schema_privilege('svc_exchange', 'clinical', 'USAGE')
    OR has_schema_privilege('svc_exchange', 'iam', 'USAGE') THEN
    RAISE EXCEPTION 'Stage A service-zone privilege boundary failed';
  END IF;
END
$$;

DO $$
DECLARE
  tenant_one uuid := '11111111-1111-1111-1111-111111111111';
  tenant_two uuid := '22222222-2222-2222-2222-222222222222';
  user_one uuid := '11111111-1111-1111-1111-111111111110';
  user_two uuid := '22222222-2222-2222-2222-222222222220';
  seen_count integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (user_one, 'tenant.one@fixture.test'),
    (user_two, 'tenant.two@fixture.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO iam.tenants (id, name, slug, status) VALUES
    (tenant_one, 'Tenant One', 'tenant-one', 'active'),
    (tenant_two, 'Tenant Two', 'tenant-two', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO iam.members (tenant_id, user_id, role, status) VALUES
    (tenant_one, user_one, 'tenant_admin', 'active'),
    (tenant_two, user_two, 'tenant_admin', 'active')
  ON CONFLICT DO NOTHING;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', user_one::text, 'tenant_id', tenant_one::text, 'app_role', 'tenant_admin')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO seen_count FROM public.tenant_members WHERE tenant_id = tenant_two;
  RESET ROLE;

  IF seen_count <> 0 THEN
    RAISE EXCEPTION 'cross-tenant membership read was not blocked';
  END IF;
END
$$;

