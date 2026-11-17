/**
 * @license SPDX-License-Identifier: Apache-2.0
 * src/ui/src/app/__tests__/wp04-scoring-v5.test.ts
 *
 * Work Package 04: Pure Scoring Kernel, FSA-NPS 2023, Policy Engine v2, and Continuity Proofs.
 * Reference: Blueprint §2.1 (E-01..E-07, X-07, X-12, ADR-8, Invariant T20, Prime Rules 1-6)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('idb', () => ({
  openDB: async () => ({
    transaction: () => ({
      store: {
        get: async () => undefined,
        put: async () => undefined,
      },
      done: Promise.resolve(),
    }),
  }),
}))

import {
  evaluateItem,
  canonicalise,
  gateNutrients,
  evaluatePolicy,
  computeGradeFromProduct,
  interpretProduct,
  isScoringV5Enabled,
  isPolicyV2Enabled,
  clearEvaluationCache,
  SALT_TO_SODIUM_FACTOR_MG_PER_G,
  PLAUSIBILITY_BOUNDS,
  type ItemEvaluation,
} from '../lib/db'
import { getSettings, DEFAULT_SETTINGS } from '../lib/db/settings'
import { verifyAtwaterEnergy } from '../../../../shared/target-sync'
import { evaluateSkuAgainstConstraints, type CandidateSku } from '../../../../shared/commercial-catalogue'

// Import pure extension engine modules
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
require('../../../../extension/engine/kernel.js')
require('../../../../extension/engine/fsa-nps.js')
require('../../../../extension/engine/policy.js')
require('../../../../extension/engine/evaluate.js')
require('../../../../extension/engine/health-flags.js')

const Kernel = (globalThis as any).NutriKernel
const FsaNps = (globalThis as any).NutriFsaNps
const Policy = (globalThis as any).NutriPolicy
const Evaluate = (globalThis as any).NutriEvaluate
const HealthFlags = (globalThis as any).HealthFlags

describe('WP-04: Scoring & Policy v5 Engine', () => {
  beforeEach(() => {
    clearEvaluationCache()
    // Configure NutriFlags mock
    ;(globalThis as any).NutriFlags = {
      isEnabled: vi.fn((flag: string) => {
        if (flag === 'ns.scoring.v5') return true
        if (flag === 'ns.policy.v2') return true
        return false
      }),
    }
  })

  afterEach(() => {
    clearEvaluationCache()
    delete (globalThis as any).NutriFlags
  })

  // ---------------------------------------------------------------------------
  // 1. T-04 Reference Set: 20 Benchmark Foods Exact Scoring
  // ---------------------------------------------------------------------------
  describe('1. T-04 Reference Set (20 Standard Benchmark Foods)', () => {
    const referenceFoods = [
      {
        name: 'Natural Mineral Water',
        Classification: { NutritionCategory: 'Water', FSACategoryCode: 'BEVERAGE' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 0, SugarsG: 0, SaturatedFatG: 0, SodiumMG: 5, ProteinG: 0, FibreG: 0 },
        expectedGrade: 'A',
      },
      {
        name: 'Diet Zero Cola',
        Classification: { NutritionCategory: 'Beverages', FSACategoryCode: 'BEVERAGE' },
        Validation: { ReviewState: 'VERIFIED' },
        Nutrition: { EnergyKJ: 4, SugarsG: 0, SaturatedFatG: 0, SodiumMG: 10, ProteinG: 0, FibreG: 0 },
        expectedGrade: 'B',
      },
      {
        name: 'Regular Sugar Cola',
        Classification: { NutritionCategory: 'Beverages', FSACategoryCode: 'BEVERAGE' },
        Validation: { ReviewState: 'VERIFIED' },
        Nutrition: { EnergyKJ: 180, SugarsG: 10.6, SaturatedFatG: 0, SodiumMG: 4, ProteinG: 0, FibreG: 0 },
        expectedGrade: 'E',
      },
      {
        name: 'Whole Fresh Apple',
        Classification: { NutritionCategory: 'Fruit', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 218, SugarsG: 10.3, SaturatedFatG: 0.1, SodiumMG: 1, FibreG: 2.4, ProteinG: 0.3, FVL: { Percentage: 100 } },
        expectedGrade: 'A',
      },
      {
        name: 'Fresh Raw Broccoli',
        Classification: { NutritionCategory: 'Vegetables', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 142, SugarsG: 1.7, SaturatedFatG: 0.1, SodiumMG: 33, FibreG: 2.6, ProteinG: 2.8, FVL: { Percentage: 100 } },
        expectedGrade: 'A',
      },
      {
        name: 'Rolled Oats (100% Wholegrain)',
        Classification: { NutritionCategory: 'Cereals & Grains', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 1530, SugarsG: 1.0, SaturatedFatG: 1.3, SodiumMG: 2, FibreG: 10.0, ProteinG: 13.5 },
        expectedGrade: 'A',
      },
      {
        name: 'Skimmed Milk (0.1% Fat)',
        Classification: { NutritionCategory: 'Dairy', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'VERIFIED' },
        Nutrition: { EnergyKJ: 147, SugarsG: 4.8, SaturatedFatG: 0.1, SodiumMG: 44, FibreG: 0, ProteinG: 3.4 },
        expectedGrade: 'B',
      },
      {
        name: 'Skinless Chicken Breast Fillet',
        Classification: { NutritionCategory: 'Meat & Eggs', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 440, SugarsG: 0, SaturatedFatG: 0.3, SodiumMG: 65, FibreG: 0, ProteinG: 24.0 },
        expectedGrade: 'A',
      },
      {
        name: 'Canned Baked Beans in Tomato Sauce',
        Classification: { NutritionCategory: 'Legumes', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'VERIFIED' },
        Nutrition: { EnergyKJ: 350, SugarsG: 4.5, SaturatedFatG: 0.1, SodiumMG: 240, FibreG: 4.5, ProteinG: 5.2, FVL: { Percentage: 45 } },
        expectedGrade: 'A',
      },
      {
        name: 'Plain White Rice (cooked)',
        Classification: { NutritionCategory: 'Cereals & Grains', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'VERIFIED' },
        Nutrition: { EnergyKJ: 544, SugarsG: 0.1, SaturatedFatG: 0.1, SodiumMG: 1, FibreG: 0.4, ProteinG: 2.7 },
        expectedGrade: 'B',
      },
      {
        name: 'Wholemeal Bread Slice',
        Classification: { NutritionCategory: 'Cereals & Grains', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'VERIFIED' },
        Nutrition: { EnergyKJ: 920, SugarsG: 3.2, SaturatedFatG: 0.5, SodiumMG: 380, FibreG: 6.0, ProteinG: 9.0 },
        expectedGrade: 'A',
      },
      {
        name: 'Extra Virgin Olive Oil',
        Classification: { NutritionCategory: 'Fats & Oils', FSACategoryCode: 'ADDED_FAT' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 3700, FatG: 100, SugarsG: 0, SaturatedFatG: 14.0, SodiumMG: 0, FibreG: 0, ProteinG: 0 },
        expectedGrade: 'D',
      },
      {
        name: 'Standard Salted Butter',
        Classification: { NutritionCategory: 'Fats & Oils', FSACategoryCode: 'ADDED_FAT' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 3050, FatG: 82, SugarsG: 0.6, SaturatedFatG: 52.0, SodiumMG: 600, FibreG: 0, ProteinG: 0.8 },
        expectedGrade: 'E',
      },
      {
        name: 'Mature Cheddar Cheese',
        Classification: { NutritionCategory: 'Dairy', FSACategoryCode: 'CHEESE' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 1725, SugarsG: 0.1, SaturatedFatG: 21.7, SodiumMG: 720, FibreG: 0, ProteinG: 25.4 },
        expectedGrade: 'D',
      },
      {
        name: 'Milk Chocolate Bar',
        Classification: { NutritionCategory: 'Confectionery', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'VERIFIED' },
        Nutrition: { EnergyKJ: 2280, SugarsG: 56.0, SaturatedFatG: 18.5, SodiumMG: 80, FibreG: 2.0, ProteinG: 7.5 },
        expectedGrade: 'E',
      },
      {
        name: 'Salted Potato Crisps',
        Classification: { NutritionCategory: 'Confectionery', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'VERIFIED' },
        Nutrition: { EnergyKJ: 2200, SugarsG: 0.5, SaturatedFatG: 4.5, SodiumMG: 560, FibreG: 4.0, ProteinG: 6.0 },
        expectedGrade: 'D',
      },
      {
        name: 'Pure Granulated Sugar',
        Classification: { NutritionCategory: 'Confectionery', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 1700, SugarsG: 100.0, SaturatedFatG: 0, SodiumMG: 0, FibreG: 0, ProteinG: 0 },
        expectedGrade: 'E',
      },
      {
        name: 'Fresh Salmon Fillet (raw)',
        Classification: { NutritionCategory: 'Fish & Seafood', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 870, SugarsG: 0, SaturatedFatG: 3.1, SodiumMG: 50, FibreG: 0, ProteinG: 20.0 },
        expectedGrade: 'A',
      },
      {
        name: 'Lean Beef Mince (5% Fat)',
        Classification: { NutritionCategory: 'Meat & Eggs', FSACategoryCode: 'RED_MEAT' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 560, SugarsG: 0, SaturatedFatG: 2.0, SodiumMG: 55, FibreG: 0, ProteinG: 21.0 },
        expectedGrade: 'B',
      },
      {
        name: 'Plain Greek Yogurt (0% Fat)',
        Classification: { NutritionCategory: 'Dairy', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 240, SugarsG: 3.8, SaturatedFatG: 0.05, SodiumMG: 40, FibreG: 0, ProteinG: 10.0 },
        expectedGrade: 'A',
      },
    ]

    it('scores all 20 reference foods to exact expected grades under FSA-NPS 2023', () => {
      expect(referenceFoods).toHaveLength(20)
      for (const item of referenceFoods) {
        const evalRes = evaluateItem(item, null, { bypassCache: true })
        expect(
          evalRes.grade,
          `Failed reference food "${item.name}": expected ${item.expectedGrade}, got ${evalRes.grade} (score=${evalRes.score})`
        ).toBe(item.expectedGrade)
        expect(evalRes.status).toBe('COMPUTED_CONFIRMED')
        expect(evalRes.missing).toHaveLength(0)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Completeness Property & Metamorphic Invariant (E-01)
  // ---------------------------------------------------------------------------
  describe('2. Negative Completeness Property & Metamorphic Invariant (E-01)', () => {
    const completeItem = {
      Identity: { ProductID: 'sku-test-01' },
      Validation: { ReviewState: 'VERIFIED' },
      Classification: { NutritionCategory: 'Cereals & Grains' },
      Nutrition: {
        EnergyKJ: 1500,
        SugarsG: 10,
        SaturatedFatG: 2,
        SodiumMG: 100,
        ProteinG: 8,
        FibreG: 4,
      },
    }

    it('grades a completely specified product with status COMPUTED_CONFIRMED', () => {
      const res = evaluateItem(completeItem, null, { bypassCache: true })
      expect(res.status).toBe('COMPUTED_CONFIRMED')
      expect(res.grade).not.toBeNull()
      expect(res.missing).toHaveLength(0)
    })

    it('metamorphic test: nulling energy flips status to INSUFFICIENT_DATA and grade to null', () => {
      const copy = JSON.parse(JSON.stringify(completeItem))
      copy.Nutrition.EnergyKJ = null
      delete copy.Nutrition.EnergyKcal

      const res = evaluateItem(copy, null, { bypassCache: true })
      expect(res.status).toBe('INSUFFICIENT_DATA')
      expect(res.grade).toBeNull()
      expect(res.missing).toContain('energy')
    })

    it('metamorphic test: nulling sugars flips status to INSUFFICIENT_DATA and grade to null', () => {
      const copy = JSON.parse(JSON.stringify(completeItem))
      copy.Nutrition.SugarsG = null

      const res = evaluateItem(copy, null, { bypassCache: true })
      expect(res.status).toBe('INSUFFICIENT_DATA')
      expect(res.grade).toBeNull()
      expect(res.missing).toContain('sugars')
    })

    it('metamorphic test: nulling saturated fat flips status to INSUFFICIENT_DATA and grade to null', () => {
      const copy = JSON.parse(JSON.stringify(completeItem))
      copy.Nutrition.SaturatedFatG = null

      const res = evaluateItem(copy, null, { bypassCache: true })
      expect(res.status).toBe('INSUFFICIENT_DATA')
      expect(res.grade).toBeNull()
      expect(res.missing).toContain('saturated_fat')
    })

    it('metamorphic test: nulling sodium AND salt flips status to INSUFFICIENT_DATA and grade to null', () => {
      const copy = JSON.parse(JSON.stringify(completeItem))
      copy.Nutrition.SodiumMG = null
      delete copy.Nutrition.SaltG

      const res = evaluateItem(copy, null, { bypassCache: true })
      expect(res.status).toBe('INSUFFICIENT_DATA')
      expect(res.grade).toBeNull()
      expect(res.missing).toContain('sodium_or_salt')
    })

    it('computes sodium from salt when SodiumMG is absent (ADR-8: salt * 400)', () => {
      const copy = JSON.parse(JSON.stringify(completeItem))
      copy.Nutrition.SodiumMG = null
      copy.Nutrition.SaltG = 0.5 // 0.5g salt = 200mg sodium

      const res = evaluateItem(copy, null, { bypassCache: true })
      expect(res.status).toBe('COMPUTED_CONFIRMED')
      expect(res.grade).not.toBeNull()
      expect(res.missing).toHaveLength(0)

      const sodiumFact = res.facts.find(f => f.key === 'sodiumMg')
      expect(sodiumFact).toBeDefined()
      expect(sodiumFact!.value).toBe(200)
    })

    it('nulling positive components (fibre, protein) still computes grade with recorded assumptions', () => {
      const copy = JSON.parse(JSON.stringify(completeItem))
      copy.Nutrition.FibreG = null
      copy.Nutrition.ProteinG = null

      const res = evaluateItem(copy, null, { bypassCache: true })
      expect(res.status).toBe('COMPUTED_CONFIRMED')
      expect(res.grade).not.toBeNull()
      expect(res.assumptions).toContain('fibre_zero')
      expect(res.assumptions).toContain('protein_zero')
    })
  })

  // ---------------------------------------------------------------------------
  // 3. ADR-8: Salt to Sodium Constant Verification
  // ---------------------------------------------------------------------------
  describe('3. ADR-8: Salt to Sodium Constant Verification', () => {
    it('uses exact factor 400 mg sodium per g salt across all modules', () => {
      expect(SALT_TO_SODIUM_FACTOR_MG_PER_G).toBe(400)
      expect(Kernel.SALT_TO_SODIUM_FACTOR_MG_PER_G).toBe(400)

      const canonical = canonicalise({
        Nutrition: { SaltG: 1.5 },
      })
      expect(canonical.sodiumMg).toBe(600) // 1.5 * 400
      expect(canonical.saltG).toBe(1.5)
      expect(canonical.sodiumDerivedFromSalt).toBe(true)
    })

    it('detects inconsistency when labelled salt and sodium disagree by > 20%', () => {
      const inconsistent = canonicalise({
        Nutrition: { SaltG: 1.0, SodiumMG: 100 }, // 1.0g salt = 400mg sodium, but declared is 100mg
      })
      expect(inconsistent.sodiumSaltInconsistent).toBe(true)

      const consistent = canonicalise({
        Nutrition: { SaltG: 1.0, SodiumMG: 380 }, // 380 vs 400 is 5% diff
      })
      expect(consistent.sodiumSaltInconsistent).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // 4. ReviewState Gating (E-05): COMPUTED_PROVISIONAL vs COMPUTED_CONFIRMED
  // ---------------------------------------------------------------------------
  describe('4. ReviewState Gating (E-05)', () => {
    const productBase = {
      Identity: { ProductID: 'sku-rs-01' },
      Classification: { NutritionCategory: 'Beverages' },
      Nutrition: { EnergyKJ: 200, SugarsG: 12, SaturatedFatG: 0, SodiumMG: 20 },
    }

    const testPolicy = {
      profileVer: 1,
      blockMode: 'warn' as const,
      per100gFlags: [{ n: 'sugars_g_per_100g_max', gt: 10 }],
    }

    it('ESTIMATED tier yields COMPUTED_PROVISIONAL and policy action none', () => {
      const estimatedProduct = {
        ...productBase,
        Validation: { ReviewState: 'ESTIMATED' },
      }
      const res = evaluateItem(estimatedProduct, testPolicy, { bypassCache: true })
      expect(res.status).toBe('COMPUTED_PROVISIONAL')
      expect(res.tier).toBe('estimated')
      expect(res.grade).not.toBeNull()
      // Policy triggers exist, but action is NONE because min_conf_ok is false
      expect(res.decision.action).toBe('none')
      expect(res.decision.min_conf_ok).toBe(false)
      expect(res.decision.triggers).toHaveLength(1)
    })

    it('VERIFIED tier yields COMPUTED_CONFIRMED and active policy warning', () => {
      const verifiedProduct = {
        ...productBase,
        Validation: { ReviewState: 'VERIFIED' },
      }
      const res = evaluateItem(verifiedProduct, testPolicy, { bypassCache: true })
      expect(res.status).toBe('COMPUTED_CONFIRMED')
      expect(res.tier).toBe('confirmed')
      expect(res.grade).not.toBeNull()
      expect(res.decision.action).toBe('warn')
      expect(res.decision.min_conf_ok).toBe(true)
      expect(res.decision.triggers).toHaveLength(1)
      expect(res.decision.triggers[0].n).toBe('sugars_g_per_100g_max')
    })

    it('UNVERIFIED tier yields INSUFFICIENT_DATA and grade null', () => {
      const unverifiedProduct = {
        ...productBase,
        Validation: { ReviewState: 'UNVERIFIED' },
      }
      const res = evaluateItem(unverifiedProduct, testPolicy, { bypassCache: true })
      expect(res.status).toBe('INSUFFICIENT_DATA')
      expect(res.tier).toBe('not_rated')
      expect(res.grade).toBeNull()
      expect(res.decision.action).toBe('none')
    })
  })

  // ---------------------------------------------------------------------------
  // 5. Policy Engine v2 & Dimensionless Tokens (E-04, Invariant T21)
  // ---------------------------------------------------------------------------
  describe('5. Policy Engine v2 & Dimensionless Tokens (E-04)', () => {
    const vec = canonicalise({
      Nutrition: {
        EnergyKJ: 1000,
        SugarsG: 25,
        SaturatedFatG: 6,
        SodiumMG: 650,
      },
      Safety: { Allergens: ['peanuts', 'gluten'] },
    })
    const gate = gateNutrients({}, vec)

    it('unknown / missing nutrient NEVER triggers a constraint', () => {
      const policyWithCarbs = {
        profileVer: 1,
        per100gFlags: [{ n: 'carbs_g_per_100g_max', gt: 20 }], // carbs is null on vec
      }
      const decision = evaluatePolicy(vec, gate, 'confirmed', policyWithCarbs)
      expect(decision.action).toBe('none')
      expect(decision.triggers).toHaveLength(0)
    })

    it('ignores per_day constraints at item level', () => {
      const policyPerDay = {
        profileVer: 1,
        per100gFlags: [{ n: 'sodium_mg_per_day_max', gt: 500, basis: 'per_day' }],
      }
      const decision = evaluatePolicy(vec, gate, 'confirmed', policyPerDay)
      expect(decision.action).toBe('none')
      expect(decision.triggers).toHaveLength(0)
    })

    it('triggers clinical_soft action when per_100g constraint is exceeded', () => {
      const policyExceeded = {
        profileVer: 1,
        blockMode: 'block' as const,
        per100gFlags: [{ n: 'sodium_mg_per_100g_max', gt: 600 }],
      }
      const decision = evaluatePolicy(vec, gate, 'confirmed', policyExceeded)
      expect(decision.action).toBe('block')
      expect(decision.reason_class).toBe('clinical_soft')
      expect(decision.triggers).toHaveLength(1)
      expect(decision.triggers[0].actual).toBe(650)
      expect(decision.triggers[0].limit).toBe(600)
    })

    it('triggers safety_hard action when excluded allergen is present', () => {
      const policyAllergen = {
        profileVer: 1,
        exclude: ['peanuts'],
      }
      const decision = evaluatePolicy(vec, gate, 'confirmed', policyAllergen)
      expect(decision.action).toBe('block')
      expect(decision.reason_class).toBe('safety_hard')
      expect(decision.triggers[0].allergen).toBe('peanuts')
    })

    it('returns caution when excluded allergen check cannot find allergen data', () => {
      const vecNoAllergens = canonicalise({
        Nutrition: { EnergyKJ: 1000, SugarsG: 5, SaturatedFatG: 1, SodiumMG: 50 },
      })
      delete (vecNoAllergens as any).allergens // simulate undefined allergen array

      const policyAllergen = {
        profileVer: 1,
        exclude: ['tree_nuts'],
      }
      const decision = evaluatePolicy(vecNoAllergens, gate, 'confirmed', policyAllergen)
      expect(decision.action).toBe('caution')
      expect(decision.reason_class).toBe('allergen_data_unavailable')
    })
  })

  // ---------------------------------------------------------------------------
  // 6. Zero-Throw Guarantee & Error Telemetry
  // ---------------------------------------------------------------------------
  describe('6. Zero-Throw Guarantee & Error Telemetry', () => {
    it('catches internal runtime errors safely, records eval_error, and returns NOT_ATTEMPTED', () => {
      const obsMock = { count: vi.fn() }
      ;(globalThis as any).NutriObs = obsMock

      // Hostile record designed to test zero-throw resilience inside scoring engine
      const hostileRecord = {
        Identity: { ProductID: 'sku-exploding' },
        Validation: { ReviewState: 'VERIFIED' },
        Nutrition: { EnergyKJ: 200, SugarsG: 5, SaturatedFatG: 1, SodiumMG: 50 },
        Classification: {
          get FSACategoryCode() {
            throw new Error('Exploding category getter')
          },
        },
      }

      const res = evaluateItem(hostileRecord, null, { bypassCache: true })
      expect(res.status).toBe('NOT_ATTEMPTED')
      expect(res.grade).toBeNull()
      expect(res.error_code).toContain('Exploding category getter')
      expect(obsMock.count).toHaveBeenCalledWith('eval_error', 1)

      delete (globalThis as any).NutriObs
    })
  })

  // ---------------------------------------------------------------------------
  // 7. Settings Unset Condition Defaults (E-06, D-1)
  // ---------------------------------------------------------------------------
  describe('7. Settings Unset Condition Defaults (E-06, D-1)', () => {
    it('DEFAULT_SETTINGS defaults conditions to false instead of true', () => {
      expect(DEFAULT_SETTINGS.diabetes).toBe(false)
      expect(DEFAULT_SETTINGS.hypertension).toBe(false)
      expect(DEFAULT_SETTINGS.kidney).toBe(false)
      expect(DEFAULT_SETTINGS.obesity).toBe(false)
    })

    it('getSettings defaults unset conditions to false', async () => {
      const settings = await getSettings()
      expect(settings.diabetes).toBe(false)
      expect(settings.hypertension).toBe(false)
      expect(settings.kidney).toBe(false)
      expect(settings.obesity).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // 8. Diabetic Friendly Low-Fibre Predicate (E-07)
  // ---------------------------------------------------------------------------
  describe('8. Diabetic Friendly Low-Fibre Predicate (E-07)', () => {
    const thresholds = {
      highSugar: { solidG: 22.5, liquidG: 11.25 },
      lowFibreG: 3.0,
    }

    it('sugar-free liquid with 0g sugar and 0g fibre passes diabetic friendly', () => {
      const sugar = { status: 'present', value: 0 }
      const fibre = { status: 'present', value: 0 }
      const carbs = { status: 'present', value: 0 }

      const res = HealthFlags.isDiabeticFriendlyPredicate(sugar, fibre, true, thresholds, carbs)
      expect(res.flag).toBe(true)
    })

    it('sugar-rich item fails diabetic friendly regardless of fibre', () => {
      const sugar = { status: 'present', value: 30 }
      const fibre = { status: 'present', value: 10 }
      const carbs = { status: 'present', value: 60 }

      const res = HealthFlags.isDiabeticFriendlyPredicate(sugar, fibre, false, thresholds, carbs)
      expect(res.flag).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // 9. Commercial Catalogue Fail-Closed Safety (X-07, Prime Rule 4)
  // ---------------------------------------------------------------------------
  describe('9. Commercial Catalogue Fail-Closed Safety (X-07)', () => {
    const validSku: CandidateSku = {
      sku_id: 'sku-c1',
      retailer: 'carrefour_ke',
      retailer_product_id: 'p1',
      name: 'Safe Oats',
      review_state: 'VERIFIED',
      per_100g: { sugars_g: 2.0, sodium_mg: 50 },
    }

    it('accepts verified SKU satisfying all constraints', () => {
      const res = evaluateSkuAgainstConstraints(validSku, { sugars_g_100g_max: 10 })
      expect(res.conforming).toBe(true)
      expect(res.violations).toHaveLength(0)
    })

    it('rejects unverified SKU even if nutritional values are low (Prime Rule 4)', () => {
      const unverifiedSku: CandidateSku = {
        ...validSku,
        review_state: 'UNVERIFIED',
      }
      const res = evaluateSkuAgainstConstraints(unverifiedSku, { sugars_g_100g_max: 10 })
      expect(res.conforming).toBe(false)
      expect(res.violations).toContain('unverified_review_state')
    })

    it('rejects SKU with missing/null constrained nutrient (unknown is not conforming)', () => {
      const missingNutrientSku: CandidateSku = {
        ...validSku,
        per_100g: { sugars_g: null, sodium_mg: 50 },
      }
      const res = evaluateSkuAgainstConstraints(missingNutrientSku, { sugars_g_100g_max: 10 })
      expect(res.conforming).toBe(false)
      expect(res.violations).toContain('sugars_g_100g_max_unknown')
    })
  })

  // ---------------------------------------------------------------------------
  // 10. Atwater 15% Energy Tolerance Window (X-12)
  // ---------------------------------------------------------------------------
  describe('10. Atwater 15% Energy Tolerance Window (X-12)', () => {
    it('accepts energy within 15% when expected energy > 20 kcal', () => {
      // Expected: 10g fat (370 kJ) + 20g carbs (340 kJ) + 10g protein (170 kJ) = 880 kJ (~210 kcal)
      // 10% discrepancy: declared 968 kJ
      const res = verifyAtwaterEnergy(968, { fatG: 10, carbsG: 20, proteinG: 10 })
      expect(res.consistent).toBe(true)
      expect(res.deltaPct).toBe(10)
    })

    it('rejects energy exceeding 15% discrepancy', () => {
      // Declared 1200 kJ vs expected 880 kJ (36.36% error)
      const res = verifyAtwaterEnergy(1200, { fatG: 10, carbsG: 20, proteinG: 10 })
      expect(res.consistent).toBe(false)
      expect(res.deltaPct).toBeGreaterThan(15)
    })

    it('allows caller to enforce strict 8% tolerance for curation linting', () => {
      // Declared 968 kJ vs 880 kJ (10% error) passes at default 15%, but fails with strict 8% lint
      const resStrict = verifyAtwaterEnergy(968, { fatG: 10, carbsG: 20, proteinG: 10 }, { tolerance: 0.08 })
      expect(resStrict.consistent).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // 11. Contract Schema & In-Memory LRU Cache
  // ---------------------------------------------------------------------------
  describe('11. Contract Schema & LRU Cache', () => {
    it('produces ItemEvaluation conforming to exact blueprint contract shape', () => {
      const item = {
        Identity: { ProductID: 'sku-contract-01' },
        Classification: { NutritionCategory: 'Fruit', FSACategoryCode: 'GENERAL_FOOD' },
        Validation: { ReviewState: 'HIGH_CONFIDENCE' },
        Nutrition: { EnergyKJ: 200, SugarsG: 8, SaturatedFatG: 0.1, SodiumMG: 5, FibreG: 2, ProteinG: 1, FVL: { Percentage: 100 } },
      }
      const evalRes: ItemEvaluation = evaluateItem(item, null, { catalogueVersion: 'cat-test-01', bypassCache: true })

      expect(evalRes).toHaveProperty('status', 'COMPUTED_CONFIRMED')
      expect(evalRes).toHaveProperty('grade', 'A')
      expect(evalRes).toHaveProperty('score')
      expect(Array.isArray(evalRes.facts)).toBe(true)
      expect(Array.isArray(evalRes.missing)).toBe(true)
      expect(Array.isArray(evalRes.assumptions)).toBe(true)
      expect(evalRes).toHaveProperty('tier', 'high_confidence')
      expect(evalRes).toHaveProperty('decision')
      expect(evalRes).toHaveProperty('versions')
      expect(evalRes.versions).toEqual({
        scoring: 'v5',
        algorithm: 'fsa-nps-2023',
        catalogue: 'cat-test-01',
        profile: null,
      })
    })

    it('returns cached evaluation on repeated calls with matching keys', () => {
      const item = {
        Identity: { ProductID: 'sku-cache-test' },
        Validation: { ReviewState: 'VERIFIED' },
        Nutrition: { EnergyKJ: 200, SugarsG: 8, SaturatedFatG: 0.1, SodiumMG: 5 },
      }

      const res1 = evaluateItem(item, null, { catalogueVersion: 'cat-v1' })
      const res2 = evaluateItem(item, null, { catalogueVersion: 'cat-v1' })

      expect(res1).toBe(res2) // Identity equality verifies cache hit
    })
  })
})
