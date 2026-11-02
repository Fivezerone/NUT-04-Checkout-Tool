-- NutriScore CAD Blueprint Phase 5
-- Signed WORM Audit Ledger, Checkpoints, Anchoring, and Platform Metadata View
-- Reference: Blueprint §4.4, §4.5; Amendment A7

BEGIN;

-- 1. Enable pgaudit extension
CREATE EXTENSION IF NOT EXISTS pgaudit;

-- 2. Create the WORM Audit Ledger
CREATE TABLE IF NOT EXISTS audit.ledger (
  chain_id      uuid        NOT NULL,                  -- tenant_id, or the platform sentinel UUID (00000000-0000-0000-0000-000000000000)
  seq           bigint      NOT NULL,
  event_id      uuid        NOT NULL UNIQUE,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_id      uuid,
  actor_role    text,
  action        text        NOT NULL,
  decision      text,
  resource_type text,
  resource_id   uuid,
  patient_ref   bytea,                                 -- HMAC pseudonym, not the patient UUID
  severity      smallint    NOT NULL DEFAULT 0,
  envelope      jsonb       NOT NULL,
  payload_enc   bytea,                                 -- before/after snapshots, encrypted (R6)
  payload_mac   bytea,                                 -- keyed commitment, not a plain hash
  prev_hash     bytea       NOT NULL,
  row_hash      bytea       NOT NULL,
  signature     bytea       NOT NULL,
  PRIMARY KEY (chain_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ledger_occurred_at
  ON audit.ledger (chain_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_action
  ON audit.ledger (chain_id, action);

-- 3. Create Audit Checkpoints Table
CREATE TABLE IF NOT EXISTS audit.checkpoints (
  chain_id             uuid NOT NULL,
  seq_from             bigint NOT NULL,
  seq_to               bigint NOT NULL,
  merkle_root          bytea NOT NULL,
  prev_checkpoint_hash bytea NOT NULL,
  signature            bytea NOT NULL,
  anchor_uri           text  NOT NULL,
  anchored_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, seq_to)
);

-- 4. Create Audit Transaction Outbox Table
CREATE TABLE IF NOT EXISTS audit.outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id     uuid NOT NULL,
  event_id     uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  action       text NOT NULL,
  actor_id     uuid,
  actor_role   text,
  decision     text,
  resource_type text,
  resource_id  uuid,
  patient_ref  bytea,
  severity     smallint NOT NULL DEFAULT 0,
  envelope     jsonb NOT NULL,
  payload_enc  bytea,
  payload_mac  bytea,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_audit_outbox_unprocessed
  ON audit.outbox (created_at) WHERE processed_at IS NULL;

-- 5. Append-Only Tamper Resistance (Triggers & Functions)
CREATE OR REPLACE FUNCTION audit.deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit ledger is append-only (%)', TG_OP USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_tamper ON audit.ledger;
CREATE TRIGGER trg_audit_log_tamper
  BEFORE UPDATE OR DELETE ON audit.ledger
  FOR EACH STATEMENT EXECUTE FUNCTION audit.deny_mutation();

DROP TRIGGER IF EXISTS trg_audit_log_truncate ON audit.ledger;
CREATE TRIGGER trg_audit_log_truncate
  BEFORE TRUNCATE ON audit.ledger
  FOR EACH STATEMENT EXECUTE FUNCTION audit.deny_mutation();

DROP TRIGGER IF EXISTS trg_checkpoints_tamper ON audit.checkpoints;
CREATE TRIGGER trg_checkpoints_tamper
  BEFORE UPDATE OR DELETE ON audit.checkpoints
  FOR EACH STATEMENT EXECUTE FUNCTION audit.deny_mutation();

DROP TRIGGER IF EXISTS trg_checkpoints_truncate ON audit.checkpoints;
CREATE TRIGGER trg_checkpoints_truncate
  BEFORE TRUNCATE ON audit.checkpoints
  FOR EACH STATEMENT EXECUTE FUNCTION audit.deny_mutation();

-- Freeze legacy audit log: strictly read-only
DROP TRIGGER IF EXISTS trg_legacy_audit_freeze ON audit.legacy_audit_log;
CREATE OR REPLACE FUNCTION audit.deny_legacy_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'legacy audit log is frozen and read-only (%)', TG_OP USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_legacy_audit_freeze
  BEFORE UPDATE OR DELETE ON audit.legacy_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.deny_legacy_audit_mutation();

-- 6. Helper Functions for Chain Hashing & Serialized Ledger Insertion
CREATE OR REPLACE FUNCTION audit.genesis_hash(p_chain_id uuid)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT extensions.digest('GENESIS:' || p_chain_id::text, 'sha256');
$$;

CREATE OR REPLACE FUNCTION audit.append_ledger_entry(
  p_chain_id      uuid,
  p_event_id      uuid,
  p_occurred_at   timestamptz,
  p_actor_id      uuid,
  p_actor_role    text,
  p_action        text,
  p_decision      text,
  p_resource_type text,
  p_resource_id   uuid,
  p_patient_ref   bytea,
  p_severity      smallint,
  p_envelope      jsonb,
  p_payload_enc   bytea,
  p_payload_mac   bytea,
  p_signature     bytea DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, audit, extensions, app_private
AS $$
DECLARE
  v_seq bigint;
  v_prev_hash bytea;
  v_row_hash bytea;
  v_sig bytea := p_signature;
  v_hash_input bytea;
BEGIN
  -- Acquire chain-specific advisory transaction lock
  PERFORM pg_advisory_xact_lock(hashtextextended(p_chain_id::text, 0));

  -- Get next sequence and previous hash
  SELECT seq + 1, row_hash INTO v_seq, v_prev_hash
  FROM audit.ledger
  WHERE chain_id = p_chain_id
  ORDER BY seq DESC
  LIMIT 1;

  IF v_seq IS NULL THEN
    v_seq := 0;
    v_prev_hash := audit.genesis_hash(p_chain_id);
  END IF;

  -- Compute row_hash: SHA-256(prev_hash || chain_id || seq || envelope_canonical || payload_mac)
  v_hash_input := v_prev_hash
    || extensions.digest(p_chain_id::text, 'sha256')
    || extensions.digest(v_seq::text, 'sha256')
    || extensions.digest(p_envelope::text, 'sha256')
    || coalesce(p_payload_mac, '\x00'::bytea);

  v_row_hash := extensions.digest(v_hash_input, 'sha256');

  -- If signature was not provided by caller, generate internal cryptographic seal
  IF v_sig IS NULL THEN
    v_sig := extensions.hmac(v_row_hash, convert_to(p_chain_id::text || ':audit_sig', 'UTF8'), 'sha256');
  END IF;

  INSERT INTO audit.ledger (
    chain_id, seq, event_id, occurred_at, actor_id, actor_role, action, decision,
    resource_type, resource_id, patient_ref, severity, envelope, payload_enc,
    payload_mac, prev_hash, row_hash, signature
  ) VALUES (
    p_chain_id, v_seq, coalesce(p_event_id, gen_random_uuid()), coalesce(p_occurred_at, now()),
    p_actor_id, p_actor_role, p_action, p_decision, p_resource_type, p_resource_id,
    p_patient_ref, coalesce(p_severity, 0::smallint), p_envelope, p_payload_enc,
    p_payload_mac, v_prev_hash, v_row_hash, v_sig
  );

  RETURN v_seq;
END;
$$;
ALTER FUNCTION audit.append_ledger_entry OWNER TO postgres;

-- 7. Row Level Security & Policies
ALTER TABLE audit.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.checkpoints FORCE ROW LEVEL SECURITY;

-- Tenant auditors: see their own chain, all columns
DROP POLICY IF EXISTS tenant_auditor ON audit.ledger;
CREATE POLICY tenant_auditor ON audit.ledger FOR SELECT
  USING (
    app_private.app_role() = 'compliance_auditor'
    AND app_private.claims() ->> 'auditor_scope' = 'tenant'
    AND chain_id = (SELECT app_private.tenant_id())
  );

DROP POLICY IF EXISTS tenant_auditor_checkpoints ON audit.checkpoints;
CREATE POLICY tenant_auditor_checkpoints ON audit.checkpoints FOR SELECT
  USING (
    app_private.app_role() = 'compliance_auditor'
    AND app_private.claims() ->> 'auditor_scope' = 'tenant'
    AND chain_id = (SELECT app_private.tenant_id())
  );

-- Platform view owner: allowed to select all rows across all chains to generate platform metadata view
DROP POLICY IF EXISTS platform_meta_view ON audit.ledger;
CREATE POLICY platform_meta_view ON audit.ledger FOR SELECT TO audit_view_owner
  USING (true);

DROP POLICY IF EXISTS platform_meta_checkpoints ON audit.checkpoints;
CREATE POLICY platform_meta_checkpoints ON audit.checkpoints FOR SELECT TO audit_view_owner
  USING (true);

-- 8. Platform Metadata View (Omits patient_ref, envelope, payload_enc, payload_mac)
GRANT USAGE, CREATE ON SCHEMA audit TO audit_view_owner;
GRANT audit_view_owner TO postgres;

DROP VIEW IF EXISTS audit.v_ledger_platform CASCADE;
CREATE VIEW audit.v_ledger_platform AS
  SELECT chain_id, seq, event_id, occurred_at, actor_role, action, decision,
         resource_type, severity, row_hash, signature
  FROM audit.ledger;

ALTER VIEW audit.v_ledger_platform OWNER TO audit_view_owner;

-- Compatibility view in public schema
DROP VIEW IF EXISTS public.v_ledger_platform CASCADE;
CREATE VIEW public.v_ledger_platform WITH (security_invoker = true) AS
  SELECT * FROM audit.v_ledger_platform;

-- 9. Service Role Privileges
REVOKE ALL ON audit.ledger, audit.checkpoints, audit.outbox FROM PUBLIC;
GRANT USAGE ON SCHEMA audit TO svc_audit_writer, svc_audit_reader_tenant, svc_audit_reader_platform, audit_view_owner, authenticated;

-- svc_audit_writer has INSERT only
GRANT INSERT ON audit.ledger, audit.checkpoints, audit.outbox TO svc_audit_writer;

-- svc_audit_reader_tenant has SELECT on own tenant rows
GRANT SELECT ON audit.ledger, audit.checkpoints TO svc_audit_reader_tenant;

-- audit_view_owner has SELECT on audit.ledger and audit.checkpoints to materialize view
GRANT SELECT ON audit.ledger, audit.checkpoints TO audit_view_owner;

-- svc_audit_reader_platform has SELECT on v_ledger_platform only
GRANT SELECT ON audit.v_ledger_platform TO svc_audit_reader_platform;
GRANT SELECT ON public.v_ledger_platform TO authenticated;

-- Allow authenticated callers to invoke append_ledger_entry if authorized
GRANT EXECUTE ON FUNCTION audit.append_ledger_entry TO authenticated, svc_audit_writer;
GRANT EXECUTE ON FUNCTION audit.genesis_hash(uuid) TO authenticated, svc_audit_writer;

-- 10. Cutover Genesis Checkpoint Migration from Legacy Audit Log
-- For the platform chain and all existing tenants, seed genesis records
DO $$
DECLARE
  v_tenant record;
  v_platform_sentinel uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  -- Platform Chain Genesis
  IF NOT EXISTS (SELECT 1 FROM audit.ledger WHERE chain_id = v_platform_sentinel AND seq = 0) THEN
    PERFORM audit.append_ledger_entry(
      v_platform_sentinel,
      '00000000-0000-0000-0000-000000000001'::uuid,
      now(),
      NULL,
      'system',
      'CUTOVER_GENESIS',
      'ALLOW',
      'audit_ledger',
      v_platform_sentinel,
      NULL,
      0::smallint,
      jsonb_build_object('genesis', true, 'chain', 'platform', 'cutover_date', now()),
      NULL,
      extensions.digest('CUTOVER_PLATFORM_PAYLOAD', 'sha256')
    );
  END IF;

  -- Per-tenant Chain Genesis for existing tenants
  FOR v_tenant IN SELECT id, name FROM iam.tenants LOOP
    IF NOT EXISTS (SELECT 1 FROM audit.ledger WHERE chain_id = v_tenant.id AND seq = 0) THEN
      PERFORM audit.append_ledger_entry(
        v_tenant.id,
        gen_random_uuid(),
        now(),
        NULL,
        'system',
        'CUTOVER_GENESIS',
        'ALLOW',
        'audit_ledger',
        v_tenant.id,
        NULL,
        0::smallint,
        jsonb_build_object('genesis', true, 'tenant_id', v_tenant.id, 'tenant_name', v_tenant.name, 'cutover_date', now()),
        NULL,
        extensions.digest('CUTOVER_TENANT_PAYLOAD:' || v_tenant.id::text, 'sha256')
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
