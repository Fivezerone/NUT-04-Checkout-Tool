#!/usr/bin/env node
/**
 * scripts/stage-pilot-fixtures.mjs
 *
 * Staging Synthetic Multi-Tenant Pilot Fixtures
 * Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§9.5 Pilot Plan)
 *
 * Produces synthetic staging data for pilot validation by the Clinical Safety Board & DPO.
 * All records use synthetic non-identifiable test personas and comply with DPA s.46 / s.40.
 */

export const PILOT_FIXTURES = {
  tenant: {
    id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Kenyatta National Hospital — Clinical Nutrition Unit',
    slug: 'knh-nutrition',
    status: 'active',
    data_residency_region: 'ke-nairobi',
    billing_email: 'finance@knh.or.ke',
    config: {
      small_cell_k: 5,
      retention_days: 7300, // 20 years
      default_locale: 'en-KE',
      allow_dietician_cosign: true,
    },
  },

  staff: [
    {
      user_id: 'b0000000-0000-0000-0000-000000000001',
      tenant_id: 'a0000000-0000-0000-0000-000000000001',
      role: 'writing_clinician',
      licence_type: 'KMPDC_PHYSICIAN',
      licence_number: 'A-49201',
      licence_verified: true,
      display_name: 'Dr. David Omondi, MBChB, MMed',
    },
    {
      user_id: 'b0000000-0000-0000-0000-000000000002',
      tenant_id: 'a0000000-0000-0000-0000-000000000001',
      role: 'viewing_dietician',
      licence_type: 'KNDI_NUTRITIONIST',
      licence_number: 'NUT-10492',
      licence_verified: true,
      display_name: 'Grace Wanjiku, BSc ClinNutr',
    },
    {
      user_id: 'b0000000-0000-0000-0000-000000000003',
      tenant_id: 'a0000000-0000-0000-0000-000000000001',
      role: 'tenant_admin',
      licence_verified: true,
      display_name: 'Antony Mutua (HIM Administrator)',
    },
  ],

  cohorts: [
    {
      code: 'diabetes_t2',
      name: 'Cardio-Metabolic (Type 2 Diabetes)',
      member_count: 48,
    },
    {
      code: 'hypertension',
      name: 'Essential Hypertension Cohort',
      member_count: 35,
    },
    {
      code: 'renal_stage3',
      name: 'Chronic Kidney Disease (Stage 3 Renal)',
      member_count: 14,
    },
    {
      code: 'rare_metabolic',
      name: 'Rare Inborn Error of Metabolism',
      member_count: 3, // Below k=5 threshold -> tests suppression
    },
  ],

  clinicalTargets: [
    {
      target_id: 'c0000000-0000-0000-0000-000000000001',
      scope: 'cohort',
      subject_ref: 'hypertension',
      nutrient_code: 'SodiumMG',
      unit: 'mg',
      basis: 'per_day',
      comparator: 'lte',
      value: 2000,
      severity: 'critical',
      valid_from: '2026-10-01',
      valid_to: '2027-09-30',
      reason: 'WHO/MOH Kenya national salt reduction guidelines for hypertension management',
    },
    {
      target_id: 'c0000000-0000-0000-0000-000000000002',
      scope: 'cohort',
      subject_ref: 'diabetes_t2',
      nutrient_code: 'SugarsG',
      unit: 'g',
      basis: 'per_day',
      comparator: 'lte',
      value: 25,
      severity: 'critical',
      valid_from: '2026-10-01',
      valid_to: '2027-09-30',
      reason: 'Free sugar restriction for glycaemic control',
    },
    {
      target_id: 'c0000000-0000-0000-0000-000000000003',
      scope: 'cohort',
      subject_ref: 'renal_stage3',
      nutrient_code: 'PotassiumMG',
      unit: 'mg',
      basis: 'per_day',
      comparator: 'lte',
      value: 2000,
      severity: 'critical',
      valid_from: '2026-10-01',
      valid_to: '2027-09-30',
      reason: 'Renal potassium restriction co-signed by supervising nephrologist',
      cosigned_by: 'b0000000-0000-0000-0000-000000000001',
    },
  ],
}

if (process.argv[1]?.endsWith('stage-pilot-fixtures.mjs')) {
  console.log('[stage-pilot] Staging pilot tenant fixtures:')
  console.log(`- Tenant: ${PILOT_FIXTURES.tenant.name} (${PILOT_FIXTURES.tenant.id})`)
  console.log(`- Staff members: ${PILOT_FIXTURES.staff.length}`)
  console.log(`- Cohorts: ${PILOT_FIXTURES.cohorts.length}`)
  console.log(`- Clinical Targets: ${PILOT_FIXTURES.clinicalTargets.length}`)
  console.log('✅ [stage-pilot] Synthetic fixtures staged successfully.')
}
