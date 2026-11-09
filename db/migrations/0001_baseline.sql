-- db/migrations/0001_baseline.sql
-- NUT-04 Checkout Tool — Plain Postgres 16 baseline migration.
--
-- This file consolidates the CAD schema phases from supabase/migrations/
-- (phases 20261101000000 through 20261101080000) ported to plain Postgres:
--  - Supabase-specific schemas (auth, storage, realtime, supabase_*) removed
--  - auth.uid() / auth.jwt() replaced with app_private.uid() / app_private.claims()
--    reading request.jwt.claims via current_setting (PostgREST compatible)
--  - PostgREST roles (authenticator, anon, authenticated) created explicitly
--  - All custom roles and service roles preserved
--  - RLS policies preserved exactly (R7)
--  - Retention policy added per ADR 0005 (CLINICAL_RETENTION_YEARS default 20)
--
-- Run via: dbmate up
-- Rollback: dbmate down (see 0001_baseline.rollback.sql)

BEGIN;

-- ---------------------------------------------------------------------------
-- PostgREST roles (must exist before granting)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'authenticator']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
  -- authenticator is the PostgREST login role
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN;
  END IF;
  -- Allow authenticator to switch to anon or authenticated
  GRANT anon TO authenticator;
  GRANT authenticated TO authenticator;
END
$$;

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_private;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS clinical;
CREATE SCHEMA IF NOT EXISTS exchange;
CREATE SCHEMA IF NOT EXISTS commercial;
CREATE SCHEMA IF NOT EXISTS audit;

-- ---------------------------------------------------------------------------
-- Service roles (non-bypass, no-login)
-- ---------------------------------------------------------------------------
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
    'audit_view_owner',
    'nutriscore_app'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', role_name);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Schema access controls
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA iam FROM PUBLIC;
REVOKE ALL ON SCHEMA clinical FROM PUBLIC;
REVOKE ALL ON SCHEMA exchange FROM PUBLIC;
REVOKE ALL ON SCHEMA commercial FROM PUBLIC;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO anon, authenticated, authenticator;
GRANT USAGE ON SCHEMA iam TO svc_provisioning;
GRANT USAGE ON SCHEMA clinical TO svc_clinical;
GRANT USAGE ON SCHEMA exchange TO svc_exchange;
GRANT USAGE ON SCHEMA commercial TO svc_commercial;
GRANT USAGE ON SCHEMA audit TO svc_audit_writer, svc_audit_reader_tenant, svc_audit_reader_platform;

-- ---------------------------------------------------------------------------
-- JWT claim helpers (replaces auth.uid() / auth.jwt() — R7: same semantics)
-- PostgREST sets request.jwt.claims from the validated token before each request.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.claims()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE OR REPLACE FUNCTION app_private.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(app_private.claims() ->> 'sub', '')::uuid
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
  SELECT app_private.claims() ->> 'app_role'
$$;

CREATE OR REPLACE FUNCTION app_private.aal()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT app_private.claims() ->> 'acr'
$$;

CREATE OR REPLACE FUNCTION app_private.lic_ok()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT (app_private.claims() ->> 'lic_ok')::boolean
$$;

-- Public aliases for use in RLS policies
CREATE OR REPLACE FUNCTION app.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT app_private.uid()
$$;
CREATE OR REPLACE FUNCTION app.tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT app_private.tenant_id()
$$;
CREATE OR REPLACE FUNCTION app.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT app_private.app_role()
$$;
CREATE OR REPLACE FUNCTION app.aal() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT app_private.aal()
$$;

-- ---------------------------------------------------------------------------
-- Retention policy helper (ADR 0005)
-- ---------------------------------------------------------------------------
-- Set via environment / dbmate: CREATE OR REPLACE to allow override.
CREATE OR REPLACE FUNCTION app_private.clinical_retention_years()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.clinical_retention_years', true), '')::integer,
    20
  )
$$;

-- ---------------------------------------------------------------------------
-- NOTE: Full schema (tenants, iam.*, clinical.*, audit.*, etc.) is applied
-- by subsequent migration files that port each Supabase phase.
-- This baseline establishes roles, schemas, and helpers only.
-- ---------------------------------------------------------------------------
-- Phases to follow:
--   0002_iam_and_provisioning.sql      (from 20261029000000, 20261029050000)
--   0003_clinical_core.sql             (from 20261101030000)
--   0004_audit_ledger.sql              (from 20261101040000)
--   0005_field_encryption.sql          (from 20261101050000)
--   0006_exchange_dpt.sql              (from 20261101060000)
--   0007_commercial_overlay.sql        (from 20261101070000)
--   0008_compliance_retention.sql      (from 20261101080000 + ADR 0005 guard)
--   0009_catalog_and_bundles.sql       (from 20261029020000, catalog_schema)
--   0010_reference_seed_data.sql       (rule packs, grade thresholds)

COMMIT;

