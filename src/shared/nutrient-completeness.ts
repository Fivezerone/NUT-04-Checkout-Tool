/**
 * src/shared/nutrient-completeness.ts — Mandatory 4-Nutrient Completeness Gate
 * Reference: Blueprint §2.1 (E-01..E-07), ADR-8, Invariant T20
 *
 * Rules:
 *   - Energy (kJ or kcal), Sugars (g), Saturated Fat (g), and Sodium (mg or salt g) must ALL be present.
 *   - Unknown is NEVER zero: missing negative nutrients must NEVER be imputed as zero.
 *   - Missing required nutrient yields 'LIMITED_NUTRITION_INFO' (neutral rating on device).
 */

export interface NutrientValues {
  energyKj?: number | null
  energyKcal?: number | null
  sugarsG?: number | null
  satFatG?: number | null
  sodiumMg?: number | null
  saltG?: number | null
  [key: string]: unknown
}

export type ComputabilityStatus = 'COMPUTABLE' | 'LIMITED_NUTRITION_INFO'

export interface NutrientCompletenessResult {
  computability: ComputabilityStatus
  missingFields: string[]
}

/**
 * Invariant T20: Evaluates completeness of nutritional data for FSA-NPS calculation.
 * Zero imputation is strictly prohibited.
 */
export function checkNutrientCompleteness(nutrition: NutrientValues): NutrientCompletenessResult {
  const missing: string[] = []

  if (nutrition.energyKj == null && nutrition.energyKcal == null) {
    missing.push('energy')
  }
  if (nutrition.sugarsG == null) {
    missing.push('sugars')
  }
  if (nutrition.satFatG == null) {
    missing.push('saturated_fat')
  }
  if (nutrition.sodiumMg == null && nutrition.saltG == null) {
    missing.push('sodium_or_salt')
  }

  if (missing.length > 0) {
    return { computability: 'LIMITED_NUTRITION_INFO', missingFields: missing }
  }

  return { computability: 'COMPUTABLE', missingFields: [] }
}
