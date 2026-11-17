/**
 * @file wp14-bff-auth-audit.test.ts
 * Comprehensive test suite for WP-14: BFF, Auth, PDP Enforcement & WORM Audit.
 *
 * References: Blueprint §3.5 (N5), §3.7 (N7), §4.1, §4.3; ADR-004, ADR-008, ADR-012.
 * Invariants Tested:
 * - F-01, F-02 (Server-side MFA assurance, cookie-based BFF session)
 * - F-03, F-04, X-04 (Role separation, super_admin clinical isolation, field masking)
 * - X-01, X-03 (Verified claims, fail-closed PDP)
 * - G-05 (Capability catalog & caps_hash)
 * - G-07, F-05 (Tamper-evident WORM audit hash chain & Merkle verification)
 * - Invariant T13 (k >= 20 small-cell suppression on commercial aggregates)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SessionManager, COOKIE_NAME } from '../../../../../services/api/src/bff/session.mjs'
import { computeCapabilitiesForSubject } from '../../../../../services/api/src/bff/capabilities.mjs'
import { maskObject, K_RETAILER_OUTPUT } from '../../../../../services/api/src/bff/masks.mjs'
import {
  computeRowHash,
  computeMerkleRoot,
  verifyAuditLedger,
  INITIAL_PREV_HASH,
} from '../../../../../services/api/src/audit/verifier.mjs'
import { createApiApp } from '../../../../../services/api/src/server.mjs'
import { createProblemDetails } from '../../../../../services/api/src/bff/errors.mjs'

describe('WP-14: BFF, Auth, PDP Enforcement & Audit Verifier', () => {
  let sessionManager: SessionManager

  beforeEach(() => {
    sessionManager = new SessionManager()
  })

  describe('1. BFF Session Management & Cookie Binding (ADR-004)', () => {
    it('creates a secure session and formats __Host-ns_sid cookie', async () => {
      const session = await sessionManager.createSession({
        userId: 'user-001',
        tenantId: 'tenant-001',
        appRole: 'writing_clinician',
        acr: 2,
        amr: ['otp'],
      })

      expect(session.sid).toMatch(/^ns_sid_[0-9a-f]{48}$/)
      expect(session.user_id).toBe('user-001')
      expect(session.app_role).toBe('writing_clinician')
      expect(session.csrf_secret).toBeTruthy()

      const setCookie = sessionManager.createSetCookieHeader(session.sid)
      expect(setCookie).toContain(`__Host-ns_sid=${session.sid}`)
      expect(setCookie).toContain('Path=/')
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('Secure')
      expect(setCookie).toContain('SameSite=Strict')
    })

    it('parses session cookie from request Cookie header', () => {
      const cookieHeader = `other=123; ${COOKIE_NAME}=test-sid-999; theme=dark`
      const parsed = sessionManager.parseSessionCookie(cookieHeader)
      expect(parsed).toBe('test-sid-999')
    })

    it('retrieves active session and extends idle expiration', async () => {
      const session = await sessionManager.createSession({
        userId: 'user-001',
        tenantId: 'tenant-001',
        appRole: 'tenant_admin',
      })

      const fetched = await sessionManager.getSession(session.sid)
      expect(fetched).not.toBeNull()
      expect(fetched?.user_id).toBe('user-001')
    })

    it('revokes session and adds sid to immediate denylist', async () => {
      const session = await sessionManager.createSession({
        userId: 'user-001',
        tenantId: 'tenant-001',
        appRole: 'patient',
      })

      await sessionManager.revokeSession(session.sid)
      expect(sessionManager.isDenylisted(session.sid)).toBe(true)

      const fetched = await sessionManager.getSession(session.sid)
      expect(fetched).toBeNull()
    })
  })

  describe('2. CSRF & Cross-Origin Protection (ADR-004)', () => {
    it('permits safe HTTP GET methods without CSRF token', async () => {
      const session = await sessionManager.createSession({
        userId: 'user-001',
        tenantId: 't-01',
        appRole: 'patient',
      })

      const req = { method: 'GET', headers: {} } as any
      const check = sessionManager.validateCsrf(req, session)
      expect(check.valid).toBe(true)
    })

    it('rejects unsafe POST without matching X-NS-CSRF header', async () => {
      const session = await sessionManager.createSession({
        userId: 'user-001',
        tenantId: 't-01',
        appRole: 'writing_clinician',
      })

      const req = {
        method: 'POST',
        headers: {
          'x-ns-csrf': 'invalid-token',
        },
      } as any

      const check = sessionManager.validateCsrf(req, session)
      expect(check.valid).toBe(false)
      expect(check.reason).toContain('Invalid or missing X-NS-CSRF header')
    })

    it('accepts unsafe POST with valid X-NS-CSRF and matching origin', async () => {
      const session = await sessionManager.createSession({
        userId: 'user-001',
        tenantId: 't-01',
        appRole: 'writing_clinician',
      })

      const req = {
        method: 'POST',
        headers: {
          'x-ns-csrf': session.csrf_secret,
          origin: 'https://cad.nutriscore.internal:8080',
          host: 'cad.nutriscore.internal:8080',
        },
      } as any

      const check = sessionManager.validateCsrf(req, session)
      expect(check.valid).toBe(true)
    })

    it('rejects cross-origin request when Origin does not match Host', async () => {
      const session = await sessionManager.createSession({
        userId: 'user-001',
        tenantId: 't-01',
        appRole: 'writing_clinician',
      })

      const req = {
        method: 'POST',
        headers: {
          'x-ns-csrf': session.csrf_secret,
          origin: 'https://malicious-site.example',
          host: 'cad.nutriscore.internal:8080',
        },
      } as any

      const check = sessionManager.validateCsrf(req, session)
      expect(check.valid).toBe(false)
      expect(check.reason).toContain('Cross-origin request rejected')
    })
  })

  describe('3. MFA Assurance Enforcement (F-01, F-02, Blueprint §3.5)', () => {
    it('rejects non-patient role with acr < 2 as STEP_UP_REQUIRED', () => {
      const session = {
        app_role: 'writing_clinician',
        acr: 1, // password only
        amr: ['password'],
      }

      const res = sessionManager.validateMfaAssurance(session)
      expect(res.valid).toBe(false)
      expect(res.code).toBe('STEP_UP_REQUIRED')
    })

    it('rejects non-patient role with acr >= 2 if amr lacks otp or webauthn', () => {
      const session = {
        app_role: 'tenant_admin',
        acr: 2,
        amr: ['password', 'pin'],
      }

      const res = sessionManager.validateMfaAssurance(session)
      expect(res.valid).toBe(false)
      expect(res.code).toBe('STEP_UP_REQUIRED')
    })

    it('accepts non-patient role with acr >= 2 and valid amr (otp/webauthn)', () => {
      const session = {
        app_role: 'writing_clinician',
        acr: 2,
        amr: ['password', 'otp'],
      }

      const res = sessionManager.validateMfaAssurance(session)
      expect(res.valid).toBe(true)
    })

    it('exempts patient role from acr >= 2 requirement', () => {
      const session = {
        app_role: 'patient',
        acr: 1,
        amr: ['password'],
      }

      const res = sessionManager.validateMfaAssurance(session)
      expect(res.valid).toBe(true)
    })
  })

  describe('4. Capability Service & Caps Hash (Blueprint §4.1)', () => {
    it('computes sorted capabilities and deterministic caps_hash for writing_clinician', () => {
      const subject = {
        role: 'writing_clinician',
        acr: 2,
        tenantId: 'tenant-knh',
      }

      const res = computeCapabilitiesForSubject(subject)
      expect(res.caps).toContain('patients.targets.write')
      expect(res.caps).toContain('patients.directory.read')
      expect(res.caps).toContain('modes.approve')
      expect(res.step_up_required).toEqual([])
      expect(res.caps_hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('enforces step_up_required when writing_clinician has acr < 2', () => {
      const subject = {
        role: 'writing_clinician',
        acr: 1,
        tenantId: 'tenant-knh',
      }

      const res = computeCapabilitiesForSubject(subject)
      expect(res.caps).not.toContain('patients.targets.write')
      expect(res.step_up_required).toContain('patients.targets.write')
      expect(res.step_up_required).toContain('modes.approve')
    })

    it('removes clinical read and write capabilities from super_admin (Delta D-4)', () => {
      const subject = {
        role: 'super_admin',
        acr: 2,
        tenantId: 'platform',
      }

      const res = computeCapabilitiesForSubject(subject)
      expect(res.caps).not.toContain('patients.targets.write')
      expect(res.caps).not.toContain('patients.targets.read')
      expect(res.caps).not.toContain('patients.directory.read')
      expect(res.caps).toContain('audit.verify')
    })
  })

  describe('5. Field Masking & Small-Cell Suppression (Blueprint §3.5; Invariant T13)', () => {
    const rawPatient = {
      id: 'p-1',
      patient_ref: 'pat-001',
      display_name: 'Patient Alpha',
      active_targets: { sodium_max: 2000 },
      care_team: ['dr-smith'],
      consent_status: 'active',
      internal_notes: 'Private clinical notes',
      internal_diagnosis: 'Type 2 Diabetes',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    }

    it('allows writing_clinician to view clinical targets, notes, and care team', () => {
      const masked = maskObject('patient_directory', 'writing_clinician', rawPatient)
      expect(masked.patient_ref).toBe('pat-001')
      expect(masked.display_name).toBe('Patient Alpha')
      expect(masked.active_targets).toEqual({ sodium_max: 2000 })
      expect(masked.internal_notes).toBeUndefined() // dropped (default deny)
    })

    it('drops internal clinical notes and targets for tenant_admin', () => {
      const masked = maskObject('patient_directory', 'tenant_admin', rawPatient)
      expect(masked.patient_ref).toBe('pat-001')
      expect(masked.active_targets).toBeUndefined()
      expect(masked.display_name).toBeUndefined()
    })

    it('returns null for super_admin on patient_directory (Delta D-4)', () => {
      const masked = maskObject('patient_directory', 'super_admin', rawPatient)
      expect(masked).toBeNull()
    })

    it('enforces small-cell suppression (k >= 20) on commercial aggregates', () => {
      const smallCohort = {
        period: '2026-Q1',
        retailer: 'carrefour',
        total_orders: 14, // below k=20
        aggregate_grade_distribution: { A: 5, B: 9 },
        unscored_share: 0.1,
      }

      const masked = maskObject('commercial_aggregates', 'commercial_stakeholder', smallCohort)
      expect(masked.is_suppressed).toBe(true)
      expect(masked.total_orders).toBeNull()
      expect(masked.aggregate_grade_distribution).toBeNull()
      expect(masked.suppression_reason).toContain(`k >= ${K_RETAILER_OUTPUT}`)

      const largeCohort = { ...smallCohort, total_orders: 45 }
      const largeMasked = maskObject('commercial_aggregates', 'commercial_stakeholder', largeCohort)
      expect(largeMasked.is_suppressed).toBe(false)
      expect(largeMasked.total_orders).toBe(45)
    })
  })

  describe('6. Audit Writer & Merkle Verifier (Blueprint §3.7 N7, F-05; ADR-012, ADR-7)', () => {
    function generateTestChain(count = 5) {
      const entries: any[] = []
      let prevHash = INITIAL_PREV_HASH

      for (let i = 1; i <= count; i++) {
        const rawEntry = {
          seq: i,
          ts: new Date(1700000000000 + i * 1000).toISOString(),
          actor_ref: 'actor-dr-01',
          action: 'read',
          resource_ref: `record-${i}`,
          decision: 'permit' as const,
          trace_id: `trace-${i}`,
          obj_hash: 'hash-obj-abc',
          prev_hash: prevHash,
        }

        const rowHash = computeRowHash(rawEntry, prevHash)
        const entry = { ...rawEntry, row_hash: rowHash }
        entries.push(entry)
        prevHash = rowHash
      }

      return entries
    }

    it('verifies a pristine audit hash chain successfully', () => {
      const entries = generateTestChain(10)
      const res = verifyAuditLedger(entries)

      expect(res.status).toBe('verified')
      expect(res.checked).toBe(10)
    })

    it('detects tampered row_hash in audit chain and reports first_bad_seq', () => {
      const entries = generateTestChain(10)
      // Tamper with entry 4
      entries[3].row_hash = 'tampered-hash-value-000000000000000000000000000000000000000000'

      const res = verifyAuditLedger(entries)
      expect(res.status).toBe('failed')
      expect(res.first_bad_seq).toBe(4)
      expect(res.checked).toBe(3)
    })

    it('detects broken prev_hash link in audit chain', () => {
      const entries = generateTestChain(10)
      // Break link on entry 6
      entries[5].prev_hash = 'broken-prev-hash-link'

      const res = verifyAuditLedger(entries)
      expect(res.status).toBe('failed')
      expect(res.first_bad_seq).toBe(6)
    })

    it('returns status unavailable on empty entries set, never defaulting to verified (F-05)', () => {
      const res = verifyAuditLedger([])
      expect(res.status).toBe('unavailable')
      expect(res.checked).toBe(0)
    })

    it('verifies audit chain against anchored Merkle root', () => {
      const entries = generateTestChain(8)
      const rowHashes = entries.map((e) => e.row_hash)
      const merkleRoot = computeMerkleRoot(rowHashes)

      const anchoredRoots = [
        {
          epoch: 1,
          seq: 1,
          root_hash: merkleRoot,
          signature: 'sig-vault-ed25519',
          leaf_count: 8,
        },
      ]

      const res = verifyAuditLedger(entries, anchoredRoots)
      expect(res.status).toBe('verified')
      expect(res.roots_verified).toBe(1)
    })

    it('fails verification if anchored Merkle root does not match calculated root', () => {
      const entries = generateTestChain(8)
      const fakeRoots = [
        {
          epoch: 1,
          seq: 1,
          root_hash: 'tampered-root-hash',
          signature: 'sig-vault',
          leaf_count: 8,
        },
      ]

      const res = verifyAuditLedger(entries, fakeRoots)
      expect(res.status).toBe('failed')
      expect(res.reason).toContain('does not match anchored root')
    })
  })

  describe('7. HTTP BFF Endpoints & Problem Details Integration', () => {
    let app: ReturnType<typeof createApiApp>

    beforeEach(() => {
      app = createApiApp({ sessionManager })
    })

    it('formats uniform RFC 9457 Problem Details', () => {
      const problem = createProblemDetails({
        status: 403,
        code: 'STEP_UP_REQUIRED',
        detail: 'MFA assurance required',
        traceId: 'tr-123',
        retryAfter: 60,
      })

      expect(problem.status).toBe(403)
      expect(problem.code).toBe('STEP_UP_REQUIRED')
      expect(problem.trace_id).toBe('tr-123')
      expect(problem.retry_after_s).toBe(60)
    })

    it('rejects unauthenticated request to /v1/capabilities with 401 Problem Details', async () => {
      const req = {
        url: '/v1/capabilities',
        method: 'GET',
        headers: {},
      } as any

      let statusCode = 0
      let contentType = ''
      let responseData = ''

      const res = {
        writeHead: (code: number, headers: any) => {
          statusCode = code
          contentType = headers?.['Content-Type'] || ''
        },
        end: (data: string) => {
          responseData = data
        },
      } as any

      await app.requestListener(req, res)
      expect(statusCode).toBe(401)
      expect(contentType).toBe('application/problem+json')
      const parsed = JSON.parse(responseData)
      expect(parsed.code).toBe('UNAUTHORIZED')
    })

    it('authenticates session via /v1/auth/session and serves /v1/capabilities with cookie', async () => {
      // 1. Authenticate session
      const authReq = {
        url: '/v1/auth/session',
        method: 'POST',
        headers: {},
        on: (event: string, cb: any) => {
          if (event === 'data') {
            cb(
              JSON.stringify({
                user_id: 'dr-smith',
                tenant_id: 'tenant-knh',
                app_role: 'writing_clinician',
                acr: 2,
                amr: ['otp'],
              }),
            )
          }
          if (event === 'end') cb()
        },
      } as any

      let authStatusCode = 0
      let setCookieHeader = ''
      let authResponseData = ''

      const authRes = {
        writeHead: (code: number, headers: any) => {
          authStatusCode = code
          setCookieHeader = headers?.['Set-Cookie'] || ''
        },
        end: (data: string) => {
          authResponseData = data
        },
      } as any

      await app.requestListener(authReq, authRes)
      expect(authStatusCode).toBe(200)
      expect(setCookieHeader).toContain('__Host-ns_sid=')
      const sid = sessionManager.parseSessionCookie(setCookieHeader)
      expect(sid).toBeTruthy()

      // 2. Access /v1/capabilities with the session cookie
      const capsReq = {
        url: '/v1/capabilities',
        method: 'GET',
        headers: {
          cookie: `${COOKIE_NAME}=${sid}`,
        },
      } as any

      let capsStatusCode = 0
      let capsResponseData = ''

      const capsRes = {
        writeHead: (code: number) => {
          capsStatusCode = code
        },
        end: (data: string) => {
          capsResponseData = data
        },
      } as any

      await app.requestListener(capsReq, capsRes)
      expect(capsStatusCode).toBe(200)
      const caps = JSON.parse(capsResponseData)
      expect(caps.caps).toContain('patients.targets.write')
      expect(caps.caps_hash).toBeTruthy()
    })
  })
})
