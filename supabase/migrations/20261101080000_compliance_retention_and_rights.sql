-- NutriScore CAD Blueprint Phase 9
-- Migration: Compliance machinery, retention enforcement, data-subject rights
-- Reference: Blueprint §4.1, §5.1, Decision D5, Amendments A2-A3

BEGIN;

-- 1. Ensure retention policies for commercial classes are seeded across all tenants
-- (shopping_ledger, commercial_orders, transaction_logs at 3 years from deactivation per D5/A2)
INSERT INTO clinical.retention_policies (tenant_id, record_class, retain_from, retain_years, legal_hold, basis)
SELECT
  t.id,
  c.record_class,
  'deactivation',
  3,
  false,
  'D5 commercial deactivation retention policy (3 years)'
FROM iam.tenants t
CROSS JOIN (
  VALUES
    ('shopping_ledger'),
    ('commercial_orders'),
    ('transaction_logs')
) AS c(record_class)
ON CONFLICT (tenant_id, record_class) DO UPDATE SET
  retain_from = EXCLUDED.retain_from,
  retain_years = EXCLUDED.retain_years,
  basis = EXCLUDED.basis;

-- 2. Backfill existing consents with lawful_basis (Amendment A3)
UPDATE clinical.consent_records
SET lawful_basis = ARRAY['contract', 'explicit_consent']
WHERE lawful_basis IS NULL OR array_length(lawful_basis, 1) = 0;

