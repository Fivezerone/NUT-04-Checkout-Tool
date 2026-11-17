/**
 * @license SPDX-License-Identifier: Apache-2.0
 * src/extension/engine/policy.js — Dimensionless Token-Driven Clinical Policy Evaluator.
 * Reference: Blueprint §2.1 (E-04, E-05, ADR-10, Invariant T21)
 *
 * Responsibilities:
 *   - Evaluate products against verified Dietary Profile Token (DPT) constraints.
 *   - Dimensionless numerical limits ONLY (zero medical diagnosis strings or biomarker labels).
 *   - Per-100g/ml constraints evaluated; per-day constraints ignored at item level (delegated to exposure engine).
 *   - Unknown is NEVER a trigger: null nutrients never trigger warnings or blocks.
 *   - Fail-closed on allergens: missing allergen data on restricted token returns 'caution'.
 *   - ReviewState gating (E-05): warnings and blocks require tier === 'confirmed' or 'high_confidence'.
 *   - Pure function, zero I/O, zero dependencies.
 */

;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory()
  } else {
    const exports = factory()
    root.NutriPolicy = exports
    if (typeof self !== 'undefined') self.NutriPolicy = exports
    if (typeof window !== 'undefined') window.NutriPolicy = exports
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const NONE_DECISION = Object.freeze({
    action: 'none',
    reason_class: null,
    triggers: Object.freeze([]),
    min_conf_ok: true,
  })

  // Canonical mapping from DPT / allowlisted constraint names to NutrientVector keys
  const NUTRIENT_KEY_MAP = Object.freeze({
    sugars_g_per_100g_max: 'sugarsG',
    sugars_g_100g_max: 'sugarsG',
    sugars_g: 'sugarsG',
    sugars: 'sugarsG',
    SugarsG: 'sugarsG',

    sodium_mg_per_100g_max: 'sodiumMg',
    sodium_mg_100g_max: 'sodiumMg',
    sodium_mg: 'sodiumMg',
    sodium: 'sodiumMg',
    SodiumMG: 'sodiumMg',

    satfat_g_per_100g_max: 'satFatG',
    satfat_g_100g_max: 'satFatG',
    satfat_g: 'satFatG',
    sat_fat: 'satFatG',
    SaturatedFatG: 'satFatG',

    energy_kcal_per_100g_max: 'energyKcal',
    energy_kcal_100g_max: 'energyKcal',
    energy_kcal: 'energyKcal',
    energy: 'energyKcal',
    EnergyKcal: 'energyKcal',

    energy_kj_per_100g_max: 'energyKj',
    energy_kj_100g_max: 'energyKj',
    energy_kj: 'energyKj',
    EnergyKJ: 'energyKj',

    carbs_g_per_100g_max: 'carbsG',
    carbs_g_100g_max: 'carbsG',
    carbs_g: 'carbsG',
    carbohydrates: 'carbsG',
    CarbohydratesG: 'carbsG',

    fibre_g_per_100g_min: 'fibreG',
    fibre_g_100g_min: 'fibreG',
    fibre_g: 'fibreG',
    fibre: 'fibreG',
    FibreG: 'fibreG',

    protein_g_per_100g_min: 'proteinG',
    protein_g_100g_min: 'proteinG',
    protein_g: 'proteinG',
    protein: 'proteinG',
    ProteinG: 'proteinG',
  })

  function resolveNutrientValue(vec, constraintName) {
    if (!vec) return null
    const mappedKey = NUTRIENT_KEY_MAP[constraintName]
    if (mappedKey && vec[mappedKey] !== undefined) {
      return vec[mappedKey]
    }
    if (vec[constraintName] !== undefined) {
      return vec[constraintName]
    }
    return null
  }

  /**
   * Evaluates a product against a clinical policy.
   *
   * @param {Object} vec - Canonical NutrientVector
   * @param {Object} gate - Result of kernel.gate()
   * @param {string} tier - 'high_confidence' | 'confirmed' | 'estimated' | 'not_rated'
   * @param {Object|null} policy - Token-derived policy object
   * @returns {Object} PolicyDecision
   */
  function evaluatePolicy(vec, gate, tier, policy) {
    // If no verified policy token exists: neutral policy (zero warning, zero block)
    if (!policy) {
      return { ...NONE_DECISION, triggers: [] }
    }

    const triggers = []

    // 1. Evaluate per-100g/ml numerical flags
    const per100gFlags = policy.per100gFlags || []
    for (const f of per100gFlags) {
      if (!f || !f.n) continue
      // per-day constraints are ignored at item level
      if (f.basis === 'per_day' || String(f.n).includes('per_day')) continue

      const val = resolveNutrientValue(vec, f.n)
      // Unknown is NEVER a trigger: null values never trigger a flag
      if (val === null || val === undefined) continue

      if (f.gt != null && val > f.gt) {
        triggers.push({
          n: f.n,
          actual: val,
          limit: f.gt,
          cmp: 'gt',
        })
      } else if (f.lt != null && val < f.lt) {
        triggers.push({
          n: f.n,
          actual: val,
          limit: f.lt,
          cmp: 'lt',
        })
      }
    }

    // 2. Evaluate allergen exclusions (fail-closed)
    const exclude = policy.exclude || []
    if (exclude.length > 0) {
      if (!vec || vec.allergens === undefined) {
        // Missing allergen dataset when allergens are restricted: caution
        return {
          action: 'caution',
          reason_class: 'allergen_data_unavailable',
          triggers,
          min_conf_ok: false,
          profile_ver: policy.profileVer ?? null,
        }
      }
      for (const a of exclude) {
        if (Array.isArray(vec.allergens) && vec.allergens.includes(a)) {
          // Direct allergen violation is hard safety action
          return {
            action: policy.blockMode || 'block',
            reason_class: 'safety_hard',
            triggers: [{ allergen: a, actual: true, limit: false, cmp: 'eq' }, ...triggers],
            min_conf_ok: true,
            profile_ver: policy.profileVer ?? null,
          }
        }
      }
    }

    // 3. ReviewState & Completeness Gating (E-05, P1)
    // Warnings and blocks are ONLY permitted when evidence tier is confirmed or high_confidence
    const confirmed = tier === 'confirmed' || tier === 'high_confidence'
    const g2Passed = !!(gate && gate.g2)

    if (!triggers.length || !confirmed || !g2Passed) {
      return {
        action: 'none',
        reason_class: null,
        triggers,
        min_conf_ok: confirmed,
        profile_ver: policy.profileVer ?? null,
      }
    }

    // Policy trigger confirmed
    return {
      action: policy.blockMode || 'warn',
      reason_class: 'clinical_soft',
      triggers,
      min_conf_ok: true,
      profile_ver: policy.profileVer ?? null,
    }
  }

  return {
    NONE_DECISION,
    NUTRIENT_KEY_MAP,
    evaluatePolicy,
  }
})
