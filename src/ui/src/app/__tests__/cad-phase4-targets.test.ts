// src/ui/src/app/__tests__/cad-phase4-targets.test.ts
import { describe, it, expect } from 'vitest'
import {
  verifyBundle,
  reconcileTargetsOnSync,
  checkNutrientCompleteness,
  resolveSodium,
  convertServingTo100g,
  verifyAtwaterEnergy,
  evaluateRenalTarget,
  type TargetBundle,
} from '../../../../shared/target-sync'

describe('CAD Phase 4: Rules Engine, Targets & Signed Bundles (T16 - T25)', () => {
  const sampleBundleV1: TargetBundle = {
    tenantId: 'tenant-100',
    subjectRef: 'patient-42',
    targets: [
      {
        targetId: 'tgt-1',
        nutrientCode: 'SodiumMG',
        unit: 'mg',
        basis: 'per_day',
        comparator: 'lte',
        value: 2000,
        severity: 'critical',
        validFrom: '2026-10-01',
        validTo: '2026-12-31',
        status: 'active',
      },
    ],
    platformRuleVersion: 1,
    issuedAt: '2026-10-01T00:00:00Z',
    validTo: '2026-12-31T23:59:59Z',
    bundleVersion: 1,
  }

  describe('T16: Expiry validation and fallback', () => {
    it('accepts a valid unexpired signed bundle', () => {
      const res = verifyBundle(
        sampleBundleV1,
        'sig_es256_mock_valid_signature',
        null,
        '2026-10-15T00:00:00Z'
      )
      expect(res.valid).toBe(true)
      expect(res.code).toBe('OK')
    })

    it('rejects expired bundle past valid_to and instructs client to fallback to defaults', () => {
      const res = verifyBundle(
        sampleBundleV1,
        'sig_es256_mock_valid_signature',
        null,
        '2027-01-05T00:00:00Z'
      )
      expect(res.valid).toBe(false)
      expect(res.code).toBe('EXPIRED')
      expect(res.message).toContain('Client must fall back to platform defaults')
    })

    it('rejects bundle with missing or invalid signature', () => {
      const res = verifyBundle(
        sampleBundleV1,
        'invalid_signature',
        null,
        '2026-10-15T00:00:00Z'
      )
      expect(res.valid).toBe(false)
      expect(res.code).toBe('INVALID_SIGNATURE')
    })
  })

  describe('T17: Anti-rollback protection', () => {
    it('rejects a rolled-back bundle version <= cached bundleVersion', () => {
      const cached = { ...sampleBundleV1, bundleVersion: 5 }
      const attackerBundle = { ...sampleBundleV1, bundleVersion: 4 }

      const res = verifyBundle(
        attackerBundle,
        'sig_es256_mock_signature',
        cached,
        '2026-10-15T00:00:00Z'
      )
      expect(res.valid).toBe(false)
      expect(res.code).toBe('ROLLBACK_DETECTED')
      expect(res.message).toContain('Rollback rejected')
    })

    it('accepts a strictly increasing bundleVersion', () => {
      const cached = { ...sampleBundleV1, bundleVersion: 5 }
      const freshBundle = { ...sampleBundleV1, bundleVersion: 6 }

      const res = verifyBundle(
        freshBundle,
        'sig_es256_mock_signature',
        cached,
        '2026-10-15T00:00:00Z'
      )
      expect(res.valid).toBe(true)
      expect(res.code).toBe('OK')
    })
  })

  describe('T18: Target revocation at sync', () => {
    it('removes revoked targets at sync while retaining active ones', () => {
      const targets = [
        { targetId: 'tgt-1', nutrientCode: 'SodiumMG', status: 'active' },
        { targetId: 'tgt-2', nutrientCode: 'SugarsG', status: 'revoked' },
        { targetId: 'tgt-3', nutrientCode: 'PotassiumMG', status: 'active' },
      ]

      const syncResult = reconcileTargetsOnSync(targets, '2026-10-29T12:00:00Z')
      expect(syncResult.activeTargets).toHaveLength(2)
      expect(syncResult.activeTargets.map((t) => t.targetId)).toEqual(['tgt-1', 'tgt-3'])
      expect(syncResult.revokedCount).toBe(1)
      expect(syncResult.asOf).toBe('2026-10-29T12:00:00Z')
    })
  })

  describe('T20: Mandatory Nutrient Completeness Check', () => {
    it('returns LIMITED_NUTRITION_INFO when sodium and salt are omitted, never substituting zero', () => {
      const product = {
        energyKj: 1500,
        sugarsG: 12,
        satFatG: 3.5,
        // sodiumMg and saltG omitted!
      }
      const check = checkNutrientCompleteness(product)
      expect(check.computability).toBe('LIMITED_NUTRITION_INFO')
      expect(check.missingFields).toContain('sodium_or_salt')
    })

    it('returns COMPUTABLE when all mandatory nutrients are present', () => {
      const product = {
        energyKj: 1500,
        sugarsG: 12,
        satFatG: 3.5,
        sodiumMg: 350,
      }
      const check = checkNutrientCompleteness(product)
      expect(check.computability).toBe('COMPUTABLE')
      expect(check.missingFields).toHaveLength(0)
    })
  })

  describe('T21: Resolve Sodium from Salt', () => {
    it('uses direct sodium when provided', () => {
      const res = resolveSodium(500, 1.25)
      expect(res.valueMg).toBe(500)
      expect(res.provenance).toBe('label_direct')
    })

    it('derives sodium at 400 mg per 1g of salt when sodium is missing', () => {
      const res = resolveSodium(null, 2.5) // 2.5g salt * 400 = 1000mg sodium
      expect(res.valueMg).toBe(1000)
      expect(res.provenance).toBe('derived')
    })

    it('flags as missing when neither is available', () => {
      const res = resolveSodium(null, null)
      expect(res.valueMg).toBeNull()
      expect(res.provenance).toBe('missing')
    })
  })

  describe('T22: Per-serving label conversion', () => {
    it('converts per-serving nutrient to per-100g with provenance estimated', () => {
      // 30g serving size has 6g sugar -> 20g sugar per 100g
      const res = convertServingTo100g(6, 30)
      expect(res.valuePer100g).toBe(20)
      expect(res.provenance).toBe('estimated')
    })

    it('factors in density for liquids in ml', () => {
      // 250ml beverage with density 1.05g/ml = 262.5g. 26.25g sugar -> 10g per 100g
      const res = convertServingTo100g(26.25, 250, 1.05)
      expect(res.valuePer100g).toBe(10)
      expect(res.provenance).toBe('estimated')
    })
  })

  describe('T23: Atwater energy consistency check', () => {
    it('passes when energy is within 8% tolerance', () => {
      // 10g fat (370 kJ) + 20g carbs (340 kJ) + 10g protein (170 kJ) = 880 kJ
      const res = verifyAtwaterEnergy(900, { fatG: 10, carbsG: 20, proteinG: 10 })
      expect(res.consistent).toBe(true)
      expect(res.deltaPct).toBeLessThanOrEqual(8)
    })

    it('fails when energy disagrees with macros by more than 8%', () => {
      // Expected 880 kJ, declared 1200 kJ (36% error)
      const res = verifyAtwaterEnergy(1200, { fatG: 10, carbsG: 20, proteinG: 10 })
      expect(res.consistent).toBe(false)
      expect(res.deltaPct).toBeGreaterThan(8)
    })
  })

  describe('T25: Missing potassium disables renal pack with explanation', () => {
    it('disables renal target safely when potassium is missing from product nutrition', () => {
      const target = { nutrientCode: 'PotassiumMG', value: 200 }
      const product = { SodiumMG: 100, SugarsG: 5 } // no PotassiumMG

      const evalResult = evaluateRenalTarget(target, product)
      expect(evalResult.evaluated).toBe(false)
      expect(evalResult.reason).toContain('Rule disabled: Potassium value missing')
    })

    it('evaluates renal target when potassium is present', () => {
      const target = { nutrientCode: 'PotassiumMG', value: 200 }
      const product = { PotassiumMG: 150 }

      const evalResult = evaluateRenalTarget(target, product)
      expect(evalResult.evaluated).toBe(true)
      expect(evalResult.pass).toBe(true)
    })
  })
})

