-- NutriScore CAD Blueprint Phase 1
-- Schemas, non-bypass service roles, canonical claim helpers, compatibility
-- views, and the restrictive tenant wall. Local stack only; do not apply to
-- the hosted Supabase project outside the Phase 10 operational checklist.

BEGIN;

CREATE SCHEMA IF NOT EXISTS app_private;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS clinical;
CREATE SCHEMA IF NOT EXISTS exchange;
CREATE SCHEMA IF NOT EXISTS commercial;
CREATE SCHEMA IF NOT EXISTS audit;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'migrator',
    'svc_clinical',
    'svc_provisioning',
    'svc_exchange',
    'svc_commercial',
    'svc_audit_writer',
    'svc_audit_reader_tenant',
    'svc_audit_reader_platform',
    'audit_view_owner'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', role_name);
    END IF;
  END LOOP;
END
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA iam FROM PUBLIC;
REVOKE ALL ON SCHEMA clinical FROM PUBLIC;
REVOKE ALL ON SCHEMA exchange FROM PUBLIC;
REVOKE ALL ON SCHEMA commercial FROM PUBLIC;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

-- Service identities may use only their own zone.  Phase 5 narrows audit
-- object grants further; this establishes the Stage A schema boundary.
REVOKE ALL ON SCHEMA iam, clinical, exchange, commercial, audit
  FROM svc_clinical, svc_provisioning, svc_exchange, svc_commercial,
       svc_audit_writer, svc_audit_reader_tenant, svc_audit_reader_platform;
GRANT USAGE ON SCHEMA iam TO svc_provisioning;
GRANT USAGE ON SCHEMA clinical TO svc_clinical;
GRANT USAGE ON SCHEMA exchange TO svc_exchange;
GRANT USAGE ON SCHEMA commercial TO svc_commercial;
GRANT USAGE ON SCHEMA audit TO svc_audit_writer, svc_audit_reader_tenant, svc_audit_reader_platform;

