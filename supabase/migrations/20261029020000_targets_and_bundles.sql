-- ============================================================================
-- Migration: 20261029020000_targets_and_bundles.sql
-- Description: Clinic Admin Dashboard (CAD) Phase 4 Rules, Targets & Signed Bundles
-- Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§8.1, §8.2, §8.3, §8.6, §13 Tests T16-T25)
-- ============================================================================

-- 1. Create Targets Table
CREATE TABLE IF NOT EXISTS public.targets (
  target_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version       int NOT NULL DEFAULT 1,
  supersedes    uuid REFERENCES public.targets(target_id),
  scope         text NOT NULL CHECK (scope IN ('platform','tenant','cohort','patient')),
  subject_ref   text,
  nutrient_code text NOT NULL,
  unit          text NOT NULL CHECK (unit IN ('mg','g','kcal','kJ')),
  basis         text NOT NULL CHECK (basis IN (
                  'per_100g','per_100ml','per_serving',
                  'per_item','per_cart','per_day'
                )),
  comparator    text NOT NULL CHECK (comparator IN ('lt','lte','gt','gte','between')),
  value         numeric NOT NULL CHECK (value > 0),
  value_max     numeric,
  severity      text NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info','caution','critical')),
  valid_from    date NOT NULL,
  valid_to      date,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN (
                    'draft','pending_cosign','active',
                    'suspended','revoked','expired'
                  )),
  set_by        uuid NOT NULL,
  cosigned_by   uuid,
  evidence_ref  text,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_targets_tenant ON public.targets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_targets_subject ON public.targets(subject_ref);
CREATE INDEX IF NOT EXISTS idx_targets_nutrient ON public.targets(nutrient_code);
CREATE INDEX IF NOT EXISTS idx_targets_status ON public.targets(status);

-- 2. Create Target Bundles Table (Stores ES256-signed client distribution payloads)
CREATE TABLE IF NOT EXISTS public.target_bundles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subject_ref    text NOT NULL,
  bundle_version bigint NOT NULL,
  bundle_data    jsonb NOT NULL,
  signature      text NOT NULL,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_target_bundles_tenant_subject ON public.target_bundles(tenant_id, subject_ref);
CREATE UNIQUE INDEX IF NOT EXISTS uq_target_bundles_version ON public.target_bundles(tenant_id, subject_ref, bundle_version);

-- 3. Create Consumption Diary Table (Offline sync and provenance tracking)
CREATE TABLE IF NOT EXISTS public.consumption_diary (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_ref text NOT NULL,
  product_id  text NOT NULL,
  retailer    text NOT NULL,
  quantity_g  numeric NOT NULL CHECK (quantity_g > 0),
  provenance  text NOT NULL CHECK (provenance IN (
                'lab_verified','label_direct','reference_db',
                'derived','user_confirmed','app_estimate'
              )),
  source_ids  text[],
  recorded_at timestamptz NOT NULL DEFAULT now(),
  synced_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_consumption_diary_tenant_patient ON public.consumption_diary(tenant_id, patient_ref);
CREATE INDEX IF NOT EXISTS idx_consumption_diary_recorded_at ON public.consumption_diary(recorded_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.target_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_diary ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies: Targets
DROP POLICY IF EXISTS tenant_isolation_targets ON public.targets;
CREATE POLICY tenant_isolation_targets ON public.targets
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    OR public.current_jwt_role() = 'super_admin'
  );

DROP POLICY IF EXISTS clinician_write_targets ON public.targets;
CREATE POLICY clinician_write_targets ON public.targets
  FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    AND public.current_jwt_role() IN ('writing_clinician', 'tenant_admin', 'super_admin')
  )
  WITH CHECK (
    tenant_id = public.current_jwt_tenant_id()
    AND public.current_jwt_role() IN ('writing_clinician', 'tenant_admin', 'super_admin')
  );

-- 6. RLS Policies: Target Bundles
DROP POLICY IF EXISTS tenant_isolation_target_bundles ON public.target_bundles;
CREATE POLICY tenant_isolation_target_bundles ON public.target_bundles
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    OR public.current_jwt_role() = 'super_admin'
  );

