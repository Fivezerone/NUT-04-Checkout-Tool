// src/ui/src/cad/types.ts
// Type definitions for Clinic Admin Dashboard (CAD)
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md

export type CadRole =
  | 'super_admin'
  | 'compliance_auditor'
  | 'tenant_admin'
  | 'writing_clinician'
  | 'viewing_dietician'
  | 'commercial_stakeholder'
  | 'patient'

export type TenantStatus =
  | 'pending_activation'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'cancelled'

export interface Tenant {
  id: string
  name: string
  slug: string
  status: TenantStatus
  config: {
    rule_pack?: string
    language?: 'en' | 'sw'
    small_cell_k?: number
    is_platform_default?: boolean
    branding?: {
      primaryColor?: string
      logoUrl?: string
    }
  }
  config_version: number
  created_at: string
  updated_at: string
}

export interface TenantMember {
  tenant_id: string
  user_id: string
  email?: string
  role: CadRole
  licence_number?: string
  licence_expiry?: string
  licence_verified: boolean
  status: 'active' | 'suspended' | 'revoked'
  created_at: string
}

export type MutationType =
  | 'create'
  | 'update'
  | 'suspend'
  | 'revoke'
  | 'read'
  | 'export'
  | 'break_glass'

export interface AuditLogEntry {
  event_id: string
  tenant_id: string
  seq: number
  occurred_at: string
  actor_id: string
  actor_role: string
  session_id?: string
  action: string
  mutation_type: MutationType
  resource_type: string
  resource_id?: string
  subject_ref?: string
  reason: string
  prev_hash?: string
  row_hash: string
}

export interface NutrientTarget {
  target_id: string
  tenant_id: string
  version: number
  supersedes?: string
  scope: 'platform' | 'tenant' | 'cohort' | 'patient'
  subject_ref?: string
  nutrient_code: string
  unit: 'mg' | 'g' | 'kcal' | 'kJ'
  basis: 'per_100g' | 'per_100ml' | 'per_serving' | 'per_item' | 'per_cart' | 'per_day'
  comparator: 'lt' | 'lte' | 'gt' | 'gte' | 'between'
  value: number
  value_max?: number
  severity: 'info' | 'caution' | 'critical'
  valid_from: string
  valid_to?: string
  status: 'draft' | 'pending_cosign' | 'active' | 'suspended' | 'revoked' | 'expired'
  set_by: string
  cosigned_by?: string
  evidence_ref?: string
  reason: string
  created_at: string
}