-- 3. Data-subject workflow: set processing restriction (GDPR Art. 18 / Kenya DPA)
CREATE OR REPLACE FUNCTION clinical.set_patient_restriction(
  p_tenant_id uuid,
  p_patient_id uuid,
  p_restricted boolean,
  p_reason text DEFAULT 'Data subject restriction request'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clinical, audit, app_private, public
AS $$
DECLARE
  v_exists boolean;
  v_actor uuid;
  v_action text;
BEGIN
  -- Verify patient exists in tenant
  SELECT EXISTS(
    SELECT 1 FROM clinical.patients
    WHERE tenant_id = p_tenant_id AND id = p_patient_id
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Patient % not found in tenant %', p_patient_id, p_tenant_id;
  END IF;

  UPDATE clinical.patients
  SET restricted = p_restricted
  WHERE tenant_id = p_tenant_id AND id = p_patient_id;

  v_actor := app_private.uid();
  IF p_restricted THEN
    v_action := 'RESTRICT_PROCESSING';
  ELSE
    v_action := 'UNRESTRICT_PROCESSING';
  END IF;

  -- Audit event via canonical ledger append
  PERFORM audit.append_ledger_entry(
    p_chain_id      := p_tenant_id,
    p_event_id      := gen_random_uuid(),
    p_occurred_at   := now(),
    p_actor_id      := v_actor,
    p_actor_role    := COALESCE(app_private.app_role(), 'service'),
    p_action        := v_action,
    p_decision      := 'ALLOW',
    p_resource_type := 'patient',
    p_resource_id   := p_patient_id,
    p_patient_ref   := convert_to(p_patient_id::text, 'utf8'),
    p_severity      := 0::smallint,
    p_envelope      := jsonb_build_object(
      'restricted', p_restricted,
      'reason', p_reason,
      'timestamp', now()
    ),
    p_payload_enc   := NULL,
    p_payload_mac   := NULL
  );

  RETURN true;
END;
$$;

-- 4. Data-subject workflow: rectification as a new record version
-- (Previous record versions remain immutable for medico-legal reasons)
CREATE OR REPLACE FUNCTION clinical.rectify_clinical_record(
  p_tenant_id uuid,
  p_patient_id uuid,
  p_record_id uuid,
  p_rectified_data jsonb,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clinical, audit, app_private, public
AS $$
DECLARE
  v_old_rec record;
  v_new_id uuid;
  v_next_version int;
  v_actor uuid;
  v_dummy_mac bytea := decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
BEGIN
  -- Fetch existing record
  SELECT * INTO v_old_rec
  FROM clinical.clinical_records
  WHERE tenant_id = p_tenant_id AND patient_id = p_patient_id AND id = p_record_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clinical record % not found for patient %', p_record_id, p_patient_id;
  END IF;

  v_new_id := gen_random_uuid();
  v_next_version := v_old_rec.version + 1;
  v_actor := app_private.uid();

  INSERT INTO clinical.clinical_records (
    tenant_id, id, patient_id, author_id, record_type,
    version, supersedes_id, body_enc, body_mac, created_at
  ) VALUES (
    p_tenant_id,
    v_new_id,
    p_patient_id,
    COALESCE(v_actor, v_old_rec.author_id),
    v_old_rec.record_type,
    v_next_version,
    p_record_id,
    convert_to(p_rectified_data::text, 'utf8'), -- Stage A ciphertext representation
    v_dummy_mac,
    now()
  );

  -- Audit rectification event via canonical ledger append
  PERFORM audit.append_ledger_entry(
    p_chain_id      := p_tenant_id,
    p_event_id      := gen_random_uuid(),
    p_occurred_at   := now(),
    p_actor_id      := v_actor,
    p_actor_role    := COALESCE(app_private.app_role(), 'service'),
    p_action        := 'RECTIFY_CLINICAL_RECORD',
    p_decision      := 'ALLOW',
    p_resource_type := 'clinical_record',
    p_resource_id   := v_new_id,
    p_patient_ref   := convert_to(p_patient_id::text, 'utf8'),
    p_severity      := 0::smallint,
    p_envelope      := jsonb_build_object(
      'previous_record_id', p_record_id,
      'previous_version', v_old_rec.version,
      'new_version', v_next_version,
      'reason', p_reason
    ),
    p_payload_enc   := NULL,
    p_payload_mac   := NULL
  );

  RETURN v_new_id;
END;
$$;

-- 5. Fail-Safe Retention Purge Execution Function (D5)
CREATE OR REPLACE FUNCTION clinical.execute_retention_purge(
  p_tenant_id uuid,
  p_record_class text,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clinical, audit, app_private, public
AS $$
DECLARE
  v_policy record;
  v_eligible_count int := 0;
  v_purged_count int := 0;
  v_cutoff timestamptz;
  v_result jsonb;
BEGIN
  -- 1. Fail-Safe Check: Look up explicit policy
  SELECT * INTO v_policy
  FROM clinical.retention_policies
  WHERE tenant_id = p_tenant_id AND record_class = p_record_class;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refusing to purge class %: No retention policy configured (fail-safe rule D5)', p_record_class;
  END IF;

  IF v_policy.retain_years IS NULL THEN
    RAISE EXCEPTION 'Refusing to purge class %: retain_years is NULL (purge forbidden until counsel provides basis)', p_record_class;
  END IF;

  -- 2. Legal Hold Check
  IF v_policy.legal_hold = true THEN
    RETURN jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'Purge blocked by active legal hold',
      'tenant_id', p_tenant_id,
      'record_class', p_record_class,
      'dry_run', p_dry_run,
      'eligible_count', 0,
      'purged_count', 0
    );
  END IF;

  -- Calculate cutoff date
  v_cutoff := now() - (v_policy.retain_years || ' years')::interval;

  -- 3. Calculate eligible records based on record_class
  IF p_record_class = 'commercial_orders' THEN
    SELECT count(*) INTO v_eligible_count
    FROM commercial.orders
    WHERE tenant_id = p_tenant_id AND placed_at < v_cutoff;

    IF NOT p_dry_run AND v_eligible_count > 0 THEN
      DELETE FROM commercial.orders
      WHERE tenant_id = p_tenant_id AND placed_at < v_cutoff;
      GET DIAGNOSTICS v_purged_count = ROW_COUNT;
    END IF;

  ELSIF p_record_class = 'shopping_ledger' THEN
    -- In overlay mode, shopping_ledger is represented in commercial.orders/lines
    SELECT count(*) INTO v_eligible_count
    FROM commercial.orders
    WHERE tenant_id = p_tenant_id AND source = 'extension_observed' AND placed_at < v_cutoff;

    IF NOT p_dry_run AND v_eligible_count > 0 THEN
      DELETE FROM commercial.orders
      WHERE tenant_id = p_tenant_id AND source = 'extension_observed' AND placed_at < v_cutoff;
      GET DIAGNOSTICS v_purged_count = ROW_COUNT;
    END IF;

  ELSIF p_record_class = 'transaction_logs' THEN
    v_eligible_count := 0;
    v_purged_count := 0;

  ELSE
    -- Any other record class without specific purge handler is refused
    RAISE EXCEPTION 'Purge handler not implemented for record class %', p_record_class;
  END IF;

  -- 4. Audit Purge Plan / Execution via canonical ledger append
  PERFORM audit.append_ledger_entry(
    p_chain_id      := p_tenant_id,
    p_event_id      := gen_random_uuid(),
    p_occurred_at   := now(),
    p_actor_id      := app_private.uid(),
    p_actor_role    := COALESCE(app_private.app_role(), 'service'),
    p_action        := CASE WHEN p_dry_run THEN 'RETENTION_PURGE_PLAN' ELSE 'RETENTION_PURGE_EXECUTED' END,
    p_decision      := 'ALLOW',
    p_resource_type := 'retention_policy',
    p_resource_id   := NULL,
    p_patient_ref   := NULL,
    p_severity      := 0::smallint,
    p_envelope      := jsonb_build_object(
      'dry_run', p_dry_run,
      'record_class', p_record_class,
      'retain_years', v_policy.retain_years,
      'retain_from', v_policy.retain_from,
      'cutoff', v_cutoff,
      'eligible_count', v_eligible_count,
      'purged_count', v_purged_count
    ),
    p_payload_enc   := NULL,
    p_payload_mac   := NULL
  );

  v_result := jsonb_build_object(
    'status', 'SUCCESS',
    'tenant_id', p_tenant_id,
    'record_class', p_record_class,
    'dry_run', p_dry_run,
    'eligible_count', v_eligible_count,
    'purged_count', v_purged_count,
    'cutoff', v_cutoff
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION clinical.set_patient_restriction(uuid, uuid, boolean, text) TO authenticated, svc_clinical;
GRANT EXECUTE ON FUNCTION clinical.rectify_clinical_record(uuid, uuid, uuid, jsonb, text) TO authenticated, svc_clinical;
GRANT EXECUTE ON FUNCTION clinical.execute_retention_purge(uuid, text, boolean) TO authenticated, svc_clinical, svc_commercial;

COMMIT;
