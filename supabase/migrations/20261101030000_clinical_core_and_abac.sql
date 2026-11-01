-- NutriScore CAD Blueprint Phase 4
-- Clinical Core, Treatment Relationships, ABAC Helpers, Break-Glass, and Retention Policies.
-- Local stack only; do not apply to the hosted Supabase project outside the Phase 10 operational checklist.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Patients (PHI-2 / Directory)
CREATE TABLE IF NOT EXISTS clinical.patients (
  tenant_id        uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id          uuid,                                   -- patient login (Keycloak/Supabase sub)
  full_name_enc    bytea NOT NULL,
  phone_enc        bytea,
  email_enc        bytea,
  email_bidx       bytea,
  dob_enc          bytea,
  restricted       boolean NOT NULL DEFAULT false,         -- processing restriction under rights request
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, email_bidx)
);

CREATE INDEX IF NOT EXISTS idx_patients_tenant_user
  ON clinical.patients (tenant_id, user_id);

-- 2. Treatment Relationships (ABAC Foundation)
CREATE TABLE IF NOT EXISTS clinical.treatment_relationships (
  tenant_id  uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  staff_id   uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('primary','covering','referral')),
  can_write  boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to   timestamptz,                                 -- NULL = open-ended
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, staff_id)   REFERENCES iam.members (tenant_id, user_id) ON DELETE CASCADE,
  CHECK (kind <> 'primary' OR can_write),
  -- Exactly one primary clinician per patient at any moment
  EXCLUDE USING gist (
    tenant_id WITH =,
    patient_id WITH =,
    tstzrange(valid_from, valid_to) WITH &&
  ) WHERE (kind = 'primary')
);

CREATE INDEX IF NOT EXISTS idx_treatment_relationships_lookup
  ON clinical.treatment_relationships (tenant_id, staff_id, patient_id)
  WHERE valid_to IS NULL;

