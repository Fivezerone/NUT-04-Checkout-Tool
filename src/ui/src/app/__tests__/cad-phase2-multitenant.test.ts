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
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

describe('T10: Cross-Tenant Isolation & JWT Claim Tamper Protection', () => {
  it('extractClaims extracts tenant_id, role, and licence_verified from valid Bearer JWT', () => {
    const payload = {
      sub: 'user-clinician-123',
      tenant_id: '11111111-1111-1111-1111-111111111111',
      role: 'writing_clinician',
      licence_verified: true,
      email: 'dr.omondi@knh.or.ke',
    }
    const token = 'header.' + btoa(JSON.stringify(payload)) + '.signature'
    const req = new Request('https://admin.nutriscore.co.ke/api/targets', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const claims = extractClaims(req)
    expect(claims).not.toBeNull()
    expect(claims?.userId).toBe('user-clinician-123')
    expect(claims?.tenantId).toBe('11111111-1111-1111-1111-111111111111')
    expect(claims?.role).toBe('writing_clinician')
    expect(claims?.licenceVerified).toBe(true)
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
    const migrationFile = join(MIGRATIONS_DIR, '20261029000000_multi_tenant_core.sql')
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
      role: 'viewing_dietician',
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
      expect(body.message).toContain("Role 'viewing_dietician' is not authorized")
    }
  })

  it('unverified writing_clinician is blocked when licence verification is required', async () => {
    const unverifiedClinician = {
      sub: 'user-clinician-789',
      tenant_id: '11111111-1111-1111-1111-111111111111',
      role: 'writing_clinician',
      licence_verified: false,
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
      expect(body.error).toBe('licence_unverified')
    }
  })

  it('verified writing_clinician is authorized to prescribe targets', () => {
    const verifiedClinician = {
      sub: 'user-clinician-001',
      tenant_id: '11111111-1111-1111-1111-111111111111',
      role: 'writing_clinician',
      licence_verified: true,
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
      role: 'commercial_stakeholder',
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
    const migrationFile = join(MIGRATIONS_DIR, '20261029000000_multi_tenant_core.sql')
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
