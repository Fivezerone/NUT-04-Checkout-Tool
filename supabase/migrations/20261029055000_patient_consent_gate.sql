-- ============================================================================
-- Migration: 20261029055000_patient_consent_gate.sql
-- Description: Phase 3 — Patient Consent Gate & Standalone Consent Ledger
--
-- REVERSAL NOTE:
-- To reverse, execute:
--   DROP TABLE IF EXISTS public.consents CASCADE;
--   DROP FUNCTION IF EXISTS public.check_patient_consent;
-- ============================================================================

-- 1. Create Standalone Consents Table
CREATE TABLE IF NOT EXISTS public.consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  consent_version text NOT NULL DEFAULT '2.0',
  accepted_at     timestamptz NOT NULL DEFAULT now(),
  user_agent      text,
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  CONSTRAINT uq_patient_consent_version UNIQUE (patient_id, consent_version)
);

CREATE INDEX IF NOT EXISTS idx_consents_patient_version
  ON public.consents(patient_id, consent_version);

CREATE INDEX IF NOT EXISTS idx_consents_tenant
  ON public.consents(tenant_id);

-- 2. Enable Row Level Security
ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
DROP POLICY IF EXISTS consents_patient_read_own ON public.consents;
CREATE POLICY consents_patient_read_own ON public.consents
  FOR SELECT
  TO authenticated
  USING (patient_id = auth.uid());

DROP POLICY IF EXISTS consents_patient_insert_own ON public.consents;
CREATE POLICY consents_patient_insert_own ON public.consents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id = auth.uid()
    AND tenant_id = coalesce(public.current_jwt_tenant_id(), '00000000-0000-0000-0000-000000000000'::uuid)
  );

DROP POLICY IF EXISTS consents_tenant_staff_read ON public.consents;
CREATE POLICY consents_tenant_staff_read ON public.consents
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_jwt_tenant_id()
    AND public.current_jwt_role() IN ('tenant_admin', 'writing_clinician', 'viewing_dietician', 'super_admin')
  );

-- 4. RPC to check if current patient has granted consent
CREATE OR REPLACE FUNCTION public.check_patient_consent(p_version text DEFAULT '2.0')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.consents
    WHERE patient_id = auth.uid()
      AND consent_version = p_version
      AND revoked_at IS NULL
  );
END;
$$;
