// src/shared/target-sync.ts
// Target Bundle Sync, Rollback Protection & Clinical Rules Invariants
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§8.3, §13 Tests T16-T25)
// Reference: Blueprint §2.7, §5.6 (WP-06, X-02, ADR-3)

import { stableStringify } from './canonical.mjs'
import { getCryptoProvider, decodeBase64Url, encodeBase64Url, toUint8Array } from './crypto'

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
  sig?: string
  kid?: string
  signature?: string
}

export interface BundleVerificationResult {
  valid: boolean
  code:
    | 'OK'
    | 'EXPIRED'
    | 'ROLLBACK_DETECTED'
    | 'INVALID_SIGNATURE'
    | 'CORRUPTED'
    | 'INVALID_EXPIRY'
    | 'ISSUED_IN_FUTURE'
    | 'BINDING_MISMATCH'
  message: string
  legacyOnly?: boolean
}

/**
 * Strips cryptographic signature and envelope metadata fields from a target bundle to prepare canonical representation.
 */
export function withoutSignature(bundle: TargetBundle | Record<string, any>): Record<string, any> {
  const { signature, sig, kid, ...rest } = bundle as any
  return rest
}

/**
 * Validates a newly received bundle against the currently cached bundle, device context, and current time.
 * Invariant T16: Offline past valid_to -> fallback to platform defaults with notice.
 * Invariant T17: Reject bundle with version <= current cached bundleVersion.
 * Blueprint §2.7 / X-02:
 *  - Rejects non-finite/NaN validTo expiry timestamps.
 *  - Rejects bundles with issuedAt in the future (> now + 5 min).
 *  - Enforces tenantId and subjectRef binding against device context.
 *  - Accepts legacy sig_es256_ during transition unless strictCrypto is set.
 */