-- 3. Tag Vocabulary (Controlled Vocabulary)
CREATE TABLE IF NOT EXISTS clinical.tag_vocabulary (
  tag         text PRIMARY KEY,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO clinical.tag_vocabulary (tag, description) VALUES
  ('low_sodium', 'Low sodium / salt controlled diet'),
  ('low_sugar', 'Low sugar / carbohydrate managed diet'),
  ('high_fibre', 'High dietary fibre content'),
  ('low_saturated_fat', 'Low saturated fat / cardiac support'),
  ('calorie_controlled', 'Energy / calorie intake managed'),
  ('gluten_free', 'Certified gluten-free food selection'),
  ('vegetarian', 'Vegetarian dietary preference'),
  ('vegan', 'Plant-based / vegan diet'),
  ('renal_support', 'Controlled mineral / protein intake support')
ON CONFLICT (tag) DO NOTHING;

-- 4. Dietary Tags (Dietician-Owned)
CREATE TABLE IF NOT EXISTS clinical.dietary_tags (
  tenant_id  uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  author_id  uuid NOT NULL,
  tag        text NOT NULL REFERENCES clinical.tag_vocabulary (tag),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to   timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, author_id)  REFERENCES iam.members (tenant_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dietary_tags_patient
  ON clinical.dietary_tags (tenant_id, patient_id);

-- 5. Clinical Records (Append-Only Versions, PHI-1)
CREATE TABLE IF NOT EXISTS clinical.clinical_records (
  tenant_id     uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL,
  author_id     uuid NOT NULL,
  record_type   text NOT NULL CHECK (record_type IN ('diagnosis','assessment','note','lab_summary')),
  version       int  NOT NULL DEFAULT 1,
  supersedes_id uuid,
  body_enc      bytea NOT NULL,
  coded_enc     bytea,
  body_mac      bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)    REFERENCES clinical.patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES clinical.clinical_records (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_clinical_records_patient
  ON clinical.clinical_records (tenant_id, patient_id);

-- Append-only enforcement trigger: prevent UPDATE, DELETE, TRUNCATE on clinical_records
CREATE OR REPLACE FUNCTION clinical.deny_clinical_records_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'clinical.clinical_records is append-only (%). New versions must be inserted.', TG_OP
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_clinical_records_deny_mutation ON clinical.clinical_records;
CREATE TRIGGER trg_clinical_records_deny_mutation
  BEFORE UPDATE OR DELETE ON clinical.clinical_records
  FOR EACH STATEMENT EXECUTE FUNCTION clinical.deny_clinical_records_mutation();

DROP TRIGGER IF EXISTS trg_clinical_records_deny_truncate ON clinical.clinical_records;
CREATE TRIGGER trg_clinical_records_deny_truncate
  BEFORE TRUNCATE ON clinical.clinical_records
  FOR EACH STATEMENT EXECUTE FUNCTION clinical.deny_clinical_records_mutation();

-- 6. Clinical Advice (PHI-1)
CREATE TABLE IF NOT EXISTS clinical.clinical_advice (
  tenant_id      uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL,
  author_id      uuid NOT NULL,
  status         text NOT NULL CHECK (status IN ('draft','published','withdrawn')),
  body_enc       bytea NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  version        int NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, author_id)  REFERENCES iam.members (tenant_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clinical_advice_patient
  ON clinical.clinical_advice (tenant_id, patient_id, status);

-- 7. Consent Records (A3: lawful_basis array)
-- Reconcile / ensure columns for clinical.consent_records
ALTER TABLE clinical.consent_records
  ADD COLUMN IF NOT EXISTS patient_id uuid,
  ADD COLUMN IF NOT EXISTS lawful_basis text[] NOT NULL DEFAULT ARRAY['contract', 'explicit_consent'],
  ADD COLUMN IF NOT EXISTS policy_version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;

-- Make legacy patient_ref column nullable so modern patient_id can be used directly
ALTER TABLE clinical.consent_records ALTER COLUMN patient_ref DROP NOT NULL;
ALTER TABLE clinical.consent_records DROP CONSTRAINT IF EXISTS uq_patient_tenant_purpose;

-- Drop legacy check constraints if present so arbitrary purposes like dietary_profile_sharing are supported
ALTER TABLE clinical.consent_records DROP CONSTRAINT IF EXISTS consent_records_purpose_check;
ALTER TABLE clinical.consent_records DROP CONSTRAINT IF EXISTS consent_records_status_check;

CREATE INDEX IF NOT EXISTS idx_consent_records_patient_purpose
  ON clinical.consent_records (tenant_id, patient_id, purpose);

-- 8. Emergency Grants (Break-Glass: Read-Only, <= 24 hours)
CREATE TABLE IF NOT EXISTS clinical.emergency_grants (
  tenant_id    uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id   uuid NOT NULL,
  grantee_id   uuid NOT NULL,
  granted_by   uuid NOT NULL,
  incident_no  text NOT NULL,
  reason_enc   bytea NOT NULL,
  starts_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  review_state text NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','reviewed','escalated')),
  PRIMARY KEY (tenant_id, id),
  CHECK (expires_at <= starts_at + interval '24 hours'),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, grantee_id) REFERENCES iam.members (tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, granted_by) REFERENCES iam.members (tenant_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_emergency_grants_lookup
  ON clinical.emergency_grants (tenant_id, grantee_id, patient_id, expires_at)
  WHERE revoked_at IS NULL;

-- 9. Retention Policies (A2 & D5: retain_from, nullable retain_years)
CREATE TABLE IF NOT EXISTS clinical.retention_policies (
  tenant_id    uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
  record_class text NOT NULL,
  retain_from  text NOT NULL DEFAULT 'creation' CHECK (retain_from IN ('creation','deactivation')),
  retain_years int,                                      -- NULL = purge forbidden (fail-safe)
  legal_hold   boolean NOT NULL DEFAULT false,
  basis        text NOT NULL,
  PRIMARY KEY (tenant_id, record_class)
);

-- Seed D5 commercial retention policies (3 years from deactivation)
INSERT INTO clinical.retention_policies (tenant_id, record_class, retain_from, retain_years, legal_hold, basis)
SELECT id, 'shopping_ledger', 'deactivation', 3, false, 'D5 commercial retention policy'
FROM iam.tenants
ON CONFLICT (tenant_id, record_class) DO NOTHING;

INSERT INTO clinical.retention_policies (tenant_id, record_class, retain_from, retain_years, legal_hold, basis)
SELECT id, 'commercial_orders', 'deactivation', 3, false, 'D5 commercial retention policy'
FROM iam.tenants
ON CONFLICT (tenant_id, record_class) DO NOTHING;

INSERT INTO clinical.retention_policies (tenant_id, record_class, retain_from, retain_years, legal_hold, basis)
SELECT id, 'transaction_logs', 'deactivation', 3, false, 'D5 commercial retention policy'
FROM iam.tenants
ON CONFLICT (tenant_id, record_class) DO NOTHING;

-- Automatic trigger to seed standard retention policies on new tenant creation
CREATE OR REPLACE FUNCTION clinical.seed_tenant_retention_policies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, clinical
AS $$
BEGIN
  INSERT INTO clinical.retention_policies (tenant_id, record_class, retain_from, retain_years, legal_hold, basis)
  VALUES
    (NEW.id, 'shopping_ledger', 'deactivation', 3, false, 'D5 commercial retention policy'),
    (NEW.id, 'commercial_orders', 'deactivation', 3, false, 'D5 commercial retention policy'),
    (NEW.id, 'transaction_logs', 'deactivation', 3, false, 'D5 commercial retention policy')
  ON CONFLICT (tenant_id, record_class) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_tenant_retention_policies ON iam.tenants;
CREATE TRIGGER trg_seed_tenant_retention_policies
  AFTER INSERT ON iam.tenants
  FOR EACH ROW
  EXECUTE FUNCTION clinical.seed_tenant_retention_policies();

-- 10. Constraints Validation & Published Profiles
CREATE OR REPLACE FUNCTION clinical.constraints_valid(c jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(c) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_object_keys(c) k
       WHERE k NOT IN (
         'sugars_g_100g_max',
         'carbs_g_100g_max',
         'sodium_mg_100g_max',
         'satfat_g_100g_max',
         'energy_kcal_100g_max',
         'fibre_g_100g_min'
       )
     );
$$;

CREATE TABLE IF NOT EXISTS clinical.published_profiles (
  tenant_id      uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
  profile_id     uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL,
  bundle_version int  NOT NULL,
  status         text NOT NULL CHECK (status IN ('published','withdrawn')),
  constraints    jsonb NOT NULL CHECK (clinical.constraints_valid(constraints)),
  published_by   uuid NOT NULL,
  published_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, profile_id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clinical.patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, published_by) REFERENCES iam.members (tenant_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_published_profiles_patient
  ON clinical.published_profiles (tenant_id, patient_id, status);

-- 11. ABAC Relationship Verification Helper (Immediate Revocation)
CREATE OR REPLACE FUNCTION app_private.has_relationship(p_patient uuid, p_write boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, clinical, iam, app_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM clinical.treatment_relationships r
    JOIN iam.members m ON m.tenant_id = r.tenant_id AND m.user_id = r.staff_id
    WHERE r.tenant_id  = app_private.tenant_id()
      AND r.staff_id   = app_private.uid()
      AND r.patient_id = p_patient
      AND r.valid_from <= now() AND (r.valid_to IS NULL OR r.valid_to > now())
      AND m.status = 'active'
      AND (NOT p_write OR (r.can_write AND m.licence_verified))
  );
$$;
ALTER FUNCTION app_private.has_relationship(uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION app_private.has_relationship(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.has_relationship(uuid, boolean) TO authenticated;

-- 12. Break-Glass Stored Procedures (Step-Up Guarded & Audited)
CREATE OR REPLACE FUNCTION clinical.request_break_glass(
  p_patient_id uuid,
  p_grantee_id uuid,
  p_incident_no text,
  p_reason_enc bytea,
  p_duration_hours int DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, clinical, iam, audit, extensions, app_private
AS $$
DECLARE
  v_tenant_id uuid := app_private.tenant_id();
  v_actor_id uuid := app_private.uid();
  v_actor_role text := app_private.app_role();
  v_grant_id uuid;
  v_starts_at timestamptz := now();
  v_expires_at timestamptz;
  v_hours int;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'tenant_admin' THEN
    RAISE EXCEPTION 'forbidden: only tenant_admin may grant break-glass access' USING ERRCODE = '42501';
  END IF;

  -- Bounded duration: minimum 1 hour, maximum 24 hours
  v_hours := least(greatest(coalesce(p_duration_hours, 24), 1), 24);
  v_expires_at := v_starts_at + (v_hours || ' hours')::interval;

  -- Ensure grantee belongs to the same tenant and is active staff
  IF NOT EXISTS (
    SELECT 1 FROM iam.members
    WHERE tenant_id = v_tenant_id AND user_id = p_grantee_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'grantee must be an active member of this tenant' USING ERRCODE = 'P0002';
  END IF;

  -- Ensure patient belongs to the same tenant
  IF NOT EXISTS (
    SELECT 1 FROM clinical.patients
    WHERE tenant_id = v_tenant_id AND id = p_patient_id
  ) THEN
    RAISE EXCEPTION 'patient not found in this tenant' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO clinical.emergency_grants (
    tenant_id, patient_id, grantee_id, granted_by,
    incident_no, reason_enc, starts_at, expires_at, review_state
  ) VALUES (
    v_tenant_id, p_patient_id, p_grantee_id, v_actor_id,
    p_incident_no, p_reason_enc, v_starts_at, v_expires_at, 'pending'
  )
  RETURNING id INTO v_grant_id;

  -- Write BREAK_GLASS_INITIATE audit event
  INSERT INTO audit.legacy_audit_log (
    tenant_id, actor_id, actor_role, action, mutation_type,
    resource_type, resource_id, subject_ref, reason
  ) VALUES (
    v_tenant_id, v_actor_id, v_actor_role, 'BREAK_GLASS_INITIATE', 'insert',
    'emergency_grants', v_grant_id, p_patient_id::text,
    'Emergency break-glass access granted under incident ' || p_incident_no
  );

  RETURN jsonb_build_object(
    'success', true,
    'grant_id', v_grant_id,
    'starts_at', v_starts_at,
    'expires_at', v_expires_at
  );
END;
$$;
ALTER FUNCTION clinical.request_break_glass(uuid, uuid, text, bytea, int) OWNER TO postgres;
REVOKE ALL ON FUNCTION clinical.request_break_glass(uuid, uuid, text, bytea, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clinical.request_break_glass(uuid, uuid, text, bytea, int) TO authenticated;

CREATE OR REPLACE FUNCTION clinical.revoke_break_glass(
  p_grant_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, clinical, iam, audit, extensions, app_private
AS $$
DECLARE
  v_tenant_id uuid := app_private.tenant_id();
  v_actor_id uuid := app_private.uid();
  v_actor_role text := app_private.app_role();
  v_grant record;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'tenant_admin' THEN
    RAISE EXCEPTION 'forbidden: only tenant_admin may revoke break-glass access' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_grant FROM clinical.emergency_grants
  WHERE tenant_id = v_tenant_id AND id = p_grant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'emergency grant not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE clinical.emergency_grants
  SET revoked_at = now()
  WHERE tenant_id = v_tenant_id AND id = p_grant_id;

  -- Write BREAK_GLASS_REVOKE audit event
  INSERT INTO audit.legacy_audit_log (
    tenant_id, actor_id, actor_role, action, mutation_type,
    resource_type, resource_id, subject_ref, reason
  ) VALUES (
    v_tenant_id, v_actor_id, v_actor_role, 'BREAK_GLASS_REVOKE', 'update',
    'emergency_grants', p_grant_id, v_grant.patient_id::text,
    coalesce(p_reason, 'Break-glass access revoked by admin')
  );

  RETURN jsonb_build_object('success', true, 'revoked_at', now());
END;
$$;
ALTER FUNCTION clinical.revoke_break_glass(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION clinical.revoke_break_glass(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clinical.revoke_break_glass(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION clinical.review_break_glass(
  p_grant_id uuid,
  p_review_state text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, clinical, iam, audit, extensions, app_private
AS $$
DECLARE
  v_tenant_id uuid := app_private.tenant_id();
  v_actor_id uuid := app_private.uid();
  v_actor_role text := app_private.app_role();
  v_grant record;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('tenant_admin', 'compliance_auditor') THEN
    RAISE EXCEPTION 'forbidden: only tenant_admin or compliance_auditor may review emergency grants' USING ERRCODE = '42501';
  END IF;

  IF p_review_state NOT IN ('reviewed', 'escalated') THEN
    RAISE EXCEPTION 'invalid review_state: must be reviewed or escalated' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_grant FROM clinical.emergency_grants
  WHERE tenant_id = v_tenant_id AND id = p_grant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'emergency grant not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE clinical.emergency_grants
  SET review_state = p_review_state
  WHERE tenant_id = v_tenant_id AND id = p_grant_id;

  INSERT INTO audit.legacy_audit_log (
    tenant_id, actor_id, actor_role, action, mutation_type,
    resource_type, resource_id, subject_ref, reason
  ) VALUES (
    v_tenant_id, v_actor_id, v_actor_role, 'BREAK_GLASS_REVIEW', 'update',
    'emergency_grants', p_grant_id, v_grant.patient_id::text,
    coalesce(p_notes, 'Emergency grant reviewed: ' || p_review_state)
  );

  RETURN jsonb_build_object('success', true, 'review_state', p_review_state);
END;
$$;
ALTER FUNCTION clinical.review_break_glass(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION clinical.review_break_glass(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clinical.review_break_glass(uuid, text, text) TO authenticated;

-- 13. Apply Restrictive Tenant Wall to All Tenant Tables
SELECT app_private.apply_tenant_wall('clinical.patients');
SELECT app_private.apply_tenant_wall('clinical.treatment_relationships');
SELECT app_private.apply_tenant_wall('clinical.dietary_tags');
SELECT app_private.apply_tenant_wall('clinical.clinical_records');
SELECT app_private.apply_tenant_wall('clinical.clinical_advice');
SELECT app_private.apply_tenant_wall('clinical.consent_records');
SELECT app_private.apply_tenant_wall('clinical.emergency_grants');
SELECT app_private.apply_tenant_wall('clinical.retention_policies');
SELECT app_private.apply_tenant_wall('clinical.published_profiles');

-- 14. Permissive Role-Specific Policies (Blueprint §1.3 & §4.2)

-- Tag Vocabulary (Controlled vocabulary is read-only for authenticated callers)
ALTER TABLE clinical.tag_vocabulary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tag_vocabulary_select ON clinical.tag_vocabulary;
CREATE POLICY tag_vocabulary_select ON clinical.tag_vocabulary
  FOR SELECT TO authenticated USING (true);

-- Patients Policies
DROP POLICY IF EXISTS admin_patients_select ON clinical.patients;
CREATE POLICY admin_patients_select ON clinical.patients
  FOR SELECT TO authenticated
  USING (app_private.app_role() = 'tenant_admin');

DROP POLICY IF EXISTS admin_patients_insert ON clinical.patients;
CREATE POLICY admin_patients_insert ON clinical.patients
  FOR INSERT TO authenticated
  WITH CHECK (app_private.app_role() = 'tenant_admin');

DROP POLICY IF EXISTS clinician_patients_select ON clinical.patients;
CREATE POLICY clinician_patients_select ON clinical.patients
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'writing_clinician'
    AND (SELECT app_private.has_relationship(id))
  );

DROP POLICY IF EXISTS clinician_patients_insert ON clinical.patients;
CREATE POLICY clinician_patients_insert ON clinical.patients
  FOR INSERT TO authenticated
  WITH CHECK (app_private.app_role() = 'writing_clinician');

DROP POLICY IF EXISTS dietician_patients_select ON clinical.patients;
CREATE POLICY dietician_patients_select ON clinical.patients
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'viewing_dietician'
    AND (SELECT app_private.has_relationship(id))
  );

DROP POLICY IF EXISTS patient_self_select ON clinical.patients;
CREATE POLICY patient_self_select ON clinical.patients
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'patient'
    AND user_id = (SELECT app_private.uid())
  );

-- Treatment Relationships Policies
DROP POLICY IF EXISTS admin_relationships_all ON clinical.treatment_relationships;
CREATE POLICY admin_relationships_all ON clinical.treatment_relationships
  FOR ALL TO authenticated
  USING (app_private.app_role() = 'tenant_admin')
  WITH CHECK (app_private.app_role() = 'tenant_admin');

DROP POLICY IF EXISTS clinician_relationships_select ON clinical.treatment_relationships;
CREATE POLICY clinician_relationships_select ON clinical.treatment_relationships
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() IN ('writing_clinician', 'viewing_dietician')
    AND staff_id = (SELECT app_private.uid())
  );

DROP POLICY IF EXISTS clinician_relationships_insert ON clinical.treatment_relationships;
CREATE POLICY clinician_relationships_insert ON clinical.treatment_relationships
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.app_role() = 'writing_clinician'
    AND created_by = (SELECT app_private.uid())
    AND kind IN ('covering', 'referral')
  );

DROP POLICY IF EXISTS patient_relationships_select ON clinical.treatment_relationships;
CREATE POLICY patient_relationships_select ON clinical.treatment_relationships
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'patient'
    AND patient_id = (
      SELECT p.id FROM clinical.patients p
      WHERE p.tenant_id = treatment_relationships.tenant_id
        AND p.user_id = (SELECT app_private.uid())
    )
  );

-- Dietary Tags Policies
DROP POLICY IF EXISTS dietician_tags ON clinical.dietary_tags;
CREATE POLICY dietician_tags ON clinical.dietary_tags
  FOR ALL TO authenticated
  USING (
    app_private.app_role() = 'viewing_dietician'
    AND (SELECT app_private.has_relationship(patient_id))
  )
  WITH CHECK (
    app_private.app_role() = 'viewing_dietician'
    AND author_id = (SELECT app_private.uid())
    AND (SELECT app_private.has_relationship(patient_id))
  );

DROP POLICY IF EXISTS clinician_dietary_tags_select ON clinical.dietary_tags;
CREATE POLICY clinician_dietary_tags_select ON clinical.dietary_tags
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'writing_clinician'
    AND (SELECT app_private.has_relationship(patient_id))
  );

DROP POLICY IF EXISTS patient_dietary_tags_select ON clinical.dietary_tags;
CREATE POLICY patient_dietary_tags_select ON clinical.dietary_tags
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'patient'
    AND patient_id = (
      SELECT p.id FROM clinical.patients p
      WHERE p.tenant_id = dietary_tags.tenant_id
        AND p.user_id = (SELECT app_private.uid())
    )
  );

-- Clinical Records Policies (Append-Only)
DROP POLICY IF EXISTS clinician_select ON clinical.clinical_records;
CREATE POLICY clinician_select ON clinical.clinical_records
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'writing_clinician'
    AND (SELECT app_private.has_relationship(patient_id))
  );

DROP POLICY IF EXISTS clinician_insert ON clinical.clinical_records;
CREATE POLICY clinician_insert ON clinical.clinical_records
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.app_role() = 'writing_clinician'
    AND author_id = (SELECT app_private.uid())
    AND (SELECT app_private.has_relationship(patient_id, true))
  );

DROP POLICY IF EXISTS break_glass_select ON clinical.clinical_records;
CREATE POLICY break_glass_select ON clinical.clinical_records
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clinical.emergency_grants g
      WHERE g.tenant_id  = clinical_records.tenant_id
        AND g.patient_id = clinical_records.patient_id
        AND g.grantee_id = (SELECT app_private.uid())
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND g.expires_at > now()
    )
  );

-- Clinical Advice Policies
DROP POLICY IF EXISTS clinician_advice_select ON clinical.clinical_advice;
CREATE POLICY clinician_advice_select ON clinical.clinical_advice
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'writing_clinician'
    AND (SELECT app_private.has_relationship(patient_id))
  );

DROP POLICY IF EXISTS clinician_advice_insert ON clinical.clinical_advice;
CREATE POLICY clinician_advice_insert ON clinical.clinical_advice
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.app_role() = 'writing_clinician'
    AND author_id = (SELECT app_private.uid())
    AND (SELECT app_private.has_relationship(patient_id, true))
  );

DROP POLICY IF EXISTS clinician_advice_update ON clinical.clinical_advice;
CREATE POLICY clinician_advice_update ON clinical.clinical_advice
  FOR UPDATE TO authenticated
  USING (
    app_private.app_role() = 'writing_clinician'
    AND author_id = (SELECT app_private.uid())
    AND (SELECT app_private.has_relationship(patient_id, true))
  )
  WITH CHECK (
    app_private.app_role() = 'writing_clinician'
    AND author_id = (SELECT app_private.uid())
    AND (SELECT app_private.has_relationship(patient_id, true))
  );

DROP POLICY IF EXISTS dietician_advice_select ON clinical.clinical_advice;
CREATE POLICY dietician_advice_select ON clinical.clinical_advice
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'viewing_dietician'
    AND (SELECT app_private.has_relationship(patient_id))
  );

DROP POLICY IF EXISTS patient_own_advice ON clinical.clinical_advice;
CREATE POLICY patient_own_advice ON clinical.clinical_advice
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'patient'
    AND status = 'published'
    AND patient_id = (
      SELECT p.id FROM clinical.patients p
      WHERE p.tenant_id = clinical_advice.tenant_id
        AND p.user_id = (SELECT app_private.uid())
    )
  );

-- Consent Records Policies
DROP POLICY IF EXISTS admin_consent_select ON clinical.consent_records;
CREATE POLICY admin_consent_select ON clinical.consent_records
  FOR SELECT TO authenticated
  USING (app_private.app_role() = 'tenant_admin');

DROP POLICY IF EXISTS auditor_consent_select ON clinical.consent_records;
CREATE POLICY auditor_consent_select ON clinical.consent_records
  FOR SELECT TO authenticated
  USING (app_private.app_role() = 'compliance_auditor');

DROP POLICY IF EXISTS clinician_consent_select ON clinical.consent_records;
CREATE POLICY clinician_consent_select ON clinical.consent_records
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'writing_clinician'
    AND (patient_id IS NULL OR (SELECT app_private.has_relationship(patient_id)))
  );

DROP POLICY IF EXISTS patient_consent_all ON clinical.consent_records;
CREATE POLICY patient_consent_all ON clinical.consent_records
  FOR ALL TO authenticated
  USING (
    app_private.app_role() = 'patient'
    AND patient_id = (
      SELECT p.id FROM clinical.patients p
      WHERE p.tenant_id = consent_records.tenant_id
        AND p.user_id = (SELECT app_private.uid())
    )
  )
  WITH CHECK (
    app_private.app_role() = 'patient'
    AND patient_id = (
      SELECT p.id FROM clinical.patients p
      WHERE p.tenant_id = consent_records.tenant_id
        AND p.user_id = (SELECT app_private.uid())
    )
  );

-- Emergency Grants Policies
DROP POLICY IF EXISTS admin_emergency_all ON clinical.emergency_grants;
CREATE POLICY admin_emergency_all ON clinical.emergency_grants
  FOR ALL TO authenticated
  USING (app_private.app_role() = 'tenant_admin')
  WITH CHECK (app_private.app_role() = 'tenant_admin');

DROP POLICY IF EXISTS auditor_emergency_select ON clinical.emergency_grants;
CREATE POLICY auditor_emergency_select ON clinical.emergency_grants
  FOR SELECT TO authenticated
  USING (app_private.app_role() = 'compliance_auditor');

DROP POLICY IF EXISTS grantee_emergency_select ON clinical.emergency_grants;
CREATE POLICY grantee_emergency_select ON clinical.emergency_grants
  FOR SELECT TO authenticated
  USING (grantee_id = (SELECT app_private.uid()));

-- Retention Policies
DROP POLICY IF EXISTS admin_retention_select ON clinical.retention_policies;
CREATE POLICY admin_retention_select ON clinical.retention_policies
  FOR SELECT TO authenticated
  USING (app_private.app_role() = 'tenant_admin');

DROP POLICY IF EXISTS auditor_retention_select ON clinical.retention_policies;
CREATE POLICY auditor_retention_select ON clinical.retention_policies
  FOR SELECT TO authenticated
  USING (app_private.app_role() = 'compliance_auditor');

-- Published Profiles Policies
DROP POLICY IF EXISTS clinician_profiles_select ON clinical.published_profiles;
CREATE POLICY clinician_profiles_select ON clinical.published_profiles
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'writing_clinician'
    AND (SELECT app_private.has_relationship(patient_id))
  );

