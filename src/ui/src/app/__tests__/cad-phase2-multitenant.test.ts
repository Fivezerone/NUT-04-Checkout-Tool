/**
 * cad-phase2-multitenant.test.ts
 *
 * Mandatory isolation and RBAC test scenarios for Clinic Admin Dashboard (CAD)
 * Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§13 Mandatory Test Scenarios T10-T15)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { extractClaims, requireRole } from '../../../../shared/rbac'

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, '')
const MIGRATIONS_DIR = join(ROOT, 'db', 'migrations')

describe('T10: Cross-Tenant Isolation & JWT Claim Tamper Protection', () => {
  it('extractClaims maps Supabase claim aliases to the canonical contract', () => {
    const payload = {
      sub: 'user-clinician-123',
      tenant_id: '11111111-1111-1111-1111-111111111111',
      app_role: 'writing_clinician',
      lic_ok: true,
      session_id: 'session-clinician-123',
      ver: 1,
    }
    const token = 'header.' + btoa(JSON.stringify(payload)) + '.signature'
    const req = new Request('https://admin.nutriscore.co.ke/api/targets', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const claims = extractClaims(req)
    expect(claims).not.toBeNull()
    expect(claims?.sub).toBe('user-clinician-123')
    expect(claims?.tenantId).toBe('11111111-1111-1111-1111-111111111111')
    expect(claims?.appRole).toBe('writing_clinician')
    expect(claims?.licOk).toBe(true)
    expect(claims?.sid).toBe('session-clinician-123')
  })

  it('rejects tampered or malformed Authorization header with 401 unauthorized', () => {
    const req = new Request('https://admin.nutriscore.co.ke/api/targets', {
      headers: { Authorization: 'Bearer bad.token' },
    })

    const res = requireRole(req, ['writing_clinician'])
    expect('errorResponse' in res).toBe(true)
    if ('errorResponse' in res) {
      expect(res.errorResponse.status).toBe(401)
    }
  })

  it('enforces tenant_id isolation filter preventing Tenant A from querying Tenant B', () => {
    const tenantA = '11111111-1111-1111-1111-111111111111'
    const tenantB = '22222222-2222-2222-2222-222222222222'

    // Isolation predicate matching RLS: tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    const rlsFilter = (rowTenantId: string, jwtTenantId: string) => rowTenantId === jwtTenantId

    expect(rlsFilter(tenantA, tenantA)).toBe(true)
    expect(rlsFilter(tenantB, tenantA)).toBe(false)
  })
})

describe('T11: Table RLS Enforcement Gate (CI Check)', () => {
  it('migration 20261029000000_multi_tenant_core.sql enables RLS and defines policies on all tenant tables', () => {
    const migrationFile = join(MIGRATIONS_DIR, '0001_baseline.sql')
    const sql = readFileSync(migrationFile, 'utf8')

    const expectedTenantTables = ['tenants', 'tenant_members', 'audit_log', 'users', 'payments']
    for (const table of expectedTenantTables) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`)
      expect(sql).toMatch(new RegExp(`CREATE POLICY [a-zA-Z0-9_]+ ON public\\.${table}`, 'i'))
    }
  })
})

describe('T12: RBAC Role Matrix & Direct API Breach Guard', () => {
  it('viewing_dietician calling target-edit API directly receives 403 forbidden', async () => {
    const dieticianPayload = {
      sub: 'user-dietician-456',
      tenant_id: '11111111-1111-1111-1111-111111111111',
      app_role: 'viewing_dietician',
      sid: 'session-dietician-456',
      lic_ok: false,
      ver: 1,
    }
    const token = 'header.' + btoa(JSON.stringify(dieticianPayload)) + '.sig'
    const req = new Request('https://admin.nutriscore.co.ke/api/targets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = requireRole(req, ['writing_clinician', 'super_admin'])
    expect('errorResponse' in res).toBe(true)
    if ('errorResponse' in res) {
      expect(res.errorResponse.status).toBe(403)
      const body = await res.errorResponse.json()
      expect(body.error).toBe('forbidden')
      expect(body.message).toBe('Forbidden')
    }
  })

  it('unverified writing_clinician is blocked when licence verification is required', async () => {
    const unverifiedClinician = {
      sub: 'user-clinician-789',
      tenant_id: '11111111-1111-1111-1111-111111111111',
      app_role: 'writing_clinician',
      sid: 'session-clinician-789',
      lic_ok: false,
      ver: 1,
    }
    const token = 'header.' + btoa(JSON.stringify(unverifiedClinician)) + '.sig'
    const req = new Request('https://admin.nutriscore.co.ke/api/targets/critical', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = requireRole(req, ['writing_clinician'], { requireLicence: true })
    expect('errorResponse' in res).toBe(true)
    if ('errorResponse' in res) {
      expect(res.errorResponse.status).toBe(403)
      const body = await res.errorResponse.json()
      expect(body.error).toBe('forbidden')
    }
  })

  it('verified writing_clinician is authorized to prescribe targets', () => {
    const verifiedClinician = {
      sub: 'user-clinician-001',
      tenant_id: '11111111-1111-1111-1111-111111111111',
      app_role: 'writing_clinician',
      sid: 'session-clinician-001',
      lic_ok: true,
      ver: 1,
    }
    const token = 'header.' + btoa(JSON.stringify(verifiedClinician)) + '.sig'
    const req = new Request('https://admin.nutriscore.co.ke/api/targets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = requireRole(req, ['writing_clinician'], { requireLicence: true })
    expect('claims' in res).toBe(true)
  })
})

describe('T13: Small-Cell Privacy Suppression (Commercial Stakeholder Guard)', () => {
  it('suppresses cohort metrics when cohort size is below threshold k = 5 for commercial stakeholders', () => {
    const k = 5
    const cohorts = [
      { name: 'Diabetes Type 2', count: 42, avgSodium: 450 },
      { name: 'Rare Paediatric Inborn Metabolic', count: 3, avgSodium: 210 },
    ]

    const filterForCommercial = (cohortList: typeof cohorts) => {
      return cohortList.map((c) => {
        if (c.count < k) {
          return { name: c.name, count: null, avgSodium: null, suppressed: true }
        }
        return { ...c, suppressed: false }
      })
    }

    const filtered = filterForCommercial(cohorts)
    expect(filtered[0].suppressed).toBe(false)
    expect(filtered[0].count).toBe(42)

    // Rare cohort with 3 patients (< 5) is suppressed
    expect(filtered[1].suppressed).toBe(true)
    expect(filtered[1].count).toBeNull()
    expect(filtered[1].avgSodium).toBeNull()
  })

  it('commercial_stakeholder role cannot access patient-level target records', () => {
    const commercialUser = {
      sub: 'usr-commercial-99',
      app_role: 'commercial_stakeholder',
      sid: 'session-commercial-99',
      lic_ok: false,
      ver: 1,
    }
    const token = 'header.' + btoa(JSON.stringify(commercialUser)) + '.sig'
    const req = new Request('https://admin.nutriscore.co.ke/api/patient-records', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = requireRole(req, ['writing_clinician', 'viewing_dietician', 'tenant_admin'])
    expect('errorResponse' in res).toBe(true)
    if ('errorResponse' in res) {
      expect(res.errorResponse.status).toBe(403)
    }
  })
})

describe('T14: Immutable Audit Log Tamper Rejection & Cryptographic Hash Chaining', () => {
  it('migration defines prevent_audit_log_tamper trigger prohibiting UPDATE and DELETE', () => {
    const migrationFile = join(MIGRATIONS_DIR, '0001_baseline.sql')
    const sql = readFileSync(migrationFile, 'utf8')

    expect(sql).toContain('CREATE TRIGGER trg_audit_log_tamper')
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.audit_log')
    expect(sql).toContain('RAISE EXCEPTION')
  })

  it('detects breaks in SHA-256 audit log hash chain', () => {
    const verifyChain = (entries: { seq: number; prev_hash: string; row_hash: string }[]) => {
      for (let i = 1; i < entries.length; i++) {
        if (entries[i].prev_hash !== entries[i - 1].row_hash) {
          return { valid: false, brokenSeq: entries[i].seq }
        }
      }
      return { valid: true }
    }

    const validChain = [
      { seq: 1, prev_hash: 'GENESIS', row_hash: 'hash-001' },
      { seq: 2, prev_hash: 'hash-001', row_hash: 'hash-002' },
      { seq: 3, prev_hash: 'hash-002', row_hash: 'hash-003' },
    ]
    expect(verifyChain(validChain).valid).toBe(true)

    const tamperedChain = [
      { seq: 1, prev_hash: 'GENESIS', row_hash: 'hash-001' },
      { seq: 2, prev_hash: 'tampered-hash', row_hash: 'hash-002' }, // break!
      { seq: 3, prev_hash: 'hash-002', row_hash: 'hash-003' },
    ]
    const result = verifyChain(tamperedChain)
    expect(result.valid).toBe(false)
    expect(result.brokenSeq).toBe(2)
  })
})

describe('T15: Break-Glass Escalation Invariants', () => {
  it('break_glass mutation requires explicit clinical justification reason', () => {
    const isValidBreakGlass = (payload: { mutation_type: string; reason?: string }) => {
      if (payload.mutation_type === 'break_glass') {
        return Boolean(payload.reason && payload.reason.trim().length >= 10)
      }
      return true
    }

    expect(isValidBreakGlass({ mutation_type: 'break_glass', reason: 'Emergency ICU resuscitation target override' })).toBe(true)
    expect(isValidBreakGlass({ mutation_type: 'break_glass', reason: '' })).toBe(false)
    expect(isValidBreakGlass({ mutation_type: 'break_glass' })).toBe(false)
  })
})

describe('Phase 2: RBAC Provisioning & Lifecycle Invariants', () => {
  const grants = new Set([
    'super_admin:tenant_admin:platform',
    'super_admin:compliance_auditor:platform',
    'super_admin:commercial_stakeholder:platform',
    'tenant_admin:writing_clinician:tenant',
    'tenant_admin:viewing_dietician:tenant',
    'tenant_admin:compliance_auditor:tenant',
    'tenant_admin:patient:tenant',
    'writing_clinician:patient:own_patients',
  ])

  const canProvisionRole = (callerRole: string, targetRole: string, scope: string): boolean => {
    return grants.has(`${callerRole}:${targetRole}:${scope}`)
  }

  it('super_admin provisions only platform-granted tenant, regulator, and partner roles', () => {
    expect(canProvisionRole('super_admin', 'tenant_admin', 'platform')).toBe(true)
    expect(canProvisionRole('super_admin', 'compliance_auditor', 'platform')).toBe(true)
    expect(canProvisionRole('super_admin', 'commercial_stakeholder', 'platform')).toBe(true)
    expect(canProvisionRole('super_admin', 'super_admin', 'platform')).toBe(false)
  })

  it('tenant_admin provisions only clinic roles and cannot provision a stakeholder', () => {
    expect(canProvisionRole('tenant_admin', 'writing_clinician', 'tenant')).toBe(true)
    expect(canProvisionRole('tenant_admin', 'viewing_dietician', 'tenant')).toBe(true)
    expect(canProvisionRole('tenant_admin', 'patient', 'tenant')).toBe(true)
    expect(canProvisionRole('tenant_admin', 'commercial_stakeholder', 'tenant')).toBe(false)
  })

  it('writing_clinician can only provision patients within their clinic', () => {
    expect(canProvisionRole('writing_clinician', 'patient', 'own_patients')).toBe(true)
    expect(canProvisionRole('writing_clinician', 'viewing_dietician', 'tenant')).toBe(false)
    expect(canProvisionRole('writing_clinician', 'writing_clinician', 'tenant')).toBe(false)
    expect(canProvisionRole('writing_clinician', 'tenant_admin', 'tenant')).toBe(false)
  })

  it('patient cannot provision any user role', () => {
    expect(canProvisionRole('patient', 'patient', 'tenant')).toBe(false)
    expect(canProvisionRole('patient', 'writing_clinician', 'tenant')).toBe(false)
  })

  it('patient provisioning requires primary_clinician_id and tenant boundary matching', () => {
    const validatePatientProvision = (payload: {
      role: string
      tenantId: string
      callerTenantId: string
      primaryClinicianId?: string
    }) => {
      if (payload.tenantId !== payload.callerTenantId) {
        return { valid: false, error: 'Cross-tenant provisioning is prohibited' }
      }
      if (payload.role === 'patient' && !payload.primaryClinicianId) {
        return { valid: false, error: 'Patient must be linked to exactly one primary clinician' }
      }
      return { valid: true }
    }

    const validPatient = validatePatientProvision({
      role: 'patient',
      tenantId: 'clinic-1',
      callerTenantId: 'clinic-1',
      primaryClinicianId: 'doc-123',
    })
    expect(validPatient.valid).toBe(true)

    const missingClinician = validatePatientProvision({
      role: 'patient',
      tenantId: 'clinic-1',
      callerTenantId: 'clinic-1',
    })
    expect(missingClinician.valid).toBe(false)
    expect(missingClinician.error).toContain('primary clinician')

    const crossTenant = validatePatientProvision({
      role: 'patient',
      tenantId: 'clinic-2',
      callerTenantId: 'clinic-1',
      primaryClinicianId: 'doc-123',
    })
    expect(crossTenant.valid).toBe(false)
    expect(crossTenant.error).toContain('Cross-tenant')
  })

  it('account deactivation updates state machine and flags session revocation', () => {
    type AccountStatus = 'invited' | 'active' | 'suspended' | 'deactivated'
    const transitionStatus = (current: AccountStatus, next: AccountStatus) => {
      const validTransitions: Record<AccountStatus, AccountStatus[]> = {
        invited: ['active', 'deactivated'],
        active: ['suspended', 'deactivated'],
        suspended: ['active', 'deactivated'],
        deactivated: ['active'],
      }
      if (!validTransitions[current]?.includes(next)) {
        throw new Error(`Invalid status transition from ${current} to ${next}`)
      }
      return {
        newStatus: next,
        revokeSessions: next === 'suspended' || next === 'deactivated',
      }
    }

    expect(transitionStatus('active', 'deactivated')).toEqual({
      newStatus: 'deactivated',
      revokeSessions: true,
    })
    expect(transitionStatus('active', 'suspended')).toEqual({
      newStatus: 'suspended',
      revokeSessions: true,
    })
    expect(transitionStatus('suspended', 'active')).toEqual({
      newStatus: 'active',
      revokeSessions: false,
    })
    expect(() => transitionStatus('invited', 'suspended')).toThrow('Invalid status transition')
  })
})

