-- NutriScore CAD Blueprint Phase 4 Rollback
-- Rolls back 20261101030000_clinical_core_and_abac.sql

BEGIN;

-- 1. Drop public views
DROP VIEW IF EXISTS public.published_profiles;
DROP VIEW IF EXISTS public.retention_policies;
DROP VIEW IF EXISTS public.emergency_grants;
DROP VIEW IF EXISTS public.tag_vocabulary;
DROP VIEW IF EXISTS public.dietary_tags;
DROP VIEW IF EXISTS public.clinical_advice;
DROP VIEW IF EXISTS public.clinical_records;
DROP VIEW IF EXISTS public.treatment_relationships;
DROP VIEW IF EXISTS public.patients;
DROP VIEW IF EXISTS public.consent_records;

-- 2. Restore legacy target_bundles policy
DROP POLICY IF EXISTS clinician_write_target_bundles ON clinical.target_bundles;
CREATE POLICY clinician_write_target_bundles ON clinical.target_bundles
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT app_private.tenant_id())
    AND app_private.app_role() IN ('writing_clinician', 'tenant_admin', 'super_admin')
  )
  WITH CHECK (
    tenant_id = (SELECT app_private.tenant_id())
    AND app_private.app_role() IN ('writing_clinician', 'tenant_admin', 'super_admin')
  );

-- 3. Drop tables in dependency order (CASCADE removes dependent policies and constraints)
DROP TABLE IF EXISTS clinical.published_profiles CASCADE;
DROP TABLE IF EXISTS clinical.retention_policies CASCADE;
DROP TABLE IF EXISTS clinical.emergency_grants CASCADE;
DROP TABLE IF EXISTS clinical.clinical_advice CASCADE;
DROP TABLE IF EXISTS clinical.clinical_records CASCADE;
DROP TABLE IF EXISTS clinical.dietary_tags CASCADE;
DROP TABLE IF EXISTS clinical.tag_vocabulary CASCADE;
DROP TABLE IF EXISTS clinical.treatment_relationships CASCADE;
DROP TABLE IF EXISTS clinical.patients CASCADE;

-- 4. Drop break-glass, helper, and trigger functions
DROP FUNCTION IF EXISTS clinical.review_break_glass(uuid, text, text);
DROP FUNCTION IF EXISTS clinical.revoke_break_glass(uuid, text);
DROP FUNCTION IF EXISTS clinical.request_break_glass(uuid, uuid, text, bytea, int);
DROP FUNCTION IF EXISTS app_private.has_relationship(uuid, boolean) CASCADE;
DROP FUNCTION IF EXISTS clinical.constraints_valid(jsonb) CASCADE;
DROP FUNCTION IF EXISTS clinical.deny_clinical_records_mutation() CASCADE;
DROP TRIGGER IF EXISTS trg_seed_tenant_retention_policies ON iam.tenants;
DROP FUNCTION IF EXISTS clinical.seed_tenant_retention_policies() CASCADE;

-- 5. Revert consent_records policies and modifications
DROP POLICY IF EXISTS admin_consent_select ON clinical.consent_records;
DROP POLICY IF EXISTS auditor_consent_select ON clinical.consent_records;
DROP POLICY IF EXISTS clinician_consent_select ON clinical.consent_records;
DROP POLICY IF EXISTS patient_consent_all ON clinical.consent_records;

ALTER TABLE clinical.consent_records
  DROP COLUMN IF EXISTS patient_id,
  DROP COLUMN IF EXISTS lawful_basis,
  DROP COLUMN IF EXISTS policy_version,
  DROP COLUMN IF EXISTS withdrawn_at;

CREATE VIEW public.consent_records WITH (security_invoker = true) AS
  SELECT * FROM clinical.consent_records;

COMMIT;
