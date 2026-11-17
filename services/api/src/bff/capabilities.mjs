// services/api/src/bff/capabilities.mjs
// Capability Catalog & Engine for CAD Views (Blueprint §3.5, §4.1)

import { createHash } from 'node:crypto'

export const CAPABILITY_CATALOG = [
  {
    name: 'patients.directory.read',
    action: 'read',
    resource: 'patient_directory',
    class: 'PHI1',
    roles: [
      'writing_clinician',
      'viewing_dietician',
      'tenant_admin',
      'patient',
      'compliance_auditor',
    ],
    stepUp: false,
  },
  {
    name: 'patients.targets.read',
    action: 'read',
    resource: 'target_bundles',
    class: 'PHI2',
    roles: ['writing_clinician', 'viewing_dietician', 'patient'],
    stepUp: false,
  },
  {
    name: 'patients.targets.write',
    action: 'update',
    resource: 'target_bundles',
    class: 'PHI2',
    roles: ['writing_clinician'],
    stepUp: true,
  },
  {
    name: 'modes.read',
    action: 'read',
    resource: 'health_modes',
    class: 'ADMIN',
    roles: ['writing_clinician', 'viewing_dietician', 'tenant_admin'],
    stepUp: false,
  },
  {
    name: 'modes.propose',
    action: 'propose',
    resource: 'health_modes',
    class: 'ADMIN',
    roles: ['tenant_admin'],
    stepUp: false,
  },
  {
    name: 'modes.approve',
    action: 'approve',
    resource: 'health_modes',
    class: 'ADMIN',
    roles: ['writing_clinician'],
    stepUp: true,
  },
  {
    name: 'consent.status.read',
    action: 'read',
    resource: 'consent_register',
    class: 'PHI1',
    roles: ['writing_clinician', 'viewing_dietician', 'tenant_admin', 'compliance_auditor'],
    stepUp: false,
  },
  {
    name: 'consent.record',
    action: 'update',
    resource: 'consent_register',
    class: 'PHI1',
    roles: ['writing_clinician', 'patient'],
    stepUp: true,
  },
  {
    name: 'audit.verify',
    action: 'read',
    resource: 'audit_ledger',
    class: 'AUDIT',
    roles: ['compliance_auditor', 'tenant_admin', 'super_admin'],
    stepUp: false,
  },
]

export function computeCapabilitiesForSubject(subject) {
  const role = subject.role || subject.app_role
  const acr = Number(subject.acr || 1)
  const allowedCaps = []
  const stepUpRequired = []

  for (const cap of CAPABILITY_CATALOG) {
    if (cap.roles.includes(role)) {
      if (cap.stepUp && acr < 2 && role !== 'patient') {
        stepUpRequired.push(cap.name)
      } else {
        allowedCaps.push(cap.name)
      }
    }
  }

  allowedCaps.sort()
  stepUpRequired.sort()

  const capsHash = createHash('sha256').update(allowedCaps.join(',')).digest('hex')

  return {
    caps: allowedCaps,
    caps_hash: capsHash,
    step_up_required: stepUpRequired,
    tenant: {
      id: subject.tenantId || subject.tenant_id || 'unknown-tenant',
      label: subject.tenantLabel || 'Primary Health Organization',
    },
  }
}
