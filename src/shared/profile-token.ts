/**
 * @license SPDX-License-Identifier: Apache-2.0
 * src/shared/profile-token.ts — Clinical Dietary Profile Token Contract & Verifier.
 *
 * Reference: Blueprint §2.7, §3.1 (N1), §5.6 (WP-06, X-05, G-01, G-09, ADR-3)
 *
 * Responsibilities:
 *   1. Type-safe ProfileTokenClaims contract (constraints only; no condition names or diagnoses).
 *   2. Codex + EU allergen vocabulary (14 standard allergen codes).
 *   3. Mint-time linting (lintProfileToken) strictly enforcing CONDITION_NAMED_PATTERNS scrubbing.
 *   4. Asynchronous minting (mintProfileToken) awaiting Signer.sign() with EdDSA and 4 KB size cap.
 *   5. Robust verification (verifyProfileToken) checking cryptographic signature BEFORE claims,
 *      pinning alg: EdDSA, enforcing monotonic profile_ver, DPoP cnf.jkt binding, and jti revocation.
 */

import { CONDITION_NAMED_PATTERNS } from './dpt'
import type { Signer } from './signer'
import { getCryptoProvider, encodeBase64Url, decodeBase64Url, toUint8Array } from './crypto'

export type RetailerCode = 'carrefour' | 'naivas' | 'quickmart' | string

export type NutrientKey =
  | 'sugars_g_100g_max'
  | 'carbs_g_100g_max'
  | 'sodium_mg_100g_max'
  | 'satfat_g_100g_max'
  | 'energy_kcal_100g_max'
  | 'fibre_g_100g_min'
  | 'protein_g_100g_max'
  | 'potassium_mg_100g_max'
  | 'phosphorus_mg_100g_max'
  | string

export type AllergenCode =
  | 'gluten'
  | 'crustaceans'
  | 'eggs'
  | 'fish'
  | 'peanuts'
  | 'soybeans'
  | 'milk'
  | 'tree_nuts'
  | 'celery'
  | 'mustard'
  | 'sesame'
  | 'sulphites'
  | 'lupin'
  | 'molluscs'
  | string

export type ReasonClass =
  'CLINICAL_SAFETY' | 'NUTRITIONAL_POLICY' | 'ALLERGEN_EXCLUSION' | 'DIETARY_GOAL' | string

/**
 * Codex Alimentarius & EU mandatory allergen vocabulary (14 allergen categories).
 * Reference: Blueprint §3.1 (G-09).
 */
export const CODEX_EU_ALLERGENS: readonly AllergenCode[] = Object.freeze([
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'tree_nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
])

export interface ProfileTokenClaims {
  iss: string
  aud: `ext:${string}` | string // e.g. ext:carrefour, ext:naivas, ext:quickmart
  sub: string // Shopper_ID, pairwise per retailer and epoch
  iat: number
  nbf: number
  exp: number
  jti: string
  profile_ver: number // strictly increasing per patient
  cnf?: { jkt: string } // DPoP key thumbprint of the device
  ctr: {
    per_100g_flags: Array<{
      n: NutrientKey
      gt?: number
      lt?: number
      action: 'warn' | 'confirm' | 'hide'
    }>
    per_day?: Partial<Record<NutrientKey, number>> // exposure engine only; item evaluation ignores it
    exclude?: AllergenCode[] // hard exclusions
    nova4_cap_pct?: number
    household?: { adult_eq: number }
  }
  policy: {
    block_mode: 'warn_only' | 'confirm' | 'hide'
    min_conf: 'verified' | string
    reason_classes: ReasonClass[]
  }
  consent: {
    ref: string
    purposes: Array<'C1' | 'C2' | 'C3' | 'C4'>
  } // receipt id echoed by telemetry
}

export interface VerifyProfileTokenOptions {
  publicKey?: any
  jwks?: Array<{ kid: string; [k: string]: any }>
  keyResolver?: (kid?: string) => Promise<any> | any
  expectedAudience?: string // e.g. 'ext:carrefour'
  expectedIssuer?: string // default 'https://exchange.nutriscore.co.ke'
  storedProfileVer?: number
  revokedJtis?: Set<string> | string[]
  deviceJkt?: string
  clockSkewS?: number // default 60
  now?: number // unix timestamp in seconds
  allowLegacyTyp?: boolean
}