DROP POLICY IF EXISTS clinician_profiles_insert ON clinical.published_profiles;
CREATE POLICY clinician_profiles_insert ON clinical.published_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.app_role() = 'writing_clinician'
    AND published_by = (SELECT app_private.uid())
    AND (SELECT app_private.has_relationship(patient_id, true))
  );

DROP POLICY IF EXISTS patient_profiles_select ON clinical.published_profiles;
CREATE POLICY patient_profiles_select ON clinical.published_profiles
  FOR SELECT TO authenticated
  USING (
    app_private.app_role() = 'patient'
    AND patient_id = (
      SELECT p.id FROM clinical.patients p
      WHERE p.tenant_id = published_profiles.tenant_id
        AND p.user_id = (SELECT app_private.uid())
    )
  );

-- Update Target Bundles Policies to enforce writing relationship when patient-scoped
DROP POLICY IF EXISTS clinician_write_target_bundles ON clinical.target_bundles;
CREATE POLICY clinician_write_target_bundles ON clinical.target_bundles
  FOR ALL TO authenticated
  USING (
    (
      app_private.app_role() = 'writing_clinician'
      AND (
        subject_ref !~ '^[0-9a-f-]{36}$'
        OR (SELECT app_private.has_relationship(subject_ref::uuid, true))
      )
    )
    OR app_private.app_role() IN ('tenant_admin', 'super_admin')
  )
  WITH CHECK (
    (
      app_private.app_role() = 'writing_clinician'
      AND (
        subject_ref !~ '^[0-9a-f-]{36}$'
        OR (SELECT app_private.has_relationship(subject_ref::uuid, true))
      )
    )
    OR app_private.app_role() IN ('tenant_admin', 'super_admin')
  );

