-- NutriScore CAD Blueprint Phase 6
-- Field-Level Encryption, Patient Keys, Crypto-Shredding, Blind Indexing,
-- Keyed Commitments, and Allowlisted Semantic Projection (Stage A Outbox)
-- Reference: Blueprint §4.1, §4.2, Amendment A5, A7

BEGIN;

-- 1. Create Patient Keys Table
CREATE TABLE IF NOT EXISTS clinical.patient_keys (
  tenant_id     uuid        NOT NULL,
  patient_id    uuid        NOT NULL,
  key_version   int         NOT NULL DEFAULT 1,
  dek_wrapped   bytea       NOT NULL,
  destroyed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, patient_id, key_version),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES iam.tenants (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_patient_keys_lookup
  ON clinical.patient_keys (tenant_id, patient_id)
  WHERE destroyed_at IS NULL;

-- 2. Crypto-Shredding Function
CREATE OR REPLACE FUNCTION clinical.crypto_shred_patient(
  p_tenant_id uuid,
  p_patient_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, clinical, audit, extensions, app_private
AS $$
DECLARE
  v_count int;
BEGIN
  -- Overwrite wrapped key material with 61 zero bytes and record destruction timestamp
  UPDATE clinical.patient_keys
  SET dek_wrapped = '\x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'::bytea,
      destroyed_at = now()
  WHERE tenant_id = p_tenant_id
    AND patient_id = p_patient_id
    AND destroyed_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Emit audit event to outbox
  IF v_count > 0 THEN
    INSERT INTO audit.outbox (
      chain_id, action, decision, resource_type, resource_id,
      severity, envelope
    ) VALUES (
      p_tenant_id,
      'PATIENT_CRYPTO_SHRED',
      'ALLOW',
      'patient_keys',
      p_patient_id,
      1::smallint,
      jsonb_build_object(
        'patient_id', p_patient_id,
        'tenant_id', p_tenant_id,
        'shredded_at', now()
      )
    );
  END IF;

  RETURN v_count > 0;
END;
$$;
ALTER FUNCTION clinical.crypto_shred_patient OWNER TO postgres;

-- 3. SQL Helpers for Blind Indexes and Keyed Commitments
CREATE OR REPLACE FUNCTION clinical.derive_tenant_bidx_key(p_tenant_id uuid)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT extensions.hmac(
    convert_to(p_tenant_id::text, 'UTF8'),
    convert_to('CAD_STAGE_A_BIDX_SALT_V1', 'UTF8'),
    'sha256'
  );
$$;

CREATE OR REPLACE FUNCTION clinical.derive_tenant_mac_key(p_tenant_id uuid)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT extensions.hmac(
    convert_to(p_tenant_id::text, 'UTF8'),
    convert_to('CAD_STAGE_A_MAC_SALT_V1', 'UTF8'),
    'sha256'
  );
$$;

CREATE OR REPLACE FUNCTION clinical.blind_index(p_tenant_id uuid, p_value text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    ELSE extensions.hmac(
      convert_to(lower(trim(p_value)), 'UTF8'),
      clinical.derive_tenant_bidx_key(p_tenant_id),
      'sha256'
    )
  END;
$$;

CREATE OR REPLACE FUNCTION clinical.keyed_mac(p_tenant_id uuid, p_data text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_data IS NULL THEN NULL
    ELSE extensions.hmac(
      convert_to(p_data, 'UTF8'),
      clinical.derive_tenant_mac_key(p_tenant_id),
      'sha256'
    )
  END;
$$;

-- 4. Exchange Schema Semantic Projection and Outbox
CREATE TABLE IF NOT EXISTS exchange.projection (
  tenant_id      uuid        NOT NULL,
  profile_id     uuid        NOT NULL,
  patient_id     uuid        NOT NULL,
  bundle_version int         NOT NULL,
  constraints    jsonb       NOT NULL CHECK (clinical.constraints_valid(constraints)),
  published_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, profile_id),
  FOREIGN KEY (tenant_id) REFERENCES iam.tenants (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exchange_projection_patient
  ON exchange.projection (tenant_id, patient_id);

CREATE TABLE IF NOT EXISTS exchange.projection_outbox (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     text        NOT NULL CHECK (event_type IN ('UPSERT', 'DELETE')),
  tenant_id      uuid        NOT NULL,
  profile_id     uuid        NOT NULL,
  patient_id     uuid,
  bundle_version int,
  constraints    jsonb,
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_exchange_projection_outbox_unprocessed
  ON exchange.projection_outbox (created_at)
  WHERE processed_at IS NULL;

-- 5. Outbox Trigger Syncing clinical.published_profiles to exchange.projection
CREATE OR REPLACE FUNCTION clinical.trg_sync_published_profile_to_exchange()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, clinical, exchange, app_private
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM exchange.projection
    WHERE tenant_id = OLD.tenant_id AND profile_id = OLD.profile_id;

    INSERT INTO exchange.projection_outbox (
      event_type, tenant_id, profile_id, patient_id, bundle_version, published_at
    ) VALUES (
      'DELETE', OLD.tenant_id, OLD.profile_id, OLD.patient_id, OLD.bundle_version, now()
    );

    RETURN OLD;
  END IF;

  IF NEW.status = 'published' THEN
    IF NOT clinical.constraints_valid(NEW.constraints) THEN
      RAISE EXCEPTION 'cannot project profile with invalid constraints' USING ERRCODE = '23514';
    END IF;

    -- Upsert six allowlisted columns only (A5 / Blueprint §2.6)
    INSERT INTO exchange.projection (
      tenant_id, profile_id, patient_id, bundle_version, constraints, published_at
    ) VALUES (
      NEW.tenant_id, NEW.profile_id, NEW.patient_id, NEW.bundle_version, NEW.constraints, NEW.published_at
    )
    ON CONFLICT (tenant_id, profile_id) DO UPDATE SET
      patient_id = EXCLUDED.patient_id,
      bundle_version = EXCLUDED.bundle_version,
      constraints = EXCLUDED.constraints,
      published_at = EXCLUDED.published_at;

    INSERT INTO exchange.projection_outbox (
      event_type, tenant_id, profile_id, patient_id, bundle_version, constraints, published_at
    ) VALUES (
      'UPSERT', NEW.tenant_id, NEW.profile_id, NEW.patient_id, NEW.bundle_version, NEW.constraints, NEW.published_at
    );
  ELSE
    -- When withdrawn, delete from projected store
    DELETE FROM exchange.projection
    WHERE tenant_id = NEW.tenant_id AND profile_id = NEW.profile_id;

    INSERT INTO exchange.projection_outbox (
      event_type, tenant_id, profile_id, patient_id, bundle_version, published_at
    ) VALUES (
      'DELETE', NEW.tenant_id, NEW.profile_id, NEW.patient_id, NEW.bundle_version, now()
    );
  END IF;

  RETURN NEW;
END;
$$;
ALTER FUNCTION clinical.trg_sync_published_profile_to_exchange OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_published_profiles_exchange_sync ON clinical.published_profiles;
CREATE TRIGGER trg_published_profiles_exchange_sync
  AFTER INSERT OR UPDATE OR DELETE ON clinical.published_profiles
  FOR EACH ROW
  EXECUTE FUNCTION clinical.trg_sync_published_profile_to_exchange();

-- 6. Restrictive Tenant Wall Application
SELECT app_private.apply_tenant_wall('clinical.patient_keys');
SELECT app_private.apply_tenant_wall('exchange.projection');

-- 7. RLS Policies on Patient Keys and Projection
DROP POLICY IF EXISTS clinician_patient_keys_select ON clinical.patient_keys;
CREATE POLICY clinician_patient_keys_select ON clinical.patient_keys FOR SELECT TO authenticated
  USING (
    app_private.app_role() IN ('writing_clinician', 'viewing_dietician')
    AND (SELECT app_private.has_relationship(patient_keys.patient_id))
  );

DROP POLICY IF EXISTS clinician_patient_keys_insert ON clinical.patient_keys;
CREATE POLICY clinician_patient_keys_insert ON clinical.patient_keys FOR INSERT TO authenticated
  WITH CHECK (
    app_private.app_role() = 'writing_clinician'
  );

DROP POLICY IF EXISTS admin_patient_keys_update ON clinical.patient_keys;
CREATE POLICY admin_patient_keys_update ON clinical.patient_keys FOR UPDATE TO authenticated
  USING (
    app_private.app_role() = 'tenant_admin'
  );

DROP POLICY IF EXISTS exchange_projection_select ON exchange.projection;
CREATE POLICY exchange_projection_select ON exchange.projection FOR SELECT TO authenticated
  USING (
    (app_private.app_role() = 'patient' AND patient_id = (
      SELECT p.id FROM clinical.patients p
      WHERE p.tenant_id = exchange.projection.tenant_id AND p.user_id = (SELECT app_private.uid())
    ))
    OR app_private.app_role() IN ('writing_clinician', 'viewing_dietician', 'compliance_auditor')
  );

-- 8. Cross-Schema Privileges and Boundary Enforcement (Amendment A5)
REVOKE ALL ON ALL TABLES IN SCHEMA clinical, iam FROM svc_exchange, svc_commercial;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA clinical, iam FROM svc_exchange, svc_commercial;
REVOKE USAGE ON SCHEMA clinical, iam FROM svc_exchange, svc_commercial;

REVOKE ALL ON ALL TABLES IN SCHEMA exchange FROM svc_commercial;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA exchange FROM svc_commercial;
REVOKE USAGE ON SCHEMA exchange FROM svc_commercial;

GRANT USAGE ON SCHEMA exchange TO svc_exchange;
GRANT SELECT ON exchange.projection TO svc_exchange;
GRANT SELECT ON exchange.projection_outbox TO svc_exchange;

-- Compatibility View in public schema
DROP VIEW IF EXISTS public.exchange_projection CASCADE;
CREATE VIEW public.exchange_projection WITH (security_invoker = true) AS
  SELECT * FROM exchange.projection;
GRANT SELECT ON public.exchange_projection TO authenticated;

COMMIT;
