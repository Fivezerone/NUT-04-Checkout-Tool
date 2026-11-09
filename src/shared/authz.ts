// src/shared/authz.ts
// NutriScore CAD Blueprint Phase 4
// Shared ABAC & RBAC Policy Engine implementing ordered decide() algorithm
// Reference: Blueprint §1.3, §4.2; Amendments A1-A3; Decisions D1-D5

import type { CadRole } from './claims'

export type Action = 'create' | 'read' | 'update' | 'delete'

export type ResourceClass = 'PHI1' | 'PHI2' | 'ADMIN' | 'COMMERCIAL' | 'AUDIT' | 'AUDIT_META'

export interface Subject {
  sub: string
  sid?: string
  role: CadRole // app_role canonical claim
  tenantId?: string
  auditorScope?: 'tenant' | 'platform'
  licenceVerified?: boolean
  acr?: number // Authentication Context Class Reference: 1 = password, >= 2 = step-up / MFA
}

export interface Resource {
  type:
    | 'tenants'
    | 'accounts'
    | 'patient_directory'
    | 'clinical_records'
    | 'clinical_advice'
    | 'dietary_tags'
    | 'target_bundles'
    | 'consent_register'
    | 'audit_ledger'
    | 'catalogue'
    | 'commercial_orders'
    | 'commercial_aggregates'
    | string
  class: ResourceClass
  tenantId?: string
  patientId?: string
  authorId?: string
  requiresConsent?: string
}

export interface Obligation {
  type: string
  detail?: Record<string, unknown>
}

export interface Decision {
  allowed: boolean
  reason?: string
  status: 200 | 403
  obligations: Obligation[]
}

export interface DecisionAdapters {
  denylist?: {
    has(sid?: string): Promise<boolean> | boolean
  }
  members?: {
    status(sub: string): Promise<string | null> | (string | null)
    licenceVerified(sub: string): Promise<boolean> | boolean
  }
  relationships?: {
    active(
      tenantId: string,
      staffId: string,
      patientId: string,
      now: Date,
    ): Promise<{ canWrite: boolean } | null> | ({ canWrite: boolean } | null)
  }
  emergency?: {
    valid(
      tenantId: string,
      staffId: string,
      patientId: string,
      now: Date,
    ): Promise<boolean> | boolean
  }
  consent?: {
    active(patientId: string, purpose: string): Promise<boolean> | boolean
  }
}

// 1. RBAC Matrix from Blueprint §1.3 (7 roles x 12 resources x create/read/update)
export const PERMISSIONS: Record<CadRole, Set<string>> = {
  super_admin: new Set([
    'tenants:create',
    'tenants:read',
    'tenants:update',
    'accounts:create',
    'accounts:read',
    'accounts:update',
    'target_bundles:read',
    'commercial_aggregates:read',
  ]),
  tenant_admin: new Set([
    'accounts:create',
    'accounts:read',
    'accounts:update',
    'patient_directory:read',
    'consent_register:read',
    'commercial_aggregates:read',
  ]),
  writing_clinician: new Set([
    'accounts:create',
    'accounts:read',
    'patient_directory:read',
    'clinical_records:create',
    'clinical_records:read',
    'clinical_records:update',
    'clinical_advice:create',
    'clinical_advice:read',
    'clinical_advice:update',
    'dietary_tags:read',
    'target_bundles:create',
    'target_bundles:read',
    'target_bundles:update',
    'consent_register:read',
  ]),
  viewing_dietician: new Set([
    'patient_directory:read',
    'clinical_advice:read',
    'dietary_tags:create',
    'dietary_tags:read',
    'dietary_tags:update',
    'target_bundles:read',
  ]),
  compliance_auditor: new Set([
    'consent_register:read',
    'audit_ledger:read',
    'commercial_aggregates:read',
  ]),
  commercial_stakeholder: new Set([
    'catalogue:create',
    'catalogue:read',
    'catalogue:update',
    'commercial_orders:read',
    'commercial_aggregates:read',
  ]),
  patient: new Set([
    'accounts:read',
    'accounts:update',
    'patient_directory:read',
    'clinical_advice:read',
    'dietary_tags:read',
    'target_bundles:read',
    'consent_register:read',
    'consent_register:update',
    'catalogue:read',
    'commercial_orders:create',
    'commercial_orders:read',
  ]),
}

// 2. Classification Clearances
export const CLEARANCE: Record<CadRole, Set<ResourceClass>> = {
  super_admin: new Set(['ADMIN', 'COMMERCIAL', 'AUDIT_META']),
  tenant_admin: new Set(['ADMIN', 'COMMERCIAL', 'AUDIT']),
  writing_clinician: new Set(['PHI1', 'PHI2', 'ADMIN']),
  viewing_dietician: new Set(['PHI1', 'PHI2', 'ADMIN']),
  compliance_auditor: new Set(['AUDIT', 'AUDIT_META', 'COMMERCIAL', 'ADMIN']),
  commercial_stakeholder: new Set(['COMMERCIAL']),
  patient: new Set(['PHI1', 'PHI2', 'ADMIN', 'COMMERCIAL']),
}