-- 15. Security Invoker Compatibility Views in Schema public
DROP VIEW IF EXISTS public.patients;
CREATE VIEW public.patients WITH (security_invoker = true) AS
  SELECT * FROM clinical.patients;

DROP VIEW IF EXISTS public.treatment_relationships;
CREATE VIEW public.treatment_relationships WITH (security_invoker = true) AS
  SELECT * FROM clinical.treatment_relationships;

DROP VIEW IF EXISTS public.clinical_records;
CREATE VIEW public.clinical_records WITH (security_invoker = true) AS
  SELECT * FROM clinical.clinical_records;

DROP VIEW IF EXISTS public.clinical_advice;
CREATE VIEW public.clinical_advice WITH (security_invoker = true) AS
  SELECT * FROM clinical.clinical_advice;

DROP VIEW IF EXISTS public.dietary_tags;
CREATE VIEW public.dietary_tags WITH (security_invoker = true) AS
  SELECT * FROM clinical.dietary_tags;

DROP VIEW IF EXISTS public.tag_vocabulary;
CREATE VIEW public.tag_vocabulary WITH (security_invoker = true) AS
  SELECT * FROM clinical.tag_vocabulary;

DROP VIEW IF EXISTS public.emergency_grants;
CREATE VIEW public.emergency_grants WITH (security_invoker = true) AS
  SELECT * FROM clinical.emergency_grants;