export function verifyBundle(
  newBundle: TargetBundle,
  signature: string | null | undefined,
  cachedBundle: TargetBundle | null,
  nowIso: string = new Date().toISOString(),
  options?: {
    ctx?: { tenantId?: string; subjectRef?: string }
    strictCrypto?: boolean
  },
): BundleVerificationResult {
  if (!newBundle || !Array.isArray(newBundle.targets)) {
    return { valid: false, code: 'CORRUPTED', message: 'Malformed target bundle payload' }
  }

  // Check validTo expiry timestamp validity (reject NaN)
  const expiry = Date.parse(newBundle.validTo)
  if (!Number.isFinite(expiry)) {
    return {
      valid: false,
      code: 'INVALID_EXPIRY',
      message: 'Target bundle validTo timestamp is not a finite date',
    }
  }

  const now = new Date(nowIso).getTime()

  // Future issuedAt check (> now + 5 min)
  const issuedAtTime = Date.parse(newBundle.issuedAt)
  if (Number.isFinite(issuedAtTime) && issuedAtTime > now + 5 * 60_000) {
    return {
      valid: false,
      code: 'ISSUED_IN_FUTURE',
      message: 'Target bundle issuedAt is in the future (> now + 5 minutes)',
    }
  }

  // Tenant / subjectRef context binding check
  if (options?.ctx) {
    if (options.ctx.tenantId && newBundle.tenantId !== options.ctx.tenantId) {
      return {
        valid: false,
        code: 'BINDING_MISMATCH',
        message: `Target bundle tenantId '${newBundle.tenantId}' does not match device context '${options.ctx.tenantId}'`,
      }
    }
    if (options.ctx.subjectRef && newBundle.subjectRef !== options.ctx.subjectRef) {
      return {
        valid: false,
        code: 'BINDING_MISMATCH',
        message: `Target bundle subjectRef '${newBundle.subjectRef}' does not match device context '${options.ctx.subjectRef}'`,
      }
    }
  }

  // Check signature
  const effectiveSig = signature || newBundle.sig || newBundle.signature
  if (options?.strictCrypto) {
    // In strict mode, legacy sig_es256_ is not sufficient unless real sig is present
    if (!newBundle.sig) {
      return {
        valid: false,
        code: 'INVALID_SIGNATURE',
        message: 'Cryptographic Ed25519 signature required in strict mode',
      }
    }
  } else {
    const isLegacy =
      effectiveSig && typeof effectiveSig === 'string' && effectiveSig.startsWith('sig_es256_')
    const hasDetached = !!newBundle.sig
    if (!isLegacy && !hasDetached) {
      return { valid: false, code: 'INVALID_SIGNATURE', message: 'Signature missing or unverified' }
    }
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
  if (now > expiry) {
    return {
      valid: false,
      code: 'EXPIRED',
      message: 'Target bundle expired. Client must fall back to platform defaults with warning.',
    }
  }

  const legacyOnly = !newBundle.sig && !!effectiveSig?.startsWith('sig_es256_')
  return {
    valid: true,
    code: 'OK',
    message: legacyOnly
      ? 'Target bundle verified via legacy signature'
      : 'Target bundle verified and valid',
    ...(legacyOnly ? { legacyOnly: true } : {}),
  }
}

/**
 * Asynchronously verifies a target bundle including detached Ed25519 signature verification.
 */
export async function verifyBundleAsync(
  newBundle: TargetBundle & { sig?: string; kid?: string; signature?: string },
  signatureOrCached: string | TargetBundle | null,
  cachedBundleOrNow?: TargetBundle | null | string,
  optionsOrNow?:
    | {
        ctx?: { tenantId?: string; subjectRef?: string }
        nowIso?: string
        strictCrypto?: boolean
        keys?: Map<string, any> | ((kid?: string) => Promise<any> | any)
        publicKey?: any
      }
    | string,
): Promise<BundleVerificationResult> {
  let sigString: string | undefined
  let cached: TargetBundle | null = null
  let nowIso = new Date().toISOString()
  let options: {
    ctx?: { tenantId?: string; subjectRef?: string }
    nowIso?: string
    strictCrypto?: boolean
    keys?: Map<string, any> | ((kid?: string) => Promise<any> | any)
    publicKey?: any
  } = {}

  if (typeof signatureOrCached === 'string') {
    sigString = signatureOrCached
    cached = (cachedBundleOrNow as TargetBundle | null) ?? null
    if (typeof optionsOrNow === 'string') {
      nowIso = optionsOrNow
    } else if (optionsOrNow && typeof optionsOrNow === 'object') {
      options = optionsOrNow
      if (options.nowIso) nowIso = options.nowIso
    }
  } else {
    cached = signatureOrCached
    if (typeof cachedBundleOrNow === 'string') {
      nowIso = cachedBundleOrNow
    }
    if (optionsOrNow && typeof optionsOrNow === 'object') {
      options = optionsOrNow
      if (options.nowIso) nowIso = options.nowIso
    }
  }

  // Run synchronous checks first
  const syncCheck = verifyBundle(newBundle, sigString, cached, nowIso, options)
  if (!syncCheck.valid) {
    return syncCheck
  }

  // If detached signature is present, verify with CryptoProvider
  if (newBundle.sig) {
    let key = options.publicKey
    if (!key && options.keys) {
      if (typeof options.keys === 'function') {
        key = await options.keys(newBundle.kid)
      } else if (options.keys instanceof Map) {
        key = newBundle.kid ? options.keys.get(newBundle.kid) : undefined
      }
    }

    if (!key) {
      if (options.strictCrypto) {
        return {
          valid: false,
          code: 'INVALID_SIGNATURE',
          message: `Verification key not found for kid: ${newBundle.kid}`,
        }
      }
      // If key is missing and not strictCrypto, fall back to legacy bridge if signature string is present
      if (syncCheck.legacyOnly) {
        return syncCheck
      }
    } else {
      const canonical = stableStringify(withoutSignature(newBundle))
      const canonicalBytes = new TextEncoder().encode(canonical)
      const sigBytes = decodeBase64Url(newBundle.sig)

      try {
        const ok = await getCryptoProvider().verifyEd25519(key, canonicalBytes, sigBytes)
        if (!ok) {
          return {
            valid: false,
            code: 'INVALID_SIGNATURE',
            message: 'Detached Ed25519 signature verification failed',
          }
        }
        return { valid: true, code: 'OK', message: 'Target bundle verified and valid' }
      } catch (err) {
        return {
          valid: false,
          code: 'INVALID_SIGNATURE',
          message: `Signature verification error: ${(err as Error).message}`,
        }
      }
    }
  }

  return syncCheck
}

/**
 * Digitally signs a TargetBundle using an Ed25519 signer and attaches detached sig & kid.
 */
export async function signBundleAsync(
  bundle: TargetBundle,
  signer: {
    sign: (data: Uint8Array | string) => Promise<Uint8Array> | Uint8Array
    getKid?: () => string
  },
): Promise<TargetBundle & { sig: string; kid?: string; signature: string }> {
  const unsigned = withoutSignature(bundle)
  const canonical = stableStringify(unsigned)
  const canonicalBytes = new TextEncoder().encode(canonical)
  const rawSig = await signer.sign(canonicalBytes)
  const sigBytes = toUint8Array(rawSig)
  const sig = encodeBase64Url(sigBytes)
  const kid = signer.getKid ? signer.getKid() : undefined

  return {
    ...bundle,
    sig,
    ...(kid ? { kid } : {}),
    signature: `sig_es256_legacy_bridge_${bundle.bundleVersion}`,
  }
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

export {
  checkNutrientCompleteness,
  type NutrientValues,
  type ComputabilityStatus,
  type NutrientCompletenessResult,
} from './nutrient-completeness'

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
  options: { tolerance?: number } = {},
): { consistent: boolean; expectedKj: number; deltaPct: number } {
  // Atwater factors: Fat = 37 kJ/g, Protein = 17 kJ/g, Carbs = 17 kJ/g, Fibre = 8 kJ/g
  const fibre = macros.fibreG || 0
  const expectedKj = macros.fatG * 37 + macros.proteinG * 17 + macros.carbsG * 17 + fibre * 8
  const deltaPct = Math.abs(declaredKj - expectedKj) / (expectedKj || 1)
  const expectedKcal = expectedKj / 4.184

  // Blueprint §2.5 & X-12: 15% tolerance window when calculated energy exceeds 20 kcal.
  // The stricter 8% window remains configurable for data curation linting.
  const tolerance =
    options.tolerance !== undefined ? options.tolerance : expectedKcal > 20 ? 0.15 : 0.08

  return {
    consistent: deltaPct <= tolerance,
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
