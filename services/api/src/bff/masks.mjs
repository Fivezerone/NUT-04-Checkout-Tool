// services/api/src/bff/masks.mjs
// Field Masking Engine (Blueprint §3.5, §4.1; Invariants T13, T26)
// Default deny: any property not explicitly listed in the role allowlist is dropped.

export const K_RETAILER_OUTPUT = 20

export const RESOURCE_FIELD_ALLOWLIST = {
  patient_directory: {
    writing_clinician: [
      'id',
      'patient_ref',
      'display_name',
      'created_at',
      'updated_at',
      'active_targets',
      'care_team',
      'consent_status',
    ],
    viewing_dietician: [
      'id',
      'patient_ref',
      'display_name',
      'created_at',
      'updated_at',
      'active_targets',
      'care_team',
      'consent_status',
    ],
    tenant_admin: ['id', 'patient_ref', 'created_at', 'consent_status'],
    patient: ['id', 'patient_ref', 'display_name', 'created_at', 'active_targets'],
    compliance_auditor: ['id', 'patient_ref', 'created_at', 'consent_status'],
    super_admin: [], // Delta D-4: super_admin has zero clinical visibility
    commercial_stakeholder: [],
  },

  clinical_records: {
    writing_clinician: [
      'id',
      'patient_ref',
      'clinician_id',
      'targets',
      'notes',
      'advice',
      'created_at',
      'updated_at',
    ],
    viewing_dietician: ['id', 'patient_ref', 'clinician_id', 'targets', 'advice', 'created_at'],
    patient: ['id', 'patient_ref', 'advice', 'targets', 'created_at'],
    tenant_admin: [],
    compliance_auditor: [],
    super_admin: [],
    commercial_stakeholder: [],
  },

  commercial_aggregates: {
    commercial_stakeholder: [
      'period',
      'retailer',
      'total_orders',
      'aggregate_grade_distribution',
      'unscored_share',
      'k_anonymized',
    ],
    tenant_admin: [
      'period',
      'retailer',
      'total_orders',
      'aggregate_grade_distribution',
      'unscored_share',
      'k_anonymized',
    ],
    super_admin: [
      'period',
      'retailer',
      'total_orders',
      'aggregate_grade_distribution',
      'unscored_share',
      'k_anonymized',
    ],
    compliance_auditor: ['period', 'retailer', 'total_orders', 'k_anonymized'],
    writing_clinician: [],
    viewing_dietician: [],
    patient: [],
  },
}

/**
 * Masks a single object by role allowlist.
 * Drops all properties not declared in allowlist (default-deny).
 */
export function maskObject(resourceType, role, data) {
  if (!data || typeof data !== 'object') return null
  if (Array.isArray(data)) {
    return data.map((item) => maskObject(resourceType, role, item)).filter(Boolean)
  }

  const allowlist = RESOURCE_FIELD_ALLOWLIST[resourceType]?.[role]
  if (!allowlist || allowlist.length === 0) {
    return null
  }

  const masked = {}
  for (const field of allowlist) {
    if (Object.prototype.hasOwnProperty.call(data, field) && data[field] !== undefined) {
      masked[field] = data[field]
    }
  }

  // Enforce k >= 20 small-cell suppression on commercial/aggregate data
  if (resourceType === 'commercial_aggregates') {
    const count = Number(data.total_orders ?? data.cohort_size ?? 0)
    if (count < K_RETAILER_OUTPUT) {
      masked.is_suppressed = true
      masked.total_orders = null
      masked.aggregate_grade_distribution = null
      masked.unscored_share = null
      masked.suppression_reason = `Cohort size (${count}) is below privacy threshold (k >= ${K_RETAILER_OUTPUT})`
    } else {
      masked.is_suppressed = false
    }
  }

  return masked
}