export const CLINICAL_STAFF = new Set<CadRole>(['writing_clinician', 'viewing_dietician'])

// 3. Sensitive actions requiring step-up (acr >= 2)
export const STEP_UP = new Set<string>([
  'target_bundles:create',
  'target_bundles:update',
  'emergency_grants:create',
  'accounts:update',
  'retention_policies:update',
])

export function isWrite(action: Action): boolean {
  return action === 'create' || action === 'update' || action === 'delete'
}

export function audit(r: Resource, action: Action): Obligation {
  return {
    type: 'AUDIT',
    detail: { resource: r.type, class: r.class, action, patientId: r.patientId },
  }
}

export function notifyDpo(): Obligation {
  return { type: 'NOTIFY_DPO' }
}

export function notifyAuditor(): Obligation {
  return { type: 'NOTIFY_AUDITOR' }
}

export function flag(tag: string): Obligation {
  return { type: 'FLAG', detail: { tag } }
}

export function deny(reason: string): Decision {
  return {
    allowed: false,
    reason,
    status: 403,
    obligations: [],
  }
}

export function allow(obligations: Obligation[] = []): Decision {
  return {
    allowed: true,
    status: 200,
    obligations,
  }
}

/**
 * Ordered ABAC decision algorithm from Blueprint §1.3.
 * First deny wins. Callers receive a generic 403 HTTP response;
 * the specific reason is recorded in the immutable audit log.
 */
export async function decide(
  s: Subject,
  action: Action,
  r: Resource,
  now: Date = new Date(),
  adapters: DecisionAdapters = {},
): Promise<Decision> {
  const obligations: Obligation[] = []
  if (r.class === 'PHI1' || r.class === 'PHI2') {
    obligations.push(audit(r, action))
  }

  // 1. Account inactive check (denylist or member status != active)
  const isDenylisted = s.sid && adapters.denylist ? await adapters.denylist.has(s.sid) : false
  const memberStatus = adapters.members ? await adapters.members.status(s.sub) : 'active'
  if (isDenylisted || memberStatus !== 'active') {
    return deny('ACCOUNT_INACTIVE')
  }

  // 2. Tenant mismatch check (platform auditor reading AUDIT_META is the sole cross-tenant exception)
  const platformMeta =
    s.role === 'compliance_auditor' && s.auditorScope === 'platform' && r.class === 'AUDIT_META'
  if (r.tenantId && s.tenantId && r.tenantId !== s.tenantId && !platformMeta) {
    return deny('TENANT_MISMATCH')
  }
  if (r.tenantId && !s.tenantId && !platformMeta && s.role !== 'super_admin') {
    return deny('TENANT_MISMATCH')
  }

  // 3. RBAC permission check
  const rolePermissions = PERMISSIONS[s.role]
  if (!rolePermissions || !rolePermissions.has(`${r.type}:${action}`)) {
    return deny('RBAC')
  }

  // 4. Classification clearance check
  const roleClearance = CLEARANCE[s.role]
  if (!roleClearance || !roleClearance.has(r.class)) {
    return deny('CLASSIFICATION')
  }

  // 5. Relationship and Break-Glass for clinical staff accessing patient data
  if (r.patientId && CLINICAL_STAFF.has(s.role)) {
    const rel = adapters.relationships
      ? await adapters.relationships.active(s.tenantId || '', s.sub, r.patientId, now)
      : null
    const bg = rel
      ? null
      : adapters.emergency
        ? await adapters.emergency.valid(s.tenantId || '', s.sub, r.patientId, now)
        : false

    if (!rel && !bg) {
      return deny('NO_RELATIONSHIP')
    }
    if (bg && action !== 'read') {
      return deny('BREAK_GLASS_READ_ONLY')
    }
    if (isWrite(action)) {
      const isLicenceOk =
        s.licenceVerified ??
        (adapters.members ? await adapters.members.licenceVerified(s.sub) : false)
      if (!rel?.canWrite || !isLicenceOk) {
        return deny('LICENCE_OR_RELATIONSHIP')
      }
    }
    if (bg) {
      obligations.push(notifyDpo(), notifyAuditor(), flag('break_glass'))
    }
  }

  // 6. Consent check
  if (r.requiresConsent) {
    const hasConsent =
      r.patientId && adapters.consent
        ? await adapters.consent.active(r.patientId, r.requiresConsent)
        : false
    if (!hasConsent) {
      return deny('NO_CONSENT')
    }
  }

  // 7. Step-up authentication check (acr >= 2)
  if (STEP_UP.has(`${r.type}:${action}`) && (s.acr ?? 1) < 2) {
    return deny('STEP_UP_REQUIRED')
  }

  return allow(obligations)
}

/**
 * Maps a policy Decision to a standard HTTP Response object.
 * Denials always produce a generic 403 Forbidden body so internal
 * decision reasons are not leaked to external callers.
 */
export function toHttpResponse(decision: Decision): Response {
  if (decision.allowed) {
    return new Response(JSON.stringify({ success: true, obligations: decision.obligations }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({ error: 'forbidden', message: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}
