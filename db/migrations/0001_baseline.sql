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

-- Security ban constant (matches BAN_UNTIL_ISO in src/shared/constants.ts)
CREATE OR REPLACE FUNCTION app_private.ban_until()
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '2099-01-01T00:00:00Z'::timestamptz;
$$;

-- ---------------------------------------------------------------------------
-- Core Multi-Tenant Tables & RLS Policies
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  slug           text UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,48}$'),
  status         text NOT NULL DEFAULT 'pending_activation'
                   CHECK (status IN ('pending_activation','active','past_due','suspended','cancelled')),
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_version int NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenant_members (
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL,
  role             text NOT NULL CHECK (role IN (
                     'super_admin','compliance_auditor','tenant_admin',
                     'writing_clinician','viewing_dietician',
                     'commercial_stakeholder','patient'
                   )),
  licence_number   text,
  licence_expiry   date,
  licence_verified boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','suspended','revoked')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid REFERENCES public.tenants(id),
  full_name            text,
  condition            text,
  metric               text,
  onboarding_completed boolean NOT NULL DEFAULT false,
  is_premium           boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES public.tenants(id),
  user_id    uuid NOT NULL,
  amount     numeric(12,2) NOT NULL DEFAULT 0.00,
  currency   text NOT NULL DEFAULT 'KES',
  status     text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
  seq             bigint NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id        uuid NOT NULL,
  actor_role      text NOT NULL,
  session_id      text,
  action          text NOT NULL,
  mutation_type   text NOT NULL CHECK (mutation_type IN (
                    'create','update','suspend','revoke',
                    'read','export','break_glass'
                  )),
  resource_type   text NOT NULL,
  resource_id     text,
  subject_ref     text,
  before_snapshot bytea,
  after_snapshot  bytea,
  reason          text NOT NULL,
  prev_hash       text,
  row_hash        text NOT NULL,
  UNIQUE (tenant_id, seq)
);

-- Audit log tamper prevention trigger (T14 integrity invariant)
CREATE OR REPLACE FUNCTION public.prevent_audit_log_tamper()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RAISE EXCEPTION 'Audit log is append-only. UPDATE and DELETE operations are strictly prohibited (T14 integrity invariant).';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_tamper ON public.audit_log;
CREATE TRIGGER trg_audit_log_tamper
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_tamper();

-- Enable Row Level Security (T11 invariant)
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS tenant_isolation_tenants ON public.tenants;
CREATE POLICY tenant_isolation_tenants ON public.tenants
  FOR SELECT TO authenticated
  USING (id = app_private.tenant_id() OR app_private.app_role() = 'super_admin');

DROP POLICY IF EXISTS tenant_isolation_members ON public.tenant_members;
CREATE POLICY tenant_isolation_members ON public.tenant_members
  FOR SELECT TO authenticated
  USING (tenant_id = app_private.tenant_id() OR user_id = app_private.uid() OR app_private.app_role() = 'super_admin');

DROP POLICY IF EXISTS tenant_isolation_audit ON public.audit_log;
CREATE POLICY tenant_isolation_audit ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    (tenant_id = app_private.tenant_id() AND app_private.app_role() IN ('tenant_admin', 'compliance_auditor', 'writing_clinician'))
    OR app_private.app_role() IN ('super_admin', 'compliance_auditor')
  );

DROP POLICY IF EXISTS tenant_isolation_users ON public.users;
CREATE POLICY tenant_isolation_users ON public.users
  FOR SELECT TO authenticated
  USING (
    id = app_private.uid()
    OR (
      tenant_id IS NOT NULL 
      AND tenant_id = app_private.tenant_id() 
      AND app_private.app_role() IN ('tenant_admin', 'writing_clinician', 'viewing_dietician', 'super_admin')
    )
  );

DROP POLICY IF EXISTS tenant_isolation_payments ON public.payments;
CREATE POLICY tenant_isolation_payments ON public.payments
  FOR SELECT TO authenticated
  USING (
    user_id = app_private.uid()
    OR (
      tenant_id IS NOT NULL 
      AND tenant_id = app_private.tenant_id() 
      AND app_private.app_role() IN ('tenant_admin', 'super_admin')
    )
  );

