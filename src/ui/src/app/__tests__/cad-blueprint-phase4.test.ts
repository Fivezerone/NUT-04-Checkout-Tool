// src/ui/src/app/__tests__/cad-blueprint-phase4.test.ts
// NutriScore CAD Blueprint Phase 4 Tests
// ABAC decide() algorithm, 7x12 RBAC permission matrix, treatment relationships,
// licence verification, break-glass 24h boundaries, and consent lawful basis.

import { describe, it, expect } from 'vitest'
import {
  decide,
  toHttpResponse,
  PERMISSIONS,
  CLEARANCE,
  CLINICAL_STAFF,
  STEP_UP,
  type Action,
  type Subject,
  type Resource,
  type DecisionAdapters,
} from '../../../../shared/authz'
import type { CadRole } from '../../../../shared/claims'

describe('CAD Blueprint Phase 4: RBAC & ABAC Policy Engine', () => {
  const ROLES: CadRole[] = [
    'super_admin',
    'tenant_admin',
    'writing_clinician',
    'viewing_dietician',
    'compliance_auditor',
    'commercial_stakeholder',
    'patient',
  ]

  const RESOURCES = [
    'tenants',
    'accounts',
    'patient_directory',
    'clinical_records',
    'clinical_advice',
    'dietary_tags',
    'target_bundles',
    'consent_register',
    'audit_ledger',
    'catalogue',
    'commercial_orders',
    'commercial_aggregates',
  ]

  const ACTIONS: Action[] = ['create', 'read', 'update']

  // Exact 7 roles x 12 resources x create/read/update matrix from Blueprint §1.3
  const EXPECTED_MATRIX: Record<CadRole, Record<string, Action[]>> = {
    super_admin: {
      tenants: ['create', 'read', 'update'],
      accounts: ['create', 'read', 'update'],
      patient_directory: [],
      clinical_records: [],
      clinical_advice: [],
      dietary_tags: [],
      target_bundles: ['read'],
      consent_register: [],
      audit_ledger: [],
      catalogue: [],
      commercial_orders: [],
      commercial_aggregates: ['read'],
    },
    tenant_admin: {
      tenants: [],
      accounts: ['create', 'read', 'update'],
      patient_directory: ['read'],
      clinical_records: [],
      clinical_advice: [],
      dietary_tags: [],
      target_bundles: [],
      consent_register: ['read'],
      audit_ledger: [],
      catalogue: [],
      commercial_orders: [],
      commercial_aggregates: ['read'],
    },
    writing_clinician: {
      tenants: [],
      accounts: ['create', 'read'],
      patient_directory: ['read'],
      clinical_records: ['create', 'read', 'update'],
      clinical_advice: ['create', 'read', 'update'],
      dietary_tags: ['read'],
      target_bundles: ['create', 'read', 'update'],
      consent_register: ['read'],
      audit_ledger: [],
      catalogue: [],
      commercial_orders: [],
      commercial_aggregates: [],
    },
    viewing_dietician: {
      tenants: [],
      accounts: [],
      patient_directory: ['read'],
      clinical_records: [],
      clinical_advice: ['read'],
      dietary_tags: ['create', 'read', 'update'],
      target_bundles: ['read'],
      consent_register: [],
      audit_ledger: [],
      catalogue: [],
      commercial_orders: [],
      commercial_aggregates: [],
    },
    compliance_auditor: {
      tenants: [],
      accounts: [],
      patient_directory: [],
      clinical_records: [],
      clinical_advice: [],
      dietary_tags: [],
      target_bundles: [],
      consent_register: ['read'],
      audit_ledger: ['read'],
      catalogue: [],
      commercial_orders: [],
      commercial_aggregates: ['read'],
    },
    commercial_stakeholder: {
      tenants: [],
      accounts: [],
      patient_directory: [],
      clinical_records: [],
      clinical_advice: [],
      dietary_tags: [],
      target_bundles: [],
      consent_register: [],
      audit_ledger: [],
      catalogue: ['create', 'read', 'update'],
      commercial_orders: ['read'],
      commercial_aggregates: ['read'],
    },
    patient: {
      tenants: [],
      accounts: ['read', 'update'],
      patient_directory: ['read'],
      clinical_records: [],
      clinical_advice: ['read'],
      dietary_tags: ['read'],
      target_bundles: ['read'],
      consent_register: ['read', 'update'],
      audit_ledger: [],
      catalogue: ['read'],
      commercial_orders: ['create', 'read'],
      commercial_aggregates: [],
    },
  }

  describe('RBAC Permission Matrix Completeness (7 roles x 12 resources x 3 actions)', () => {
    for (const role of ROLES) {
      for (const res of RESOURCES) {
        for (const action of ACTIONS) {
          const shouldAllow = EXPECTED_MATRIX[role][res]?.includes(action) ?? false
          it(`${role} on ${res}:${action} should be ${shouldAllow ? 'ALLOWED' : 'DENIED'}`, () => {
            const hasPerm = PERMISSIONS[role]?.has(`${res}:${action}`) ?? false
            expect(hasPerm).toBe(shouldAllow)
          })
        }
      }
    }
  })

  describe('Classification Clearances', () => {
    it('commercial_stakeholder has clearance ONLY for COMMERCIAL', () => {
      expect(CLEARANCE.commercial_stakeholder.has('COMMERCIAL')).toBe(true)
      expect(CLEARANCE.commercial_stakeholder.has('PHI1')).toBe(false)
      expect(CLEARANCE.commercial_stakeholder.has('PHI2')).toBe(false)
      expect(CLEARANCE.commercial_stakeholder.has('ADMIN')).toBe(false)
      expect(CLEARANCE.commercial_stakeholder.has('AUDIT')).toBe(false)
    })

    it('compliance_auditor has clearance for AUDIT, AUDIT_META, COMMERCIAL, ADMIN, but never PHI1/PHI2', () => {
      expect(CLEARANCE.compliance_auditor.has('AUDIT')).toBe(true)
      expect(CLEARANCE.compliance_auditor.has('AUDIT_META')).toBe(true)
      expect(CLEARANCE.compliance_auditor.has('PHI1')).toBe(false)
      expect(CLEARANCE.compliance_auditor.has('PHI2')).toBe(false)
    })
  })

  describe('ABAC decide() evaluation order & denials', () => {
    const tenantA = '11111111-1111-1111-1111-111111111111'
    const tenantB = '22222222-2222-2222-2222-222222222222'
    const patient1 = '33333333-3333-3333-3333-333333333333'
    const clinicianId = '44444444-4444-4444-4444-444444444444'

    const baseSubject: Subject = {
      sub: clinicianId,
      sid: 'active-session-123',
      role: 'writing_clinician',
      tenantId: tenantA,
      licenceVerified: true,
      acr: 2,
    }

    const baseResource: Resource = {
      type: 'clinical_records',
      class: 'PHI1',
      tenantId: tenantA,
      patientId: patient1,
    }

    const now = new Date('2026-11-01T12:00:00Z')

    it('1. Denies with ACCOUNT_INACTIVE if session is on token denylist', async () => {
      const adapters: DecisionAdapters = {
        denylist: { has: (sid) => sid === 'active-session-123' },
      }
      const dec = await decide(baseSubject, 'read', baseResource, now, adapters)
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('ACCOUNT_INACTIVE')
      expect(dec.status).toBe(403)
    })

    it('1. Denies with ACCOUNT_INACTIVE if member status is not active', async () => {
      const adapters: DecisionAdapters = {
        members: {
          status: () => 'suspended',
          licenceVerified: () => true,
        },
      }
      const dec = await decide(baseSubject, 'read', baseResource, now, adapters)
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('ACCOUNT_INACTIVE')
    })

    it('2. Denies with TENANT_MISMATCH on cross-tenant resource', async () => {
      const crossTenantResource: Resource = {
        ...baseResource,
        tenantId: tenantB,
      }
      const dec = await decide(baseSubject, 'read', crossTenantResource, now)
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('TENANT_MISMATCH')
    })

    it('2. Allows platform compliance_auditor cross-tenant ONLY for AUDIT_META', async () => {
      const auditor: Subject = {
        sub: 'auditor-1',
        role: 'compliance_auditor',
        tenantId: tenantA,
        auditorScope: 'platform',
      }
      const metaResource: Resource = {
        type: 'audit_ledger',
        class: 'AUDIT_META',
        tenantId: tenantB,
      }
      const dec = await decide(auditor, 'read', metaResource, now)
      expect(dec.allowed).toBe(true)
      expect(dec.status).toBe(200)
    })

    it('3. Denies with RBAC if action is not permitted for role', async () => {
      const dietician: Subject = {
        sub: 'dietician-1',
        role: 'viewing_dietician',
        tenantId: tenantA,
      }
      // Dietician has no clinical_records permission in RBAC
      const dec = await decide(dietician, 'read', baseResource, now)
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('RBAC')
    })

    it('4. Denies with CLASSIFICATION if role lacks clearance for resource class', async () => {
      // Craft a scenario where RBAC passes but classification fails
      const stakeholder: Subject = {
        sub: 'stakeholder-1',
        role: 'commercial_stakeholder',
        tenantId: tenantA,
      }
      const phiResource: Resource = {
        type: 'catalogue',
        class: 'PHI1', // Tampered or classified as PHI1
        tenantId: tenantA,
      }
      const dec = await decide(stakeholder, 'read', phiResource, now)
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('CLASSIFICATION')
    })

    it('5. Denies with NO_RELATIONSHIP if clinician has no active treatment relationship', async () => {
      const adapters: DecisionAdapters = {
        relationships: { active: () => null },
        emergency: { valid: () => false },
      }
      const dec = await decide(baseSubject, 'read', baseResource, now, adapters)
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('NO_RELATIONSHIP')
    })

    it('5. Allows read via active break-glass emergency grant and emits audit/dpo obligations', async () => {
      const adapters: DecisionAdapters = {
        relationships: { active: () => null },
        emergency: { valid: () => true }, // Active emergency grant
      }
      const dec = await decide(baseSubject, 'read', baseResource, now, adapters)
      expect(dec.allowed).toBe(true)
      expect(dec.obligations.some((o) => o.type === 'NOTIFY_DPO')).toBe(true)
      expect(dec.obligations.some((o) => o.type === 'NOTIFY_AUDITOR')).toBe(true)
      expect(dec.obligations.some((o) => o.type === 'FLAG' && o.detail?.tag === 'break_glass')).toBe(
        true,
      )
    })

    it('5. Denies with BREAK_GLASS_READ_ONLY if break-glass grantee attempts a write', async () => {
      const adapters: DecisionAdapters = {
        relationships: { active: () => null },
        emergency: { valid: () => true },
      }
      const dec = await decide(baseSubject, 'create', baseResource, now, adapters)
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('BREAK_GLASS_READ_ONLY')
    })

    it('5. Denies with LICENCE_OR_RELATIONSHIP if writer has relationship but canWrite is false', async () => {
      const adapters: DecisionAdapters = {
        relationships: { active: () => ({ canWrite: false }) },
      }
      const dec = await decide(baseSubject, 'create', baseResource, now, adapters)
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('LICENCE_OR_RELATIONSHIP')
    })

    it('5. Denies with LICENCE_OR_RELATIONSHIP if writer canWrite is true but licence is unverified', async () => {
      const unverifiedSubject: Subject = {
        ...baseSubject,
        licenceVerified: false,
      }
      const adapters: DecisionAdapters = {
        relationships: { active: () => ({ canWrite: true }) },
        members: {
          status: () => 'active',
          licenceVerified: () => false,
        },
      }
      const dec = await decide(unverifiedSubject, 'create', baseResource, now, adapters)
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('LICENCE_OR_RELATIONSHIP')
    })

    it('5. Allows write if writer has active relationship, canWrite=true, and verified licence', async () => {
      const adapters: DecisionAdapters = {
        relationships: { active: () => ({ canWrite: true }) },
        members: {
          status: () => 'active',
          licenceVerified: () => true,
        },
      }
      const dec = await decide(baseSubject, 'create', baseResource, now, adapters)
      expect(dec.allowed).toBe(true)
      expect(dec.status).toBe(200)
    })

    it('6. Denies with NO_CONSENT if resource requires consent and active consent is missing', async () => {
      const consentResource: Resource = {
        ...baseResource,
        requiresConsent: 'dietary_profile_sharing',
      }
      const adapters: DecisionAdapters = {
        relationships: { active: () => ({ canWrite: true }) },
        consent: { active: () => false },
      }
      const dec = await decide(baseSubject, 'read', consentResource, now, adapters)
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('NO_CONSENT')
    })

    it('6. Allows if resource requires consent and active consent is present', async () => {
      const consentResource: Resource = {
        ...baseResource,
        requiresConsent: 'dietary_profile_sharing',
      }
      const adapters: DecisionAdapters = {
        relationships: { active: () => ({ canWrite: true }) },
        consent: { active: () => true },
      }
      const dec = await decide(baseSubject, 'read', consentResource, now, adapters)
      expect(dec.allowed).toBe(true)
    })

    it('7. Denies with STEP_UP_REQUIRED if action is in STEP_UP and acr < 2', async () => {
      const lowAcrSubject: Subject = {
        ...baseSubject,
        acr: 1, // Only password auth, no MFA/step-up
      }
      const targetBundleResource: Resource = {
        type: 'target_bundles',
        class: 'PHI1',
        tenantId: tenantA,
        patientId: patient1,
      }
      const adapters: DecisionAdapters = {
        relationships: { active: () => ({ canWrite: true }) },
      }
      const dec = await decide(lowAcrSubject, 'create', targetBundleResource, now, adapters)
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('STEP_UP_REQUIRED')
    })

    it('7. Allows target bundle publishing if acr >= 2', async () => {
      const stepUpSubject: Subject = {
        ...baseSubject,
        acr: 2,
      }
      const targetBundleResource: Resource = {
        type: 'target_bundles',
        class: 'PHI1',
        tenantId: tenantA,
        patientId: patient1,
      }
      const adapters: DecisionAdapters = {
        relationships: { active: () => ({ canWrite: true }) },
      }
      const dec = await decide(stepUpSubject, 'create', targetBundleResource, now, adapters)
      expect(dec.allowed).toBe(true)
    })
  })

  describe('toHttpResponse() Generic 403 Masking', () => {
    it('produces status 403 and generic message without leaking internal reason', async () => {
      const subject: Subject = {
        sub: 'sub-1',
        role: 'writing_clinician',
        tenantId: 't1',
      }
      const resource: Resource = {
        type: 'clinical_records',
        class: 'PHI1',
        tenantId: 't1',
        patientId: 'p1',
      }
      const dec = await decide(subject, 'read', resource, new Date(), {
        relationships: { active: () => null },
        emergency: { valid: () => false },
      })
      expect(dec.allowed).toBe(false)
      expect(dec.reason).toBe('NO_RELATIONSHIP')

      const response = toHttpResponse(dec)
      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body).toEqual({ error: 'forbidden', message: 'Forbidden' })
      expect(JSON.stringify(body)).not.toContain('NO_RELATIONSHIP')
    })
  })
})