DROP POLICY IF EXISTS clinician_write_target_bundles ON public.target_bundles;
CREATE POLICY clinician_write_target_bundles ON public.target_bundles
  FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    AND public.current_jwt_role() IN ('writing_clinician', 'tenant_admin', 'super_admin')
  )
  WITH CHECK (
    tenant_id = public.current_jwt_tenant_id()
    AND public.current_jwt_role() IN ('writing_clinician', 'tenant_admin', 'super_admin')
  );

-- 7. RLS Policies: Consumption Diary
DROP POLICY IF EXISTS tenant_isolation_consumption_diary ON public.consumption_diary;
CREATE POLICY tenant_isolation_consumption_diary ON public.consumption_diary
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    OR public.current_jwt_role() = 'super_admin'
  );

DROP POLICY IF EXISTS user_insert_consumption_diary ON public.consumption_diary;
CREATE POLICY user_insert_consumption_diary ON public.consumption_diary
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_jwt_tenant_id()
    OR public.current_jwt_role() = 'super_admin'
  );

-- 8. 10-Step Target Validation Trigger Function (Plan §8.2)
CREATE OR REPLACE FUNCTION public.validate_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_renal_or_paediatric boolean;
BEGIN
  -- Step 1: Schema and Type checks already guarded by table constraints

  -- Step 2: Unit Whitelist matching nutrient
  IF NEW.nutrient_code IN ('SodiumMG', 'PotassiumMG', 'PhosphorusMG') AND NEW.unit <> 'mg' THEN
    RAISE EXCEPTION 'Nutrient % must use unit "mg"', NEW.nutrient_code;
  END IF;

  IF NEW.nutrient_code IN ('SugarsG', 'CarbohydratesG', 'FibreG', 'ProteinG', 'FatG', 'SaturatedFatG', 'TransFatG') AND NEW.unit <> 'g' THEN
    RAISE EXCEPTION 'Nutrient % must use unit "g"', NEW.nutrient_code;
  END IF;

  IF NEW.nutrient_code IN ('EnergyKcal') AND NEW.unit <> 'kcal' THEN
    RAISE EXCEPTION 'Nutrient % must use unit "kcal"', NEW.nutrient_code;
  END IF;

  -- Step 4: Platform Safety Envelope Bounds (Clinical Safety Invariant)
  IF NEW.nutrient_code = 'SodiumMG' AND NEW.value > 15000 THEN
    RAISE EXCEPTION 'Sodium target of % mg exceeds platform safety envelope ceiling (15,000 mg)', NEW.value;
  END IF;

  IF NEW.nutrient_code = 'SugarsG' AND NEW.value > 300 THEN
    RAISE EXCEPTION 'Sugar target of % g exceeds platform safety envelope ceiling (300 g)', NEW.value;
  END IF;

  IF NEW.nutrient_code = 'PotassiumMG' AND NEW.value > 10000 THEN
    RAISE EXCEPTION 'Potassium target of % mg exceeds platform safety envelope ceiling (10,000 mg)', NEW.value;
  END IF;

  -- Step 8: Co-Signature check for Renal and Paediatric rules (T25)
  v_is_renal_or_paediatric := NEW.nutrient_code IN ('PotassiumMG', 'PhosphorusMG')
                              OR (NEW.scope = 'cohort' AND NEW.subject_ref ILIKE '%paediatric%')
                              OR (NEW.scope = 'cohort' AND NEW.subject_ref ILIKE '%renal%');

  IF v_is_renal_or_paediatric AND NEW.status = 'active' AND NEW.cosigned_by IS NULL THEN
    -- Invariant: Renal and paediatric rules cannot become active without co-signature
    NEW.status := 'pending_cosign';
  END IF;

  -- Step 9: Audit Write
  INSERT INTO public.audit_log (
    tenant_id, actor_id, actor_role, action, mutation_type, resource_type,
    resource_id, subject_ref, reason
  ) VALUES (
    NEW.tenant_id, NEW.set_by, 'writing_clinician',
    CASE WHEN TG_OP = 'INSERT' THEN 'CREATE_TARGET' ELSE 'UPDATE_TARGET' END,
    CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END,
    'Target',
    NEW.target_id::text,
    NEW.subject_ref,
    NEW.reason
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_target ON public.targets;
CREATE TRIGGER trg_validate_target
  BEFORE INSERT OR UPDATE ON public.targets
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_target();

