import type { CadRole } from './types'

export type CadNavigationId =
  | 'overview'
  | 'targets'
  | 'modes'
  | 'consent'
  | 'users'
  | 'audit'
  | 'billing'
  | 'settings'
  | 'platform'

const ROLE_NAVIGATION: Record<CadRole, CadNavigationId[]> = {
  super_admin: ['overview', 'platform', 'users', 'targets', 'modes', 'consent', 'audit', 'billing', 'settings'],
  tenant_admin: ['overview', 'users', 'targets', 'modes', 'consent', 'audit', 'billing', 'settings'],
  writing_clinician: ['overview', 'targets', 'modes', 'consent'],
  viewing_dietician: ['overview', 'targets', 'modes', 'consent'],
  compliance_auditor: ['overview', 'audit'],
  commercial_stakeholder: ['overview'],
  patient: ['overview'],
}

export function getCadNavigationIds(role: CadRole): CadNavigationId[] {
  return ROLE_NAVIGATION[role]
}
