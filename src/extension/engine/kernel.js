/**
 * @license SPDX-License-Identifier: Apache-2.0
 * src/extension/engine/kernel.js — Pure Nutrient Canonicalisation and Completeness Gating.
 * Reference: Blueprint §2.1 (E-01, E-03, E-05, ADR-8, Invariant T20)
 *
 * Responsibilities:
 *   - Extract canonical NutrientVector from product records without zero-imputation.
 *   - Apply ADR-8 salt-to-sodium conversion: 1g salt = 400mg sodium (EU 1169/2011 labelling convention).
 *   - Strict negative nutrient completeness gate G2 (Energy, Sugars, Saturated Fat, Sodium).
 *   - Physical plausibility checks G1.
 *   - Pure function, zero I/O, zero dependencies.
 */

;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory()
  } else {
    const exports = factory()
    root.NutriKernel = exports
    if (typeof self !== 'undefined') self.NutriKernel = exports
    if (typeof window !== 'undefined') window.NutriKernel = exports
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // ADR-8: Salt to sodium conversion constant (mg sodium per gram salt)
  // EU labelling regulation 1169/2011 defines salt = sodium * 2.5, so sodium (mg) = salt (g) * 400.
  const SALT_TO_SODIUM_FACTOR_MG_PER_G = 400

  // Plausibility bounds per 100g / 100ml (Blueprint §2.1 set-point tuning)
  const PLAUSIBILITY_BOUNDS = Object.freeze({
    energyKj: { min: 0, max: 4000 },
    energyKcal: { min: 0, max: 956 },
    sugarsG: { min: 0, max: 100 },
    satFatG: { min: 0, max: 100 },
    sodiumMg: { min: 0, max: 40000 },
    fatG: { min: 0, max: 100 },
    carbsG: { min: 0, max: 100 },
    proteinG: { min: 0, max: 100 },
    fibreG: { min: 0, max: 100 },
    fvlPct: { min: 0, max: 100 },
  })

  function isLiquid(unit) {
    if (!unit) return false
    const u = String(unit).trim().toLowerCase()
    return u === 'ml' || u === 'l' || u === 'cl'
  }

  function parseNumber(val) {
    if (val === null || val === undefined || val === '') return null
    if (typeof val === 'object' && val !== null) {
      if ('ValueMG' in val) return parseNumber(val.ValueMG)
      if ('ValueG' in val) return parseNumber(val.ValueG)
      if ('ValueKcal' in val) return parseNumber(val.ValueKcal)
      if ('value' in val) return parseNumber(val.value)
    }
    const n = Number(val)
    if (isNaN(n) || !isFinite(n) || n < 0) return null
    return n
  }

  /**
   * Resolves sodium in milligrams from sodium and salt data.
   * Follows ADR-8: salt (g) * 400 = sodium (mg).
   * Flags consistency warning if both exist and disagree by > 20%.
   */
  function resolveSodiumMg(sodiumRaw, saltRaw) {
    const sMg = parseNumber(sodiumRaw)
    const saltG = parseNumber(saltRaw)

    if (sMg !== null && saltG !== null) {
      const derivedMg = saltG * SALT_TO_SODIUM_FACTOR_MG_PER_G
      const maxVal = Math.max(sMg, derivedMg)
      const diff = Math.abs(sMg - derivedMg)
      const inconsistent = maxVal > 0 && diff / maxVal > 0.2
      return {
        value: sMg,
        saltEquivalentG: saltG,
        derived: false,
        inconsistent,
      }
    }

    if (sMg !== null) {
      return {
        value: sMg,
        saltEquivalentG: sMg / SALT_TO_SODIUM_FACTOR_MG_PER_G,
        derived: false,
        inconsistent: false,
      }
    }

    if (saltG !== null) {
      const derivedMg = saltG * SALT_TO_SODIUM_FACTOR_MG_PER_G
      return {
        value: derivedMg,
        saltEquivalentG: saltG,
        derived: true,
        inconsistent: false,
      }
    }

    return {
      value: null,
      saltEquivalentG: null,
      derived: false,
      inconsistent: false,
    }
  }

  /**
   * Canonicalises a raw catalog / retailer record into a clean NutrientVector.
   * Unknown values remain NULL (zero-imputation is strictly forbidden).
   */
  function canonicalise(record) {
    if (!record) return null

    const n = record.Nutrition || record.per_100g || record.NutritionInformation || {}
    const pkg = record.Packaging || {}
    const identity = record.Identity || {}
    const safety = record.Safety || {}

    // Energy resolution
    let energyKj = parseNumber(n.EnergyKJ ?? n.energy_kj ?? n.energyKj)
    let energyKcal = parseNumber(n.EnergyKcal ?? n.energy_kcal ?? n.energyKcal)
    if (energyKj === null && energyKcal !== null) {
      energyKj = energyKcal * 4.184
    } else if (energyKcal === null && energyKj !== null) {
      energyKcal = energyKj / 4.184
    }

    const sugarsG = parseNumber(n.SugarsG ?? n.sugars_g ?? n.sugarsG ?? n.Sugars)
    const satFatG = parseNumber(n.SaturatedFatG ?? n.satfat_g ?? n.satFatG ?? n.SaturatedFat)
    const fatG = parseNumber(n.FatG ?? n.fat_g ?? n.fatG ?? n.TotalFat)
    const carbsG = parseNumber(n.CarbohydratesG ?? n.carbs_g ?? n.carbsG ?? n.Carbohydrates)
    const proteinG = parseNumber(n.ProteinG ?? n.protein_g ?? n.proteinG ?? n.Protein)
    const fibreG = parseNumber(n.FibreG ?? n.fibre_g ?? n.fibreG ?? n.Fibre)
    const fvlPct = parseNumber(n.FVL?.Percentage ?? n.fvl_pct ?? n.fvlPct)

    const rawSodium = n.SodiumMG ?? n.sodium_mg ?? n.sodiumMg ?? n.Sodium?.ValueMG ?? n.Sodium
    const rawSalt = n.SaltG ?? n.salt_g ?? n.saltG ?? n.Salt
    const sodiumResolved = resolveSodiumMg(rawSodium, rawSalt)

    const potassiumMg = parseNumber(n.PotassiumMG ?? n.potassium_mg ?? n.potassiumMg)
    const phosphorusMg = parseNumber(n.PhosphorusMG ?? n.phosphorus_mg ?? n.phosphorusMg)

    const liquid = isLiquid(pkg.PackSizeUnit || record.packSizeUnit || record.sizeUnit)
    const servingG = parseNumber(pkg.ServingSizeG || record.ServingSizeG || record.servingSizeG)

    // Allergens from Safety or record level (G-09)
    let allergens = undefined
    if (Array.isArray(safety.Allergens)) {
      allergens = [...safety.Allergens]
    } else if (Array.isArray(record.Allergens)) {
      allergens = [...record.Allergens]
    }

    return {
      productId: identity.ProductID || record.productId || record.GroceryProductID || null,
      energyKj,
      energyKcal,
      sugarsG,
      satFatG,
      fatG,
      carbsG,
      proteinG,
      fibreG,
      fvlPct,
      sodiumMg: sodiumResolved.value,
      saltG: sodiumResolved.saltEquivalentG,
      sodiumDerivedFromSalt: sodiumResolved.derived,
      sodiumSaltInconsistent: sodiumResolved.inconsistent,
      potassiumMg,
      phosphorusMg,
      allergens,
      liquid,
      servingG,
    }
  }

  /**
   * Evaluates physical plausibility (G1) and nutrient completeness (G2).
   * Gate G2 requires all four negative components:
   *   1. Energy (kJ or kcal)
   *   2. Sugars (g)
   *   3. Saturated Fat (g)
   *   4. Sodium (mg or salt g)
   */
  function gate(record, vec) {
    if (!vec) {
      return {
        g1: false,
        g2: false,
        missing: ['energy', 'sugars', 'saturated_fat', 'sodium_or_salt'],
        plausibleFields: [],
        implausibleFields: [],
      }
    }

    const missing = []
    if (vec.energyKj === null && vec.energyKcal === null) {
      missing.push('energy')
    }
    if (vec.sugarsG === null) {
      missing.push('sugars')
    }
    if (vec.satFatG === null) {
      missing.push('saturated_fat')
    }
    if (vec.sodiumMg === null && vec.saltG === null) {
      missing.push('sodium_or_salt')
    }

    const plausibleFields = []
    const implausibleFields = []

    function checkField(key, val, unit, bounds) {
      if (val === null || val === undefined) return
      if (val >= bounds.min && val <= bounds.max) {
        plausibleFields.push({ key, value: val, unit })
      } else {
        implausibleFields.push({ key, value: val, unit, bounds })
      }
    }

    checkField('energyKj', vec.energyKj, 'kJ', PLAUSIBILITY_BOUNDS.energyKj)
    checkField('sugarsG', vec.sugarsG, 'g', PLAUSIBILITY_BOUNDS.sugarsG)
    checkField('satFatG', vec.satFatG, 'g', PLAUSIBILITY_BOUNDS.satFatG)
    checkField('sodiumMg', vec.sodiumMg, 'mg', PLAUSIBILITY_BOUNDS.sodiumMg)
    checkField('fatG', vec.fatG, 'g', PLAUSIBILITY_BOUNDS.fatG)
    checkField('carbsG', vec.carbsG, 'g', PLAUSIBILITY_BOUNDS.carbsG)
    checkField('proteinG', vec.proteinG, 'g', PLAUSIBILITY_BOUNDS.proteinG)
    checkField('fibreG', vec.fibreG, 'g', PLAUSIBILITY_BOUNDS.fibreG)
    checkField('fvlPct', vec.fvlPct, '%', PLAUSIBILITY_BOUNDS.fvlPct)

    const g1 = implausibleFields.length === 0
    const g2 = g1 && missing.length === 0

    return {
      g1,
      g2,
      missing,
      plausibleFields,
      implausibleFields,
    }
  }

  return {
    SALT_TO_SODIUM_FACTOR_MG_PER_G,
    PLAUSIBILITY_BOUNDS,
    isLiquid,
    resolveSodiumMg,
    canonicalise,
    gate,
  }
})
