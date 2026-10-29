-- ============================================================================
-- Migration: 20261029000000_multi_tenant_core.sql
-- Description: Clinic Admin Dashboard (CAD) Phase 2 Multi-Tenant Core Architecture
-- Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§6.1, §6.2, §6.3)
-- ============================================================================

-- 1. Create Tenants Registry
CREATE TABLE IF NOT EXISTS public.tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  slug           text UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,48}$'),
  status         text NOT NULL DEFAULT 'pending_activation'
                   CHECK (status IN (
                     'pending_activation','active','past_due',
                     'suspended','cancelled'
                   )),
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_version int NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Seed default platform tenant for individual / system users
INSERT INTO public.tenants (id, name, slug, status, config)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'NutriScore Platform & Direct Shoppers',
  'platform-default',
  'active',
  '{"is_platform_default": true}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- 2. Create Tenant Memberships
CREATE TABLE IF NOT EXISTS public.tenant_members (
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON public.tenant_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON public.tenant_members(tenant_id);

-- 3. Create Append-Only, Hash-Chained Audit Log
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

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_seq ON public.audit_log(tenant_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON public.audit_log(occurred_at DESC);

-- 4. Audit Log Integrity Guard (Reject UPDATE and DELETE)
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

-- 5. Audit Log Hash Chaining and Sequence Trigger
CREATE OR REPLACE FUNCTION public.process_audit_log_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_seq bigint;
  v_last_hash text;
  v_canonical text;
BEGIN
  -- Lock the tenant's latest audit sequence to prevent gaps and race conditions
  SELECT seq, row_hash INTO v_last_seq, v_last_hash
  FROM public.audit_log
  WHERE tenant_id = NEW.tenant_id
  ORDER BY seq DESC
  LIMIT 1
  FOR UPDATE;

  NEW.seq := COALESCE(v_last_seq, 0) + 1;
  NEW.prev_hash := COALESCE(v_last_hash, 'GENESIS');

  -- Canonical row string representation for hashing
  v_canonical := NEW.tenant_id::text || '|' ||
                 NEW.seq::text || '|' ||
                 NEW.occurred_at::text || '|' ||
                 NEW.actor_id::text || '|' ||
                 NEW.actor_role || '|' ||
                 NEW.action || '|' ||
                 NEW.mutation_type || '|' ||
                 NEW.resource_type || '|' ||
                 COALESCE(NEW.resource_id, '') || '|' ||
                 COALESCE(NEW.subject_ref, '') || '|' ||
                 NEW.reason || '|' ||
                 NEW.prev_hash;

  NEW.row_hash := encode(digest(v_canonical, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_chain ON public.audit_log;
CREATE TRIGGER trg_audit_log_chain
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.process_audit_log_insert();

-- 6. Add Tenant Reference to Existing Tables
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON public.payments(tenant_id);

-- Backfill existing users/payments without tenant to the platform tenant
UPDATE public.users
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

UPDATE public.payments
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Helper function to extract user tenant from JWT claims
CREATE OR REPLACE FUNCTION public.current_jwt_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid;
$$;

-- Helper function to extract user role from JWT claims
CREATE OR REPLACE FUNCTION public.current_jwt_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.jwt() ->> 'role', 'patient');
$$;

-- 8. RLS Policies: Tenants Table
DROP POLICY IF EXISTS tenant_isolation_tenants ON public.tenants;
CREATE POLICY tenant_isolation_tenants ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    id = public.current_jwt_tenant_id()
    OR public.current_jwt_role() = 'super_admin'
  );

DROP POLICY IF EXISTS tenant_admin_update_tenants ON public.tenants;
CREATE POLICY tenant_admin_update_tenants ON public.tenants
  FOR UPDATE
  TO authenticated
  USING (
    (id = public.current_jwt_tenant_id() AND public.current_jwt_role() IN ('tenant_admin', 'super_admin'))
  )
  WITH CHECK (
    (id = public.current_jwt_tenant_id() AND public.current_jwt_role() IN ('tenant_admin', 'super_admin'))
  );

-- 9. RLS Policies: Tenant Members Table
DROP POLICY IF EXISTS tenant_isolation_members ON public.tenant_members;
CREATE POLICY tenant_isolation_members ON public.tenant_members
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    OR user_id = auth.uid()
    OR public.current_jwt_role() = 'super_admin'
  );

DROP POLICY IF EXISTS tenant_admin_manage_members ON public.tenant_members;
CREATE POLICY tenant_admin_manage_members ON public.tenant_members
  FOR ALL
  TO authenticated
  USING (
    (tenant_id = public.current_jwt_tenant_id() AND public.current_jwt_role() IN ('tenant_admin', 'super_admin'))
  )
  WITH CHECK (
    (tenant_id = public.current_jwt_tenant_id() AND public.current_jwt_role() IN ('tenant_admin', 'super_admin'))
  );

-- 10. RLS Policies: Audit Log Table
DROP POLICY IF EXISTS tenant_isolation_audit ON public.audit_log;
CREATE POLICY tenant_isolation_audit ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    (tenant_id = public.current_jwt_tenant_id() AND public.current_jwt_role() IN ('tenant_admin', 'compliance_auditor', 'writing_clinician'))
    OR public.current_jwt_role() IN ('super_admin', 'compliance_auditor')
  );

DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
CREATE POLICY audit_log_insert ON public.audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_jwt_tenant_id()
    OR public.current_jwt_role() = 'super_admin'
  );

-- 11. RLS Policies: Users Table Tenant Extension
DROP POLICY IF EXISTS tenant_isolation_users ON public.users;
CREATE POLICY tenant_isolation_users ON public.users
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR (
      tenant_id IS NOT NULL 
      AND tenant_id = public.current_jwt_tenant_id() 
      AND public.current_jwt_role() IN ('tenant_admin', 'writing_clinician', 'viewing_dietician', 'super_admin')
    )
  );

-- 12. RLS Policies: Payments Table Tenant Extension
DROP POLICY IF EXISTS tenant_isolation_payments ON public.payments;
CREATE POLICY tenant_isolation_payments ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      tenant_id IS NOT NULL 
      AND tenant_id = public.current_jwt_tenant_id() 
      AND public.current_jwt_role() IN ('tenant_admin', 'super_admin')
    )
  );

-- 13. Custom Auth Claims Injection Hook
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_claims jsonb;
  v_user_id uuid;
  v_tenant_id uuid;
  v_role text;
  v_licence_verified boolean;
BEGIN
  v_claims := event -> 'claims';
  v_user_id := (event ->> 'user_id')::uuid;

  -- Lookup active tenant membership for user
  SELECT tenant_id, role, licence_verified
  INTO v_tenant_id, v_role, v_licence_verified
  FROM public.tenant_members
  WHERE user_id = v_user_id AND status = 'active'
  LIMIT 1;

  IF v_tenant_id IS NOT NULL THEN
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant_id));
    v_claims := jsonb_set(v_claims, '{role}', to_jsonb(v_role));
    v_claims := jsonb_set(v_claims, '{licence_verified}', to_jsonb(v_licence_verified));
  ELSE
    -- Default to platform tenant as patient
    v_claims := jsonb_set(v_claims, '{tenant_id}', '"00000000-0000-0000-0000-000000000000"'::jsonb);
    v_claims := jsonb_set(v_claims, '{role}', '"patient"'::jsonb);
    v_claims := jsonb_set(v_claims, '{licence_verified}', 'false'::jsonb);
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

