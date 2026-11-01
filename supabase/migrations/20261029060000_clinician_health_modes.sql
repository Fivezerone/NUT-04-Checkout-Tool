-- ============================================================================
-- Migration: 20261029060000_clinician_health_modes.sql
-- Description: Phase 5 — Clinician-Owned Health Modes, Dynamic Rules & Tracked Nutrients
--
-- REVERSAL NOTE:
-- To reverse, execute:
--   DROP TABLE IF EXISTS public.health_mode_rules CASCADE;
--   DROP TABLE IF EXISTS public.health_modes CASCADE;
--   DROP TABLE IF EXISTS public.tracked_nutrients CASCADE;
-- ============================================================================

-- 1. Tracked Nutrients Catalog Registry
CREATE TABLE IF NOT EXISTS public.tracked_nutrients (
  code                  text PRIMARY KEY,
  name                  text NOT NULL,
  unit                  text NOT NULL,
  catalog_coverage_pct  integer NOT NULL DEFAULT 0,
  default_basis         text NOT NULL DEFAULT 'per_100g'
);

-- Seed Tracked Nutrients
INSERT INTO public.tracked_nutrients (code, name, unit, catalog_coverage_pct, default_basis)
VALUES
  ('SugarsG', 'Sugars', 'g', 98, 'per_100g'),
  ('SodiumMG', 'Sodium', 'mg', 96, 'per_100g'),
  ('SaturatedFatG', 'Saturated Fat', 'g', 94, 'per_100g'),
  ('CarbohydratesG', 'Carbohydrates', 'g', 99, 'per_100g'),
  ('EnergyKcal', 'Energy / Calories', 'kcal', 99, 'per_100g'),
  ('ProteinG', 'Protein', 'g', 97, 'per_100g'),
  ('FibreG', 'Dietary Fibre', 'g', 88, 'per_100g'),
  ('PotassiumMG', 'Potassium', 'mg', 65, 'per_100g'),
  ('PhosphorusMG', 'Phosphorus', 'mg', 52, 'per_100g'),
  ('TransFatG', 'Trans Fat', 'g', 45, 'per_100g')
ON CONFLICT (code) DO UPDATE
SET catalog_coverage_pct = EXCLUDED.catalog_coverage_pct;

-- 2. Health Modes Table (Versioned & Clinician-Owned)
CREATE TABLE IF NOT EXISTS public.health_modes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code        text NOT NULL,
  name        text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'retired')),
  description text,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_health_mode_version UNIQUE (tenant_id, code, version)
);

CREATE INDEX IF NOT EXISTS idx_health_modes_tenant_status
  ON public.health_modes(tenant_id, status);

ALTER TABLE public.health_modes ENABLE ROW LEVEL SECURITY;

CREATE POLICY health_modes_read ON public.health_modes
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
    OR public.current_jwt_role() = 'super_admin'
  );

CREATE POLICY health_modes_write ON public.health_modes
  FOR ALL TO authenticated
  USING (
    (
      tenant_id = public.current_jwt_tenant_id()
      AND public.current_jwt_role() IN ('writing_clinician', 'tenant_admin')
    )
    OR public.current_jwt_role() = 'super_admin'
  )
  WITH CHECK (
    (
      tenant_id = public.current_jwt_tenant_id()
      AND public.current_jwt_role() IN ('writing_clinician', 'tenant_admin')
    )
    OR public.current_jwt_role() = 'super_admin'
  );

-- 3. Health Mode Rules Table (Nutrient Thresholds, Comparators & Rationales)
CREATE TABLE IF NOT EXISTS public.health_mode_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  health_mode_id      uuid NOT NULL REFERENCES public.health_modes(id) ON DELETE CASCADE,
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  nutrient_code       text NOT NULL REFERENCES public.tracked_nutrients(code),
  comparator          text NOT NULL CHECK (comparator IN ('lte', 'lt', 'gte', 'gt', 'eq')),
  threshold           numeric NOT NULL,
  unit                text NOT NULL,
  basis               text NOT NULL DEFAULT 'per_100g' CHECK (basis IN ('per_100g', 'per_serving', 'per_day')),
  severity            text NOT NULL DEFAULT 'warning' CHECK (severity IN ('advisory', 'warning', 'high', 'critical')),
  clinical_rationale  text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_mode_rules_mode
  ON public.health_mode_rules(health_mode_id);

CREATE INDEX IF NOT EXISTS idx_health_mode_rules_tenant
  ON public.health_mode_rules(tenant_id);

ALTER TABLE public.health_mode_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY health_mode_rules_read ON public.health_mode_rules
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
    OR public.current_jwt_role() = 'super_admin'
  );

CREATE POLICY health_mode_rules_write ON public.health_mode_rules
  FOR ALL TO authenticated
  USING (
    (
      tenant_id = public.current_jwt_tenant_id()
      AND public.current_jwt_role() IN ('writing_clinician', 'tenant_admin')
    )
    OR public.current_jwt_role() = 'super_admin'
  )
  WITH CHECK (
    (
      tenant_id = public.current_jwt_tenant_id()
      AND public.current_jwt_role() IN ('writing_clinician', 'tenant_admin')
    )
    OR public.current_jwt_role() = 'super_admin'
  );
