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

/**
 * Derives dynamic navigation items from server-computed capabilities (Blueprint §4.1).
 * Eliminates static role-to-screen assumptions and closes authorization discrepancy gaps.
 */
export function deriveNavigationFromCapabilities(can: (capability: string) => boolean): CadNavigationId[] {
  const nav: CadNavigationId[] = ['overview']

  if (can('patients.targets.read') || can('patients.targets.write')) {
    nav.push('targets')
  }

  if (can('modes.read') || can('modes.propose') || can('modes.approve')) {
    nav.push('modes')
  }

  if (can('consent.status.read') || can('consent.record')) {
    nav.push('consent')
  }

  if (can('patients.directory.read')) {
    nav.push('users')
  }

  if (can('audit.verify')) {
    nav.push('audit')
  }

  nav.push('settings')
  return nav
}
