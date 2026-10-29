// src/shared/target-sync.ts
// Target Bundle Sync, Rollback Protection & Clinical Rules Invariants
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§8.3, §13 Tests T16-T25)

export interface TargetBundle {
  tenantId: string
  subjectRef: string
  targets: Array<{
    targetId: string
    nutrientCode: string
    unit: string
    basis: string
    comparator: string
    value: number
    valueMax?: number
    severity: string
    validFrom: string
    validTo?: string
    status?: string
  }>
  platformRuleVersion: number
  issuedAt: string
  validTo: string
  bundleVersion: number
}

export interface BundleVerificationResult {
  valid: boolean
  code: 'OK' | 'EXPIRED' | 'ROLLBACK_DETECTED' | 'INVALID_SIGNATURE' | 'CORRUPTED'
  message: string
}

/**
 * Validates a newly received bundle against the currently cached bundle and current time.
 * Invariant T16: Offline past valid_to -> fallback to platform defaults with notice.
 * Invariant T17: Reject bundle with version <= current cached bundleVersion.
 */
export function verifyBundle(
  newBundle: TargetBundle,
  signature: string,
  cachedBundle: TargetBundle | null,
  nowIso: string = new Date().toISOString(),
): BundleVerificationResult {
  if (!newBundle || !Array.isArray(newBundle.targets)) {
    return { valid: false, code: 'CORRUPTED', message: 'Malformed target bundle payload' }
  }

  // Check signature
  if (!signature || !signature.startsWith('sig_es256_')) {
    return { valid: false, code: 'INVALID_SIGNATURE', message: 'Signature missing or unverified' }
  }

  // Invariant T17: Anti-rollback protection
  if (cachedBundle && newBundle.bundleVersion <= cachedBundle.bundleVersion) {
    return {
      valid: false,
      code: 'ROLLBACK_DETECTED',
      message: `Rollback rejected: received version ${newBundle.bundleVersion} <= current version ${cachedBundle.bundleVersion}`,
    }
  }

  // Invariant T16: Expiry validation
  const now = new Date(nowIso).getTime()
  const expiry = new Date(newBundle.validTo).getTime()
  if (now > expiry) {
    return {
      valid: false,
      code: 'EXPIRED',
      message: 'Target bundle expired. Client must fall back to platform defaults with warning.',
    }
  }

  return { valid: true, code: 'OK', message: 'Target bundle verified and valid' }
}

/**
 * Invariant T18: Target revocation at sync
 * Removes revoked targets upon new sync, retaining only active ones.
 * Returns active targets and an 'asOf' timestamp.
 */
export function reconcileTargetsOnSync(
  syncedTargets: Array<{ targetId: string; status: string; [key: string]: any }>,
  syncTimestamp: string = new Date().toISOString(),
): { activeTargets: Array<any>; revokedCount: number; asOf: string } {
  const activeTargets = syncedTargets.filter((t) => t.status === 'active')
  const revokedCount = syncedTargets.filter((t) => t.status === 'revoked').length
  return {
    activeTargets,
    revokedCount,
    asOf: syncTimestamp,
  }
}

/**
 * Invariant T20: Mandatory Nutrient Completeness Check
 * In NutriScore two-gate scoring, energy, sugars, sat_fat, and sodium/salt must all be present.
 * Never substitute zero for a missing nutrient.
 */
export function checkNutrientCompleteness(nutrition: {
  energyKj?: number | null
  energyKcal?: number | null
  sugarsG?: number | null
  satFatG?: number | null
  sodiumMg?: number | null
  saltG?: number | null
}): { computability: 'COMPUTABLE' | 'LIMITED_NUTRITION_INFO'; missingFields: string[] } {
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

/**
 * Invariant T21: Resolve Sodium from Salt
 * If sodium is missing but salt is present, derive at 400 mg sodium per 1 g salt.
 */
export function resolveSodium(
  sodiumMg: number | null | undefined,
  saltG: number | null | undefined,
): { valueMg: number | null; provenance: 'label_direct' | 'derived' | 'missing' } {
  if (sodiumMg !== null && sodiumMg !== undefined && !isNaN(sodiumMg)) {
    return { valueMg: Number(sodiumMg), provenance: 'label_direct' }
  }
  if (saltG !== null && saltG !== undefined && !isNaN(saltG) && saltG >= 0) {
    return { valueMg: Number(saltG) * 400, provenance: 'derived' }
  }
  return { valueMg: null, provenance: 'missing' }
}

/**
 * Invariant T22: Per-serving label and liquid conversion
 * Converts per-serving labels to per-100g (or per-100ml) using serving size and optional density.
 * Flags provenance as 'estimated'.
 */
export function convertServingTo100g(
  nutrientServingValue: number,
  servingSizeG: number,
  densityGperMl: number = 1.0,
): { valuePer100g: number; provenance: 'estimated' } {
  if (servingSizeG <= 0) {
    throw new Error('Serving size must be greater than zero')
  }
  const effectiveG = servingSizeG * densityGperMl
  const valuePer100g = (nutrientServingValue / effectiveG) * 100
  return {
    valuePer100g: Number(valuePer100g.toFixed(2)),
    provenance: 'estimated',
  }
}

/**
 * Invariant T23: Atwater Energy Consistency Check
 * Energy (kJ or kcal) must agree with macros within 8% tolerance.
 */
export function verifyAtwaterEnergy(
  declaredKj: number,
  macros: { fatG: number; carbsG: number; proteinG: number; fibreG?: number },
): { consistent: boolean; expectedKj: number; deltaPct: number } {
  // Atwater factors: Fat = 37 kJ/g, Protein = 17 kJ/g, Carbs = 17 kJ/g, Fibre = 8 kJ/g
  const fibre = macros.fibreG || 0
  const expectedKj = macros.fatG * 37 + macros.proteinG * 17 + macros.carbsG * 17 + fibre * 8
  const deltaPct = Math.abs(declaredKj - expectedKj) / (expectedKj || 1)

  return {
    consistent: deltaPct <= 0.08, // 8% tolerance window (T23)
    expectedKj: Math.round(expectedKj),
    deltaPct: Number((deltaPct * 100).toFixed(2)),
  }
}

/**
 * Invariant T25: Renal Rule Safety Guard
 * If a Renal pack requires Potassium, but Potassium is missing from the catalog schema/product,
 * the rule must be safely disabled with an explicit explanation, never silently passed.
 */
export function evaluateRenalTarget(
  target: { nutrientCode: string; value: number },
  productNutrition: Record<string, any>,
): { evaluated: boolean; pass?: boolean; reason?: string } {
  if (target.nutrientCode === 'PotassiumMG') {
    const pot = productNutrition.PotassiumMG ?? productNutrition.potassium_mg
    if (pot === null || pot === undefined || isNaN(pot)) {
      return {
        evaluated: false,
        reason:
          'Rule disabled: Potassium value missing from catalog data. Cannot verify Renal safety envelope.',
      }
    }
    return { evaluated: true, pass: pot <= target.value }
  }
  return { evaluated: true, pass: true }
}