-- The helper functions are the only database seam between the Stage A
-- Supabase token and the later Keycloak token. A1 deliberately uses
-- app_role: role is reserved by Supabase for the Postgres database role.
CREATE OR REPLACE FUNCTION app_private.claims()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE OR REPLACE FUNCTION app_private.tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(app_private.claims() ->> 'tenant_id', '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_private.app_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(app_private.claims() ->> 'app_role', '')
$$;

CREATE OR REPLACE FUNCTION app_private.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(app_private.claims() ->> 'sub', '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_private.ban_until()
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '2099-01-01T00:00:00Z'::timestamptz
$$;

-- The function has no caller-controlled relation or identifier. It is owned
-- by the migration superuser so FORCE RLS does not recursively evaluate the
-- iam.members tenant-wall policy while answering an active-status check.
CREATE OR REPLACE FUNCTION app_private.is_active_member()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam, auth, app_private
AS $$
DECLARE
  member_is_active boolean;
  banned_at timestamptz;
BEGIN
  -- Dynamic SQL defers binding until after the legacy membership table is
  -- moved into iam below.
  EXECUTE
    'SELECT EXISTS (
       SELECT 1 FROM iam.members member_row
       WHERE member_row.user_id = app_private.uid()
         AND member_row.status = ''active''
     )'
    INTO member_is_active;

  SELECT NULLIF(to_jsonb(auth_user) ->> 'banned_until', '')::timestamptz
  INTO banned_at
  FROM auth.users auth_user
  WHERE auth_user.id = app_private.uid();

  RETURN coalesce(member_is_active, false)
    AND coalesce(banned_at, '-infinity'::timestamptz) < app_private.ban_until();
END
$$;
ALTER FUNCTION app_private.is_active_member() OWNER TO postgres;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.claims(), app_private.tenant_id(),
  app_private.app_role(), app_private.uid(), app_private.ban_until(),
  app_private.is_active_member() TO authenticated;

-- Move existing CAD data without copying or dropping it. The legacy public
-- names are restored below as security-invoker compatibility views.
ALTER TABLE public.tenants SET SCHEMA iam;
ALTER TABLE public.tenant_members SET SCHEMA iam;
ALTER TABLE iam.tenant_members RENAME TO members;

ALTER TABLE public.targets SET SCHEMA clinical;
ALTER TABLE public.target_bundles SET SCHEMA clinical;
ALTER TABLE public.consumption_diary SET SCHEMA clinical;
ALTER TABLE public.consent_records SET SCHEMA clinical;
ALTER TABLE public.patient_links SET SCHEMA clinical;
ALTER TABLE public.consents SET SCHEMA clinical;
ALTER TABLE public.health_modes SET SCHEMA clinical;
ALTER TABLE public.health_mode_rules SET SCHEMA clinical;
ALTER TABLE public.tracked_nutrients SET SCHEMA clinical;

ALTER TABLE public.audit_log SET SCHEMA audit;
ALTER TABLE audit.audit_log RENAME TO legacy_audit_log;

-- A restrictive policy is ANDed with each existing permissive, role-specific
-- policy. Missing, malformed, suspended, or banned claims therefore fail
-- closed regardless of an older policy's role predicate.
CREATE OR REPLACE FUNCTION app_private.apply_tenant_wall(p_table text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app_private
AS $$
BEGIN
  IF p_table !~ '^(iam|clinical|audit|exchange|commercial|public)\.[a-z_]+$' THEN
    RAISE EXCEPTION 'unsupported tenant-wall relation';
  END IF;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_wall ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_wall ON %s AS RESTRICTIVE FOR ALL TO authenticated '
    || 'USING (tenant_id = (SELECT app_private.tenant_id()) '
    || 'AND (SELECT app_private.is_active_member())) '
    || 'WITH CHECK (tenant_id = (SELECT app_private.tenant_id()) '
    || 'AND (SELECT app_private.is_active_member()))',
    p_table
  );
END;
$$;
ALTER FUNCTION app_private.apply_tenant_wall(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION app_private.apply_tenant_wall(text) FROM PUBLIC;

SELECT app_private.apply_tenant_wall('iam.members');
SELECT app_private.apply_tenant_wall('audit.legacy_audit_log');
SELECT app_private.apply_tenant_wall('clinical.targets');
SELECT app_private.apply_tenant_wall('clinical.target_bundles');
SELECT app_private.apply_tenant_wall('clinical.consumption_diary');
SELECT app_private.apply_tenant_wall('clinical.consent_records');
SELECT app_private.apply_tenant_wall('clinical.patient_links');
SELECT app_private.apply_tenant_wall('clinical.consents');
SELECT app_private.apply_tenant_wall('clinical.health_modes');
SELECT app_private.apply_tenant_wall('clinical.health_mode_rules');
SELECT app_private.apply_tenant_wall('public.users');
SELECT app_private.apply_tenant_wall('public.payments');
SELECT app_private.apply_tenant_wall('public.subscriptions');
SELECT app_private.apply_tenant_wall('public.invoices');
SELECT app_private.apply_tenant_wall('public.payment_attempts');

-- Keep the legacy REST surface available throughout the phased move. Views
-- run with invoker rights, so base-table RLS and the tenant-wall always apply.
CREATE VIEW public.tenants WITH (security_invoker = true) AS SELECT * FROM iam.tenants;
CREATE VIEW public.tenant_members WITH (security_invoker = true) AS SELECT * FROM iam.members;
CREATE VIEW public.targets WITH (security_invoker = true) AS SELECT * FROM clinical.targets;
CREATE VIEW public.target_bundles WITH (security_invoker = true) AS SELECT * FROM clinical.target_bundles;
CREATE VIEW public.consumption_diary WITH (security_invoker = true) AS SELECT * FROM clinical.consumption_diary;
CREATE VIEW public.consent_records WITH (security_invoker = true) AS SELECT * FROM clinical.consent_records;
CREATE VIEW public.patient_links WITH (security_invoker = true) AS SELECT * FROM clinical.patient_links;
CREATE VIEW public.consents WITH (security_invoker = true) AS SELECT * FROM clinical.consents;
CREATE VIEW public.health_modes WITH (security_invoker = true) AS SELECT * FROM clinical.health_modes;
CREATE VIEW public.health_mode_rules WITH (security_invoker = true) AS SELECT * FROM clinical.health_mode_rules;
CREATE VIEW public.tracked_nutrients WITH (security_invoker = true) AS SELECT * FROM clinical.tracked_nutrients;
CREATE VIEW public.audit_log WITH (security_invoker = true) AS SELECT * FROM audit.legacy_audit_log;

GRANT USAGE ON SCHEMA public, iam, clinical, audit TO authenticated;
-- security_invoker compatibility views intentionally require the caller to
-- hold the corresponding base-table privilege. RLS still decides every row;
-- the non-public schemas are not exposed by the Stage A REST API.
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.members, audit.legacy_audit_log,
  clinical.targets, clinical.target_bundles, clinical.consumption_diary,
  clinical.consent_records, clinical.patient_links, clinical.consents,
  clinical.health_modes, clinical.health_mode_rules TO authenticated;
GRANT SELECT ON clinical.tracked_nutrients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users, public.payments,
  public.subscriptions, public.invoices, public.payment_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants, public.tenant_members,
  public.targets, public.target_bundles, public.consumption_diary,
  public.consent_records, public.patient_links, public.consents,
  public.health_modes, public.health_mode_rules, public.audit_log TO authenticated;

-- Existing SQL functions retain their public relation references. Replacing
-- those calls with schema-native functions happens together with the claims
-- and RBAC cutover in Phase 2/3; the views above make this phase safe alone.

COMMIT;

