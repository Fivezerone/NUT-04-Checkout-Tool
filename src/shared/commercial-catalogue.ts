/**
 * NutriScore CAD Phase 8 — Commercial Catalogue Filter
 *
 * Reference: Blueprint §4.3, Decision D6, Amendment A6
 *
 * Provides DPT-authenticated nutritional evaluation of reference SKUs
 * against allowlisted dietary profile constraints.
 * Strictly reference overlay: no stock, transaction, or settlement semantics.
 */

import { verifyDpt, type DptPayload } from './dpt'
import { verifyDpopProof } from './dpop'

export interface SkuNutrition {
  energy_kcal?: number | null
  energy_kj?: number | null
  sugars_g?: number | null
  carbs_g?: number | null
  fat_g?: number | null
  satfat_g?: number | null
  fibre_g?: number | null
  protein_g?: number | null
  sodium_mg?: number | null
  salt_g?: number | null
}

export interface CandidateSku {
  sku_id: string
  retailer: string
  retailer_product_id: string
  name: string
  brand?: string | null
  category_kfct?: string | null
  nova?: number | null
  per_100g: SkuNutrition
  review_state: string
  active?: boolean
}

export interface SkuEvaluationResult {
  sku_id: string
  conforming: boolean
  violations: string[]
}

/**
 * Evaluates whether a candidate SKU satisfies the constraints in a DPT.
 */
export function evaluateSkuAgainstConstraints(
  sku: CandidateSku,
  constraints: Record<string, number>,
): SkuEvaluationResult {
  const violations: string[] = []
  const nut = sku.per_100g || {}

  for (const [key, threshold] of Object.entries(constraints)) {
    if (key === 'sugars_g_100g_max') {
      const val = nut.sugars_g
      if (val !== null && val !== undefined && val > threshold) {
        violations.push(key)
      }
    } else if (key === 'carbs_g_100g_max') {
      const val = nut.carbs_g
      if (val !== null && val !== undefined && val > threshold) {
        violations.push(key)
      }
    } else if (key === 'sodium_mg_100g_max') {
      const val = nut.sodium_mg
      if (val !== null && val !== undefined && val > threshold) {
        violations.push(key)
      }
    } else if (key === 'satfat_g_100g_max') {
      const val = nut.satfat_g
      if (val !== null && val !== undefined && val > threshold) {
        violations.push(key)
      }
    } else if (key === 'energy_kcal_100g_max') {
      const val = nut.energy_kcal
      if (val !== null && val !== undefined && val > threshold) {
        violations.push(key)
      }
    } else if (key === 'fibre_g_100g_min') {
      const val = nut.fibre_g
      if (val !== null && val !== undefined && val < threshold) {
        violations.push(key)
      }
    }
  }

  return {
    sku_id: sku.sku_id,
    conforming: violations.length === 0,
    violations,
  }
}

/**
 * Filter an array of candidate SKUs using an authenticated DPT and DPoP proof.
 */
export function filterCatalogueWithDpt(
  skus: CandidateSku[],
  dptToken: string,
  dpopProof: string,
  signerPublicKey: any,
  requestUrl: string,
  revokedJtis?: Set<string>,
): {
  conformingSkus: CandidateSku[]
  allEvaluations: SkuEvaluationResult[]
  payload: DptPayload
} {
  // 1. Verify DPoP proof
  const dpopResult = verifyDpopProof(dpopProof, 'POST', requestUrl)
  if (!dpopResult.valid || !dpopResult.jkt) {
    throw new Error(`DPoP verification failed: ${dpopResult.error}`)
  }

  // 2. Verify DPT token (never log the token!)
  const dptResult = verifyDpt(dptToken, signerPublicKey, dpopResult.jkt, revokedJtis)
  if (!dptResult.valid || !dptResult.payload) {
    throw new Error(`DPT verification failed: ${dptResult.error}`)
  }

  const payload = dptResult.payload
  const constraints = payload.cs || {}

  const evaluations: SkuEvaluationResult[] = []
  const conforming: CandidateSku[] = []

  for (const sku of skus) {
    const res = evaluateSkuAgainstConstraints(sku, constraints)
    evaluations.push(res)
    if (res.conforming) {
      conforming.push(sku)
    }
  }

  return {
    conformingSkus: conforming,
    allEvaluations: evaluations,
    payload,
  }
}