DROP VIEW IF EXISTS public.retention_policies;
CREATE VIEW public.retention_policies WITH (security_invoker = true) AS
  SELECT * FROM clinical.retention_policies;

DROP VIEW IF EXISTS public.published_profiles;
CREATE VIEW public.published_profiles WITH (security_invoker = true) AS
  SELECT * FROM clinical.published_profiles;

-- Re-create public.consent_records view with updated columns
DROP VIEW IF EXISTS public.consent_records;
CREATE VIEW public.consent_records WITH (security_invoker = true) AS
  SELECT * FROM clinical.consent_records;

-- 16. Permissions for authenticated and service roles
GRANT USAGE ON SCHEMA clinical TO authenticated, svc_clinical;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  clinical.patients,
  clinical.treatment_relationships,
  clinical.clinical_records,
  clinical.clinical_advice,
  clinical.dietary_tags,
  clinical.consent_records,
  clinical.emergency_grants,
  clinical.retention_policies,
  clinical.published_profiles
  TO authenticated, svc_clinical;
GRANT SELECT ON clinical.tag_vocabulary TO authenticated, svc_clinical;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.patients,
  public.treatment_relationships,
  public.clinical_records,
  public.clinical_advice,
  public.dietary_tags,
  public.consent_records,
  public.emergency_grants,
  public.retention_policies,
  public.published_profiles
  TO authenticated;
GRANT SELECT ON public.tag_vocabulary TO authenticated;

COMMIT;