export interface ProfileTokenVerifyResult {
  valid: boolean
  code:
    | 'OK'
    | 'MALFORMED'
    | 'TOKEN_TOO_LARGE'
    | 'INVALID_ALGORITHM'
    | 'KEY_NOT_FOUND'
    | 'INVALID_SIGNATURE'
    | 'WRONG_ISSUER'
    | 'WRONG_AUDIENCE'
    | 'TOKEN_EXPIRED'
    | 'TOKEN_NOT_YET_VALID'
    | 'ROLLBACK_DETECTED'
    | 'TOKEN_REVOKED'
    | 'DPOP_BINDING_MISMATCH'
    | 'SAFETY_LINT_FAILED'
  claims?: ProfileTokenClaims
  error?: string
}

/**
 * Deeply lints profile token claims to ensure zero condition or diagnosis names
 * and strictly conformant structural constraints.
 */
export function lintProfileToken(claims: ProfileTokenClaims | Record<string, any>): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!claims || typeof claims !== 'object') {
    return { valid: false, errors: ['Claims payload must be a non-null object'] }
  }

  // Recursive scan for condition-named labels or biomarker patterns
  function scanForForbiddenPatterns(value: unknown, path: string): void {
    if (value === null || value === undefined) return
    if (typeof value === 'string') {
      for (const pat of CONDITION_NAMED_PATTERNS) {
        if (pat.test(value)) {
          errors.push(
            `Condition-named tag or value forbidden in profile token at ${path}: '${value}'`,
          )
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, idx) => scanForForbiddenPatterns(item, `${path}[${idx}]`))
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        for (const pat of CONDITION_NAMED_PATTERNS) {
          if (pat.test(k)) {
            errors.push(`Condition-named key forbidden in profile token at ${path}.${k}`)
          }
        }
        scanForForbiddenPatterns(v, `${path}.${k}`)
      }
    }
  }

  scanForForbiddenPatterns(claims, 'claims')

  // Validate audience
  if (typeof claims.aud !== 'string' || !claims.aud.startsWith('ext:')) {
    errors.push(`Audience must be prefixed with 'ext:' (e.g. ext:carrefour), got '${claims.aud}'`)
  }

  // Validate monotonic profile_ver
  if (
    typeof claims.profile_ver !== 'number' ||
    !Number.isInteger(claims.profile_ver) ||
    claims.profile_ver < 1
  ) {
    errors.push(`profile_ver must be a positive integer, got '${claims.profile_ver}'`)
  }

  // Validate consent
  if (!claims.consent || typeof claims.consent !== 'object') {
    errors.push('claims.consent object is required')
  } else {
    if (typeof claims.consent.ref !== 'string' || claims.consent.ref.length === 0) {
      errors.push('claims.consent.ref must be a non-empty string')
    }
    if (!Array.isArray(claims.consent.purposes) || claims.consent.purposes.length === 0) {
      errors.push('claims.consent.purposes must be a non-empty array')
    } else {
      const validPurposes = new Set(['C1', 'C2', 'C3', 'C4'])
      for (const p of claims.consent.purposes) {
        if (!validPurposes.has(p)) {
          errors.push(`Invalid consent purpose '${p}'; must be one of C1, C2, C3, C4`)
        }
      }
    }
  }

  // Validate policy block_mode & min_conf
  if (!claims.policy || typeof claims.policy !== 'object') {
    errors.push('claims.policy object is required')
  } else {
    const validModes = new Set(['warn_only', 'confirm', 'hide'])
    if (!validModes.has(claims.policy.block_mode)) {
      errors.push(
        `Invalid policy.block_mode '${claims.policy.block_mode}'; must be warn_only, confirm, or hide`,
      )
    }
    if (claims.policy.min_conf !== 'verified') {
      errors.push(
        `Invalid policy.min_conf '${claims.policy.min_conf}'; must be 'verified' under fail-closed safety`,
      )
    }
  }

  // Validate ctr
  if (!claims.ctr || typeof claims.ctr !== 'object') {
    errors.push('claims.ctr object is required')
  } else {
    if (Array.isArray(claims.ctr.per_100g_flags)) {
      const validActions = new Set(['warn', 'confirm', 'hide'])
      for (let i = 0; i < claims.ctr.per_100g_flags.length; i++) {
        const flag = claims.ctr.per_100g_flags[i]
        if (!flag || !validActions.has(flag.action)) {
          errors.push(
            `Invalid per_100g_flags action at index ${i}: '${flag?.action}'; must be warn, confirm, or hide`,
          )
        }
      }
    }
  }

  // Validate timestamps
  if (
    typeof claims.exp === 'number' &&
    typeof claims.nbf === 'number' &&
    claims.exp <= claims.nbf
  ) {
    errors.push(`exp (${claims.exp}) must be strictly greater than nbf (${claims.nbf})`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Asynchronously mints and signs a Profile Token using an Ed25519 signer.
 * Enforces mint-time linting, EdDSA algorithm, and a 4 KB token size ceiling.
 */
export async function mintProfileToken(
  signer: Signer,
  claims: ProfileTokenClaims,
  options?: {
    kid?: string
    typ?: 'ns-profile+jwt' | 'JWT'
  },
): Promise<{ token: string; claims: ProfileTokenClaims; jti: string; expiresAt: Date }> {
  if (!signer.isAvailable()) {
    throw new Error('Signer is unavailable')
  }

  // Lint before minting
  const lint = lintProfileToken(claims)
  if (!lint.valid) {
    throw new Error(`Profile token lint failed: ${lint.errors.join('; ')}`)
  }

  const header = {
    typ: options?.typ ?? 'ns-profile+jwt',
    alg: 'EdDSA',
    kid: options?.kid ?? signer.getKid(),
  }

  const headerB64 = encodeBase64Url(new TextEncoder().encode(JSON.stringify(header)))
  const payloadB64 = encodeBase64Url(new TextEncoder().encode(JSON.stringify(claims)))
  const signingInput = `${headerB64}.${payloadB64}`

  const rawSig = await signer.sign(signingInput)
  const sigBytes = toUint8Array(rawSig)
  const sigB64 = encodeBase64Url(sigBytes)
  const token = `${signingInput}.${sigB64}`

  if (token.length > 4096) {
    throw new Error(`Profile token exceeds 4 KB size limit (${token.length} bytes > 4096 bytes)`)
  }

  return {
    token,
    claims,
    jti: claims.jti,
    expiresAt: new Date(claims.exp * 1000),
  }
}

/**
 * Cryptographically verifies a Profile Token.
 * Sequence of checks (Blueprint §2.7):
 *  1. Size cap (<= 4096 bytes).
 *  2. Header checks: typ ('ns-profile+jwt' or 'JWT'), alg ('EdDSA' pinned).
 *  3. Key resolution by kid.
 *  4. Cryptographic signature check BEFORE claims inspection.
 *  5. Claim checks: iss, aud (ext:<retailer>), nbf, exp with clock skew.
 *  6. Monotonic profile_ver check against stored state (anti-rollback).
 *  7. Revocation denylist check on jti.
 *  8. DPoP cnf.jkt binding check when device key is present.
 *  9. Defense-in-depth safety lint check.
 */
export async function verifyProfileToken(
  token: string,
  options: VerifyProfileTokenOptions = {},
): Promise<ProfileTokenVerifyResult> {
  // 1. Size ceiling check
  if (token.length > 4096) {
    return {
      valid: false,
      code: 'TOKEN_TOO_LARGE',
      error: `Token size ${token.length} exceeds 4096-byte limit`,
    }
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    return {
      valid: false,
      code: 'MALFORMED',
      error: 'Malformed compact JWT: expected 3 dot-delimited segments',
    }
  }

  let header: { typ?: string; alg?: string; kid?: string }
  let claims: ProfileTokenClaims

  try {
    const headerStr = new TextDecoder().decode(decodeBase64Url(parts[0]))
    const claimsStr = new TextDecoder().decode(decodeBase64Url(parts[1]))
    header = JSON.parse(headerStr)
    claims = JSON.parse(claimsStr)
  } catch (err) {
    return {
      valid: false,
      code: 'MALFORMED',
      error: `Failed to parse token JSON: ${(err as Error).message}`,
    }
  }

  // 2. Algorithm & typ check
  if (header.alg !== 'EdDSA') {
    return {
      valid: false,
      code: 'INVALID_ALGORITHM',
      error: `Algorithm rejected: expected 'EdDSA', got '${header.alg}'`,
    }
  }

  const allowedTyps = options.allowLegacyTyp
    ? ['ns-profile+jwt', 'JWT', 'ns-dpt+jwt']
    : ['ns-profile+jwt', 'JWT']
  if (!header.typ || !allowedTyps.includes(header.typ)) {
    return {
      valid: false,
      code: 'MALFORMED',
      error: `Invalid token typ: expected 'ns-profile+jwt' or 'JWT', got '${header.typ}'`,
    }
  }

  // 3. Key resolution
  let key = options.publicKey
  if (!key && options.jwks) {
    const matched = options.jwks.find((k) => k.kid === header.kid)
    if (matched) key = matched
  }
  if (!key && options.keyResolver) {
    key = await options.keyResolver(header.kid)
  }

  if (!key) {
    return {
      valid: false,
      code: 'KEY_NOT_FOUND',
      error: `Signing key not found for kid: '${header.kid}'`,
    }
  }

  // 4. Cryptographic signature check FIRST
  const signingInput = `${parts[0]}.${parts[1]}`
  const sigBytes = decodeBase64Url(parts[2])

  try {
    const ok = await getCryptoProvider().verifyEd25519(key, signingInput, sigBytes)
    if (!ok) {
      return {
        valid: false,
        code: 'INVALID_SIGNATURE',
        error: 'Cryptographic signature verification failed',
      }
    }
  } catch (err) {
    return {
      valid: false,
      code: 'INVALID_SIGNATURE',
      error: `Signature verification error: ${(err as Error).message}`,
    }
  }

  // 5. Issuer check
  const expectedIssuer = options.expectedIssuer ?? 'https://exchange.nutriscore.co.ke'
  if (claims.iss !== expectedIssuer) {
    return {
      valid: false,
      code: 'WRONG_ISSUER',
      error: `Untrusted issuer '${claims.iss}'; expected '${expectedIssuer}'`,
    }
  }

  // 6. Audience check
  if (options.expectedAudience && claims.aud !== options.expectedAudience) {
    return {
      valid: false,
      code: 'WRONG_AUDIENCE',
      error: `Audience mismatch: expected '${options.expectedAudience}', got '${claims.aud}'`,
    }
  }
  if (!claims.aud || !claims.aud.startsWith('ext:')) {
    return {
      valid: false,
      code: 'WRONG_AUDIENCE',
      error: `Audience '${claims.aud}' must be prefixed with 'ext:'`,
    }
  }

  // 7. Temporal checks (nbf, exp with clock skew)
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const skew = options.clockSkewS ?? 60

  if (claims.nbf && now < claims.nbf - skew) {
    return {
      valid: false,
      code: 'TOKEN_NOT_YET_VALID',
      error: `Token not valid before nbf (${claims.nbf}) with ${skew}s skew (now: ${now})`,
    }
  }

  if (claims.exp && now > claims.exp + skew) {
    return {
      valid: false,
      code: 'TOKEN_EXPIRED',
      error: `Token expired at exp (${claims.exp}) with ${skew}s skew (now: ${now})`,
    }
  }

  // 8. Monotonic profile_ver check (Anti-rollback)
  if (
    options.storedProfileVer !== undefined &&
    claims.profile_ver !== undefined &&
    claims.profile_ver < options.storedProfileVer
  ) {
    return {
      valid: false,
      code: 'ROLLBACK_DETECTED',
      error: `Rollback rejected: token profile_ver ${claims.profile_ver} < stored profile_ver ${options.storedProfileVer}`,
    }
  }

  // 9. JTI Revocation denylist check
  if (options.revokedJtis) {
    const isRevoked =
      options.revokedJtis instanceof Set
        ? options.revokedJtis.has(claims.jti)
        : options.revokedJtis.includes(claims.jti)
    if (isRevoked) {
      return {
        valid: false,
        code: 'TOKEN_REVOKED',
        error: `Token jti '${claims.jti}' has been revoked`,
      }
    }
  }

  // 10. DPoP device key thumbprint binding check
  if (claims.cnf?.jkt && options.deviceJkt && claims.cnf.jkt !== options.deviceJkt) {
    return {
      valid: false,
      code: 'DPOP_BINDING_MISMATCH',
      error: `DPoP jkt binding mismatch: token requires '${claims.cnf.jkt}', device provided '${options.deviceJkt}'`,
    }
  }

  // 11. Defense-in-depth safety lint check on verified claims
  const lint = lintProfileToken(claims)
  if (!lint.valid) {
    return {
      valid: false,
      code: 'SAFETY_LINT_FAILED',
      error: `Profile token safety violation: ${lint.errors.join('; ')}`,
    }
  }

  return {
    valid: true,
    code: 'OK',
    claims,
  }
}
