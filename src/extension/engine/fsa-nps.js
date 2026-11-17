/**
 * @license SPDX-License-Identifier: Apache-2.0
 * src/extension/engine/fsa-nps.js — Pure FSA-NPS 2023 Grade Computation Kernel.
 * Reference: Blueprint §2.1 (E-01..E-05, Invariant T20)
 *
 * Responsibilities:
 *   - Pure FSA-NPS algorithm execution against canonical NutrientVector.
 *   - Four category variants: GENERAL_FOOD, BEVERAGE, ADDED_FAT, CHEESE, RED_MEAT.
 *   - Positive components (fibre, protein, FVL) default to 0 points only when null (recorded in assumptions).
 *   - Negative components MUST be present (enforced by gate G2 before calling this).
 *   - Pure function, zero I/O, zero dependencies.
 */

;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory()
  } else {
    const exports = factory()
    root.NutriFsaNps = exports
    if (typeof self !== 'undefined') self.NutriFsaNps = exports
    if (typeof window !== 'undefined') window.NutriFsaNps = exports
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const NUTRITION_CATEGORY_TO_FSA = Object.freeze({
    Beverages: 'BEVERAGE',
    'Fats & Oils': 'ADDED_FAT',
    Dairy: 'GENERAL_FOOD',
    'Cereals & Grains': 'GENERAL_FOOD',
    Confectionery: 'GENERAL_FOOD',
    'Meat & Eggs': 'GENERAL_FOOD',
    'Condiments & Spices': 'GENERAL_FOOD',
    Vegetables: 'GENERAL_FOOD',
    Fruit: 'GENERAL_FOOD',
    'Nuts & Seeds': 'GENERAL_FOOD',
    Legumes: 'GENERAL_FOOD',
    'Mixed Dishes': 'GENERAL_FOOD',
    'Fish & Seafood': 'GENERAL_FOOD',
    'Starchy Roots': 'GENERAL_FOOD',
  })

  function resolveFsaCategory(categoryCodeOrNutritionCategory) {
    if (!categoryCodeOrNutritionCategory) return 'GENERAL_FOOD'
    const cat = String(categoryCodeOrNutritionCategory).trim()
    if (
      cat === 'BEVERAGE' ||
      cat === 'ADDED_FAT' ||
      cat === 'CHEESE' ||
      cat === 'RED_MEAT' ||
      cat === 'GENERAL_FOOD'
    ) {
      return cat
    }
    return NUTRITION_CATEGORY_TO_FSA[cat] || 'GENERAL_FOOD'
  }

  function generalLetter(score) {
    if (score <= -1) return 'A'
    if (score <= 2) return 'B'
    if (score <= 10) return 'C'
    if (score <= 18) return 'D'
    return 'E'
  }

  function beverageLetter(score, isWater = false) {
    if (isWater) return 'A'
    if (score <= 1) return 'B'
    if (score <= 5) return 'C'
    if (score <= 9) return 'D'
    return 'E'
  }

  /**
   * Calculates the FSA-NPS 2023 score and letter grade.
   *
   * @param {Object} vec - Canonical NutrientVector from kernel.canonicalise()
   * @param {string} [category] - FSA category or NutritionCategory
   * @param {Object} [options] - Options e.g. { isWater: boolean }
   * @returns {Object} ScoreResult
   */
  function fsaNps2023(vec, category = 'GENERAL_FOOD', options = {}) {
    if (!vec) {
      throw new Error('[fsa-nps] Missing NutrientVector')
    }

    const fsaCat = resolveFsaCategory(category)

    // Negative component calculation
    let nEnergy = 0
    let nSugars = 0
    let nSatFat = 0
    let nSodium = 0

    if (fsaCat === 'BEVERAGE') {
      const eKj = vec.energyKj ?? 0
      nEnergy = eKj <= 0 ? 0 : Math.min(Math.floor(eKj / 30) + 1, 10)
      const sG = vec.sugarsG ?? 0
      nSugars = sG <= 0 ? 0 : Math.min(Math.floor(sG / 1.5) + 1, 15)
      nSatFat = Math.min(Math.floor((vec.satFatG ?? 0) / 1), 10)
      nSodium = Math.min(Math.floor((vec.sodiumMg ?? 0) / 80), 20)
    } else if (fsaCat === 'ADDED_FAT') {
      nEnergy = Math.min(Math.floor((vec.energyKj ?? 0) / 335), 10)
      nSugars = Math.min(Math.floor((vec.sugarsG ?? 0) / 3.4), 15)
      const scoreSatFat = vec.satFatG ?? 0
      const totalFat = (vec.fatG ?? 0) || scoreSatFat * 1.5
      const ratio = totalFat > 0 ? (scoreSatFat / totalFat) * 100 : 0
      nSatFat = Math.min(Math.floor(ratio / 10), 10)
      nSodium = Math.min(Math.floor((vec.sodiumMg ?? 0) / 80), 20)
    } else {
      nEnergy = Math.min(Math.floor((vec.energyKj ?? 0) / 335), 10)
      nSugars = Math.min(Math.floor((vec.sugarsG ?? 0) / 3.4), 15)
      nSatFat = Math.min(Math.floor((vec.satFatG ?? 0) / 1), 10)
      nSodium = Math.min(Math.floor((vec.sodiumMg ?? 0) / 80), 20)
    }

    const nPoints = nEnergy + nSugars + nSatFat + nSodium

    // Positive component calculation (positive components only can default to 0 points; recorded in assumptions)
    const assumptions = []
    if (vec.fibreG === null) assumptions.push('fibre_zero')
    if (vec.proteinG === null) assumptions.push('protein_zero')
    if (vec.fvlPct === null) assumptions.push('fvl_zero')

    const pFibre = Math.min(Math.floor((vec.fibreG ?? 0) / 0.9), 5)
    let pProtein = Math.min(Math.floor((vec.proteinG ?? 0) / 2.4), 7)
    if (fsaCat === 'RED_MEAT') {
      pProtein = Math.min(pProtein, 2)
    }

    const fvl = vec.fvlPct ?? 0
    const pFVL = fvl > 80 ? 5 : fvl > 60 ? 2 : fvl > 40 ? 1 : 0

    // Final score computation rule
    let finalScore
    if (fsaCat === 'CHEESE') {
      // Cheese always counts protein
      finalScore = nPoints - pFibre - pProtein - pFVL
    } else if (nPoints >= 11 && pFVL < 5) {
      // Protein excluded if negative points >= 11 unless FVL is high (>= 5 points)
      finalScore = nPoints - pFibre - pFVL
    } else {
      finalScore = nPoints - pFibre - pProtein - pFVL
    }

    // Letter grade
    let grade
    if (fsaCat === 'BEVERAGE') {
      grade = beverageLetter(finalScore, !!options.isWater)
    } else {
      grade = generalLetter(finalScore)
    }

    return {
      score: finalScore,
      grade,
      fsaCategory: fsaCat,
      points: {
        nEnergy,
        nSugars,
        nSatFat,
        nSodium,
        nPoints,
        pFibre,
        pProtein,
        pFVL,
        finalScore,
      },
      assumptions,
    }
  }

  return {
    NUTRITION_CATEGORY_TO_FSA,
    resolveFsaCategory,
    fsaNps2023,
    generalLetter,
    beverageLetter,
  }
})
