-- migrate:up
-- db/migrations/0003_bff_session_and_audit.sql
-- NUT-04 Checkout Tool — BFF Session Store, Denylist, Audit Ledger & Merkle Roots
-- References: Blueprint §3.5 (N5), §3.7 (N7), §4.2; ADR-004, ADR-008, ADR-012

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Server-Side BFF Session Store (ADR-004, Blueprint §3.5)
-- Cookie __Host-ns_sid binds to this store; tokens never reach browser JS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.session_store (
  sid text PRIMARY KEY,
  user_id text NOT NULL,
  tenant_id text NOT NULL,
  app_role text NOT NULL,
  acr integer NOT NULL DEFAULT 1,
  amr text[] NOT NULL DEFAULT '{}',
  encrypted_tokens jsonb NOT NULL,
  csrf_secret text NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_store_user_tenant
  ON public.session_store (user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_session_store_idle
  ON public.session_store (idle_expires_at);
CREATE INDEX IF NOT EXISTS idx_session_store_absolute
  ON public.session_store (absolute_expires_at);

-- ---------------------------------------------------------------------------
-- 2. Session Denylist (Blueprint §3.5, §3.9)
-- Immediate token and session revocation distribution
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.session_denylist (
  sid text PRIMARY KEY,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_denylist_expires
  ON public.session_denylist (expires_at);

-- ---------------------------------------------------------------------------
-- 3. Audit Entries (Immutable WORM Ledger, ADR-012, Blueprint §3.7 N7)
-- Append-only audit chain with SHA-256 hash chaining
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_entry (
  seq bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  actor_ref text NOT NULL,
  action text NOT NULL,
  resource_ref text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('permit', 'deny')),
  trace_id text NOT NULL,
  obj_hash text NOT NULL,
  prev_hash text NOT NULL,
  row_hash text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_entry_tenant_seq
  ON public.audit_entry (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_audit_entry_tenant_ts
  ON public.audit_entry (tenant_id, ts);

-- Prohibit UPDATE and DELETE on audit_entry
CREATE OR REPLACE FUNCTION public.prevent_audit_entry_modification()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_entry is an append-only WORM ledger: UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_audit_entry_modification ON public.audit_entry;
CREATE TRIGGER trg_prevent_audit_entry_modification
  BEFORE UPDATE OR DELETE ON public.audit_entry
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_entry_modification();

-- ---------------------------------------------------------------------------
-- 4. Audit Merkle Roots (ADR-7, Blueprint §3.7 N7)
-- Periodic signed Merkle roots of audit row_hash values
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_roots (
  epoch integer NOT NULL,
  seq integer NOT NULL,
  root_hash text NOT NULL,
  signature text NOT NULL,
  leaf_count integer NOT NULL,
  anchored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (epoch, seq)
);

CREATE INDEX IF NOT EXISTS idx_audit_roots_anchored
  ON public.audit_roots (anchored_at);

-- ---------------------------------------------------------------------------
-- 5. Row Level Security & Role Grants (Rule 5 & ADR-008)
-- ---------------------------------------------------------------------------
ALTER TABLE public.session_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_denylist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_roots ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_store TO service_role;
GRANT SELECT, INSERT ON public.session_denylist TO authenticated, service_role;
GRANT SELECT, INSERT ON public.audit_entry TO service_role;
GRANT SELECT ON public.audit_entry TO authenticated;
GRANT SELECT, INSERT ON public.audit_roots TO service_role;
GRANT SELECT ON public.audit_roots TO authenticated;

REVOKE UPDATE, DELETE ON public.audit_entry FROM authenticated, service_role, public;
REVOKE UPDATE, DELETE ON public.audit_roots FROM authenticated, service_role, public;

COMMIT;

-- migrate:down
BEGIN;
DROP TRIGGER IF EXISTS trg_prevent_audit_entry_modification ON public.audit_entry;
DROP FUNCTION IF EXISTS public.prevent_audit_entry_modification();
DROP TABLE IF EXISTS public.audit_roots CASCADE;
DROP TABLE IF EXISTS public.audit_entry CASCADE;
DROP TABLE IF EXISTS public.session_denylist CASCADE;
DROP TABLE IF EXISTS public.session_store CASCADE;
COMMIT;
