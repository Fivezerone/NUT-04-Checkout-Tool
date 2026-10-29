// src/ui/src/app/__tests__/cad-phase5-consent.test.ts
import { describe, it, expect } from 'vitest'
import {
  evaluatePatientVisibility,
  evaluateCohortSuppression,
  cryptoShredPatient,
  type ConsentRecord,
} from '../../../../shared/consent'

describe('CAD Phase 5: Clinical Views, Consent & Pilot (T13, T26, T27)', () => {
  const activeConsent: ConsentRecord = {
    id: 'c-001',
    tenantId: 'tenant-100',
    patientRef: 'pat-99',
    purpose: 'clinician_link',
    status: 'active',
    grantedAt: '2026-10-20T08:00:00Z',
  }

  describe('T26: Consent Revocation & Patient-Level Access Gate', () => {
    it('allows clinician access when patient consent is active for the purpose', () => {
      const access = evaluatePatientVisibility(activeConsent, 'clinician_link')
      expect(access.allowed).toBe(true)
      expect(access.reason).toBeUndefined()
    })

    it('immediately denies clinician access when patient consent is revoked', () => {
      const revokedConsent: ConsentRecord = {
        ...activeConsent,
        status: 'revoked',
        revokedAt: '2026-10-29T10:00:00Z',
      }
      const access = evaluatePatientVisibility(revokedConsent, 'clinician_link')
      expect(access.allowed).toBe(false)
      expect(access.reason).toContain('Consent has been explicitly revoked')
    })

    it('denies clinician access when consent was never granted or missing', () => {
      const access = evaluatePatientVisibility(null, 'clinician_link')
      expect(access.allowed).toBe(false)
      expect(access.reason).toContain('No consent record exists')
    })

    it('denies access when purpose does not match', () => {
      const diaryOnlyConsent: ConsentRecord = {
        ...activeConsent,
        purpose: 'diary',
      }
      const access = evaluatePatientVisibility(diaryOnlyConsent, 'purchase_timeline')
      expect(access.allowed).toBe(false)
      expect(access.reason).toContain("Consent granted for 'diary'")
    })
  })

  describe('T27: Patient Erasure Request & Crypto-Shredding', () => {
    it('shreds patient identifiers into a non-reversible token while preserving audit integrity', () => {
      const patientRef = 'PAT-NAIROBI-2026-091'
      const shredResult = cryptoShredPatient(patientRef)

      expect(shredResult.anonymizedRef).toMatch(/^SHREDDED-PAT-/)
      expect(shredResult.anonymizedRef).not.toBe(patientRef)
      expect(shredResult.erasureTimestamp).toBeDefined()
    })

    it('ensures post-erasure visibility is completely severed', () => {
      const shreddedRef = cryptoShredPatient('PAT-123').anonymizedRef
      const postErasureConsent: ConsentRecord = {
        id: 'c-002',
        tenantId: 'tenant-100',
        patientRef: shreddedRef,
        purpose: 'clinician_link',
        status: 'revoked',
        revokedAt: new Date().toISOString(),
      }

      const access = evaluatePatientVisibility(postErasureConsent, 'clinician_link')
      expect(access.allowed).toBe(false)
    })
  })

  describe('T13 / §9.4: Small-Cell Suppression for Cohorts', () => {
    it('suppresses metrics when cohort size is below k=5 threshold', () => {
      const check = evaluateCohortSuppression(3, 5)
      expect(check.isSuppressed).toBe(true)
      expect(check.displayCount).toBeNull()
      expect(check.message).toContain('below privacy threshold (k >= 5)')
    })

    it('allows metrics when cohort size meets or exceeds k=5 threshold', () => {
      const check = evaluateCohortSuppression(14, 5)
      expect(check.isSuppressed).toBe(false)
      expect(check.displayCount).toBe(14)
      expect(check.message).toBeUndefined()
    })

    it('supports custom configurable tenant k threshold', () => {
      const check = evaluateCohortSuppression(8, 10)
      expect(check.isSuppressed).toBe(true)
      expect(check.displayCount).toBeNull()
      expect(check.message).toContain('k >= 10')
    })
  })
})

