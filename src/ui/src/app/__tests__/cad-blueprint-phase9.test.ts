/**
 * NutriScore CAD Blueprint Phase 9 Tests — Compliance Machinery & Data-Subject Rights
 *
 * Reference: Blueprint §4.1, Decision D5, Kenya DPA 2019
 *
 * Verifies:
 * 1. Retention purge eligibility and fail-safe policy enforcement.
 * 2. Production release gate rules (DPIA presence, counsel sign-off, ODPC 60-day rule).
 * 3. Data-subject export bundle generation, canonical digest, and cryptographic verification.
 * 4. Audit ledger payload structure for data-subject rights workflows.
 */

import { describe, it, expect } from 'vitest'
import { evaluatePurgeEligibility } from '../../../../../scripts/purge-retention.mjs'
import { evaluateReleaseGate, checkReleaseGate } from '../../../../../scripts/release-gate.mjs'
import {
  createSignedPatientExport,
  verifyPatientExport,
  computePatientDataDigest,
  type PatientDataPayload,
} from '../../../../shared/patient-export'
import { LocalEd25519Signer } from '../../../../shared/signer'

describe('CAD Blueprint Phase 9: Compliance Machinery & Rights Workflows', () => {
  describe('1. Retention Purge Fail-Safe Rules (Decision D5)', () => {
    it('refuses purge if policy is not configured (fail-safe rule)', () => {
      expect(() => evaluatePurgeEligibility(null)).toThrow(
        /Refusing to purge: No retention policy configured/i,
      )
    })

    it('refuses purge if retain_years is NULL (fail-safe pending counsel)', () => {
      const policy = {
        record_class: 'clinical_records',
        retain_years: null,
        legal_hold: false,
      }
      expect(() => evaluatePurgeEligibility(policy)).toThrow(
        /retain_years is NULL \(purge forbidden until counsel provides basis\)/i,
      )
    })

    it('blocks purge when legal_hold is active', () => {
      const policy = {
        record_class: 'commercial_orders',
        retain_years: 3,
        legal_hold: true,
      }
      const records = [
        { id: '1', placed_at: '2020-01-01T00:00:00Z' },
        { id: '2', placed_at: '2021-01-01T00:00:00Z' },
      ]
      const result = evaluatePurgeEligibility(policy, records)
      expect(result.status).toBe('BLOCKED')
      expect(result.reason).toContain('Legal hold is active')
      expect(result.eligibleCount).toBe(0)
    })

    it('identifies eligible records older than retention threshold', () => {
      const policy = {
        record_class: 'commercial_orders',
        retain_years: 3,
        legal_hold: false,
      }
      const now = Date.now()
      const fourYearsAgo = new Date(now - 4 * 365.25 * 24 * 60 * 60 * 1000).toISOString()
      const oneYearAgo = new Date(now - 1 * 365.25 * 24 * 60 * 60 * 1000).toISOString()

      const records = [
        { id: 'expired-1', placed_at: fourYearsAgo },
        { id: 'active-1', placed_at: oneYearAgo },
      ]
      const result = evaluatePurgeEligibility(policy, records)
      expect(result.status).toBe('ELIGIBLE')
      expect(result.eligibleCount).toBe(1)
      expect(result.eligibleRecords[0].id).toBe('expired-1')
    })
  })

  describe('2. Production Release Gate (Decision D5 / Section 5 DoD)', () => {
    const validConfig = {
      project: 'NutriScore CAD Healthcare Platform',
      planned_launch_on: '2027-03-01T00:00:00Z',
      dpia: {
        document: 'docs/compliance/dpia/DPIA-draft.md',
        submitted_on: '2026-12-01T00:00:00Z', // 90 days before launch
        odpc_reference: 'ODPC/CR/2026/98214',
        counsel_signoff: 'Advocate J. Mwangi (LSK/2024/0481)',
      },
    }

    it('passes when DPIA exists, counsel signed, and submitted >= 60 days before launch', () => {
      const result = evaluateReleaseGate(validConfig, { checkDpiaFile: false })
      expect(result.passed).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.details.daysBetweenSubmissionAndLaunch).toBeGreaterThanOrEqual(60)
    })

    it('fails when DPIA document is missing', () => {
      const config = {
        ...validConfig,
        dpia: { ...validConfig.dpia, document: 'docs/non-existent-dpia.md' },
      }
      const result = evaluateReleaseGate(config, { checkDpiaFile: true })
      expect(result.passed).toBe(false)
      expect(result.errors.some((e: string) => e.includes('DPIA document not found'))).toBe(true)
    })

    it('fails when legal counsel sign-off is missing or pending', () => {
      const config = {
        ...validConfig,
        dpia: { ...validConfig.dpia, counsel_signoff: null },
      }
      const result = evaluateReleaseGate(config, { checkDpiaFile: false })
      expect(result.passed).toBe(false)
      expect(result.errors.some((e: string) => e.includes('Missing legal counsel sign-off'))).toBe(true)
    })

    it('fails when ODPC reference is missing or pending', () => {
      const config = {
        ...validConfig,
        dpia: { ...validConfig.dpia, odpc_reference: null },
      }
      const result = evaluateReleaseGate(config, { checkDpiaFile: false })
      expect(result.passed).toBe(false)
      expect(result.errors.some((e: string) => e.includes('Missing ODPC reference'))).toBe(true)
    })

    it('fails when submitted_on is less than 60 days before planned_launch_on', () => {
      const config = {
        ...validConfig,
        dpia: {
          ...validConfig.dpia,
          submitted_on: '2027-02-15T00:00:00Z', // only 14 days before 2027-03-01
        },
      }
      const result = evaluateReleaseGate(config, { checkDpiaFile: false })
      expect(result.passed).toBe(false)
      expect(result.errors.some((e: string) => e.includes('minimum 60 days required'))).toBe(true)
    })

    it('correctly fails on this branch with actual compliance/launch.json until counsel signs off', () => {
      const result = checkReleaseGate()
      // Per global DOD #8: release gate FAILS on this branch until counsel items and DPIA are real
      expect(result.passed).toBe(false)
      expect(result.details.dpiaExists).toBe(true)
      expect(result.details.counselSignoffPresent).toBe(false)
      expect(result.details.odpcReferencePresent).toBe(false)
    })
  })

  describe('3. Patient Data Portability Export (Kenya DPA s. 40)', () => {
    const mockData: PatientDataPayload = {
      profile: {
        id: '99999999-9999-9999-9999-999999999999',
        tenantId: '11111111-1111-1111-1111-111111111111',
        medicalRecordNumber: 'MRN-44210',
        restricted: false,
        createdAt: '2026-01-15T08:00:00Z',
      },
      clinicalRecords: [
        {
          id: 'rec-1',
          recordType: 'assessment',
          version: 1,
          classification: 'RESTRICTED',
          body: { summary: 'Glycemic control protocol initiation' },
          createdAt: '2026-02-01T10:00:00Z',
        },
      ],
      clinicalAdvice: [
        {
          id: 'adv-1',
          authorId: 'clinician-1',
          content: 'Maintain carbohydrate intake under 30g per meal',
          version: 1,
          createdAt: '2026-02-01T10:15:00Z',
        },
      ],
      tags: ['low_carb_focus', 'high_fiber'],
      consents: [
        {
          id: 'con-1',
          purpose: 'dietary_profile_sharing',
          granted: true,
          lawfulBasis: ['contract', 'explicit_consent'],
          policyVersion: '2026-v1',
          grantedAt: '2026-01-15T08:05:00Z',
        },
      ],
      observedOrders: [
        {
          id: 'ord-1',
          retailer: 'Naivas Supermarket',
          placedAt: '2026-02-10T14:30:00Z',
          linesCount: 3,
          source: 'extension_observed',
        },
      ],
    }

    it('generates a deterministically digestable export bundle', () => {
      const digest1 = computePatientDataDigest(mockData)
      const digest2 = computePatientDataDigest(mockData)
      expect(digest1).toBe(digest2)
      expect(digest1).toMatch(/^[a-f0-9]{64}$/)
    })

    it('creates a cryptographically signed export bundle verifiable with Signer', async () => {
      const signer = new LocalEd25519Signer('cad-export-key-01')
      const exporter = {
        actorId: 'clinician-001',
        actorRole: 'writing_clinician',
      }

      const { bundle, auditPayload } = await createSignedPatientExport(
        '11111111-1111-1111-1111-111111111111',
        '99999999-9999-9999-9999-999999999999',
        mockData,
        exporter,
        signer,
      )

      expect(bundle.specification).toBe('CAD-DPA2019-PORTABILITY-v1')
      expect(bundle.digest).toBe(computePatientDataDigest(mockData))
      expect(bundle.signature).toBeDefined()
      expect(bundle.signerKid).toBe('cad-export-key-01')

      // Verify bundle
      const isValid = verifyPatientExport(bundle, signer)
      expect(isValid).toBe(true)

      // Audit payload verification
      expect(auditPayload.recordsExported.clinicalRecordsCount).toBe(1)
      expect(auditPayload.recordsExported.adviceCount).toBe(1)
      expect(auditPayload.recordsExported.consentsCount).toBe(1)
      expect(auditPayload.recordsExported.ordersCount).toBe(1)
      expect(auditPayload.digest).toBe(bundle.digest)
    })

    it('fails verification if bundle data is tampered with', async () => {
      const signer = new LocalEd25519Signer()
      const exporter = { actorId: 'c1', actorRole: 'writing_clinician' }

      const { bundle } = await createSignedPatientExport(
        '11111111-1111-1111-1111-111111111111',
        '99999999-9999-9999-9999-999999999999',
        mockData,
        exporter,
        signer,
      )

      // Tamper with data
      const tamperedBundle = {
        ...bundle,
        data: {
          ...bundle.data,
          tags: ['tampered_tag'],
        },
      }

      const isValid = verifyPatientExport(tamperedBundle, signer)
      expect(isValid).toBe(false)
    })

    it('fails verification if signature is forged', async () => {
      const signer = new LocalEd25519Signer()
      const otherSigner = new LocalEd25519Signer()
      const exporter = { actorId: 'c1', actorRole: 'writing_clinician' }

      const { bundle } = await createSignedPatientExport(
        '11111111-1111-1111-1111-111111111111',
        '99999999-9999-9999-9999-999999999999',
        mockData,
        exporter,
        signer,
      )

      const isValid = verifyPatientExport(bundle, otherSigner)
      expect(isValid).toBe(false)
    })
  })
})
