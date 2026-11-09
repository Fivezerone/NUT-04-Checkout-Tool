-- NutriScore CAD Blueprint Phase 7
-- Token Revocations, Pairwise Epoch Alias Map, Consent Withdrawal Notices,
-- and Commercial-Side Verification Helpers
-- Reference: Blueprint §3.3–§3.6, Amendment A5, A7

BEGIN;

-- 1. Token Revocations Table
CREATE TABLE IF NOT EXISTS exchange.revocations (
  jti          uuid        PRIMARY KEY,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz NOT NULL DEFAULT now(),
  reason       text        NOT NULL DEFAULT 'consent_withdrawn'
);

CREATE INDEX IF NOT EXISTS idx_exchange_revocations_exp
  ON exchange.revocations (expires_at);

ALTER TABLE exchange.revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.revocations FORCE ROW LEVEL SECURITY;

-- Policy: authenticated callers can query if a token is revoked
DROP POLICY IF EXISTS exchange_revocations_select ON exchange.revocations;
CREATE POLICY exchange_revocations_select ON exchange.revocations FOR SELECT TO authenticated
  USING (true);

-- 2. Pairwise Epoch Alias Map
CREATE TABLE IF NOT EXISTS exchange.alias_map (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  patient_id   uuid        NOT NULL,
  epoch        text        NOT NULL,
  alias        text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, patient_id, epoch),
  FOREIGN KEY (tenant_id) REFERENCES iam.tenants (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exchange_alias_lookup
  ON exchange.alias_map (tenant_id, patient_id);

-- Restrictive tenant wall
SELECT app_private.apply_tenant_wall('exchange.alias_map');

-- 3. Revocation and Alias Erasure Functions
CREATE OR REPLACE FUNCTION exchange.is_token_revoked(p_jti uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, exchange
AS $$
  SELECT EXISTS (
    SELECT 1 FROM exchange.revocations
    WHERE jti = p_jti AND expires_at > now()
  );
$$;
ALTER FUNCTION exchange.is_token_revoked OWNER TO postgres;

CREATE OR REPLACE FUNCTION exchange.revoke_token(
  p_jti uuid,
  p_expires_at timestamptz,
  p_reason text DEFAULT 'consent_withdrawn'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, exchange
AS $$
BEGIN
  INSERT INTO exchange.revocations (jti, expires_at, reason)
  VALUES (p_jti, p_expires_at, coalesce(p_reason, 'consent_withdrawn'))
  ON CONFLICT (jti) DO NOTHING;
END;
$$;
ALTER FUNCTION exchange.revoke_token OWNER TO postgres;

CREATE OR REPLACE FUNCTION exchange.erase_alias(
  p_tenant_id uuid,
  p_patient_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, exchange
AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM exchange.alias_map
  WHERE tenant_id = p_tenant_id AND patient_id = p_patient_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
ALTER FUNCTION exchange.erase_alias OWNER TO postgres;

-- 4. Consent Withdrawal Trigger: Erases aliases & audits revocation
CREATE OR REPLACE FUNCTION clinical.trg_consent_withdrawal_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, clinical, exchange, audit, app_private
AS $$
BEGIN
  IF NEW.withdrawn_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.withdrawn_at IS NULL) THEN
    -- Erase all pairwise epoch aliases for this patient
    PERFORM exchange.erase_alias(NEW.tenant_id, NEW.patient_id);

    -- Log consent withdrawal audit event
    INSERT INTO audit.outbox (
      chain_id, action, decision, resource_type, resource_id,
      severity, envelope
    ) VALUES (
      NEW.tenant_id,
      'CONSENT_WITHDRAWN',
      'ALLOW',
      'consent_records',
      NEW.id,
      1::smallint,
      jsonb_build_object(
        'patient_id', NEW.patient_id,
        'tenant_id', NEW.tenant_id,
        'purpose', NEW.purpose,
        'withdrawn_at', NEW.withdrawn_at
      )
    );
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION clinical.trg_consent_withdrawal_notice OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_consent_withdrawal ON clinical.consent_records;
CREATE TRIGGER trg_consent_withdrawal
  AFTER INSERT OR UPDATE ON clinical.consent_records
  FOR EACH ROW
  EXECUTE FUNCTION clinical.trg_consent_withdrawal_notice();

-- 5. Service Role Privileges (Amendment A5)
GRANT USAGE ON SCHEMA exchange TO svc_exchange, svc_commercial;
GRANT SELECT, INSERT ON exchange.revocations TO svc_exchange;
GRANT SELECT ON exchange.revocations TO svc_commercial;
GRANT SELECT, INSERT, DELETE ON exchange.alias_map TO svc_exchange;

GRANT EXECUTE ON FUNCTION exchange.is_token_revoked TO svc_exchange, svc_commercial, authenticated;
GRANT EXECUTE ON FUNCTION exchange.revoke_token TO svc_exchange;
GRANT EXECUTE ON FUNCTION exchange.erase_alias TO svc_exchange;

-- Compatibility View
DROP VIEW IF EXISTS public.exchange_revocations CASCADE;
CREATE VIEW public.exchange_revocations WITH (security_invoker = true) AS
  SELECT jti, expires_at, revoked_at FROM exchange.revocations;
GRANT SELECT ON public.exchange_revocations TO authenticated;

COMMIT;