-- ---------------------------------------------------------------------------
-- Catalog Release & Publishing Functions (F-08, F-13)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalog_products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer     text NOT NULL,
  product_id   text NOT NULL,
  record_hash  text,
  seq          bigint,
  deleted      boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.catalog_premium (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer     text NOT NULL,
  product_id   text NOT NULL,
  record_hash  text,
  seq          bigint,
  deleted      boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.catalog_releases (
  id         bigserial PRIMARY KEY,
  manifest   jsonb NOT NULL,
  signature  text NOT NULL,
  key_id     text NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Format constraints (F-13: migration 002 drops the hard-coded CHECK constraint)
alter table public.catalog_products drop constraint if exists catalog_products_retailer_check;
alter table public.catalog_premium  drop constraint if exists catalog_premium_retailer_check;
alter table public.catalog_products add constraint catalog_products_retailer_fmt check (retailer ~ '^[A-Z0-9_]{2,32}$');
alter table public.catalog_premium  add constraint catalog_premium_retailer_fmt  check (retailer ~ '^[A-Z0-9_]{2,32}$');

create table if not exists public.retailers (
  id                text primary key check (id ~ '^[A-Z0-9_]{2,32}$'),
  display_name      text not null,
  hosts             text[] not null,
  adapter_spec      jsonb,
  adapter_spec_hash text,
  enabled           boolean not null default true,
  rollout_pct       smallint not null default 100 check (rollout_pct between 0 and 100),
  updated_at        timestamptz not null default now()
);

insert into public.retailers (id, display_name, hosts) values
  ('NAIVAS',    'Naivas',          array['naivas.online','naivas.co.ke']),
  ('CARREFOUR', 'Carrefour Kenya', array['carrefour.ke','carrefourkenya.com'])
on conflict (id) do nothing;

alter table public.catalog_products drop constraint if exists catalog_products_retailer_fk;
alter table public.catalog_premium  drop constraint if exists catalog_premium_retailer_fk;
alter table public.catalog_products add constraint catalog_products_retailer_fk foreign key (retailer) references public.retailers(id) not valid;
alter table public.catalog_premium  add constraint catalog_premium_retailer_fk  foreign key (retailer) references public.retailers(id) not valid;

create or replace function public.catalog_release_publish(
  p_manifest jsonb, p_signature text, p_key_id text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_max_seq bigint;
  v_id      bigint;
begin
  perform pg_advisory_xact_lock(hashtext('catalog_release_publish'));

  select greatest(
    coalesce((select max(seq) from public.catalog_products), 0),
    coalesce((select max(seq) from public.catalog_premium),  0)
  ) into v_max_seq;

  if (p_manifest->>'max_seq')::bigint <> v_max_seq then
    raise exception 'manifest max_seq % does not match current catalog max_seq %',
      p_manifest->>'max_seq', v_max_seq;
  end if;

  update public.catalog_releases set is_current = false where is_current;
  insert into public.catalog_releases (manifest, signature, key_id, is_current)
    values (p_manifest, p_signature, p_key_id, true)
    returning id into v_id;
  return v_id;
end $$;

revoke all on function public.catalog_release_publish(jsonb, text, text) from public, anon, authenticated;
grant  execute on function public.catalog_release_publish(jsonb, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Token Bucket (F-14)
-- ---------------------------------------------------------------------------
create unlogged table if not exists public.rate_buckets (
  key        text primary key,
  tokens     double precision not null,
  updated_at timestamptz      not null default clock_timestamp()
);

alter table public.rate_buckets enable row level security;
revoke all on public.rate_buckets from anon, authenticated;

create or replace function public.rate_limit_take(
  p_key text, p_capacity int, p_refill_per_sec double precision, p_cost int default 1
) returns table (allowed boolean, retry_after_ms int)
language plpgsql security definer set search_path = public as $$
declare
  v_now     timestamptz := clock_timestamp();
  v_tokens  double precision;
  v_updated timestamptz;
begin
  insert into public.rate_buckets (key, tokens, updated_at) values (p_key, p_capacity, v_now)
    on conflict (key) do nothing;

  select b.tokens, b.updated_at into v_tokens, v_updated
    from public.rate_buckets b where b.key = p_key for update;

  v_tokens := least(p_capacity::double precision,
                    v_tokens + extract(epoch from (v_now - v_updated)) * p_refill_per_sec);

  if v_tokens >= p_cost then
    update public.rate_buckets set tokens = v_tokens - p_cost, updated_at = v_now where key = p_key;
    return query select true, 0;
    return; -- RETURN QUERY does not exit
  end if;

  update public.rate_buckets set tokens = v_tokens, updated_at = v_now where key = p_key;
  return query select false, ceil((p_cost - v_tokens) / p_refill_per_sec * 1000)::int;
end $$;

revoke all on function public.rate_limit_take(text, int, double precision, int) from public, anon, authenticated;
grant execute on function public.rate_limit_take(text, int, double precision, int) to service_role;

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

