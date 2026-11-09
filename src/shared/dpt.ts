/**
 * NutriScore CAD Phase 7 — Dietary Profile Token (DPT) & Anonymisation Pipeline
 *
 * Reference: Blueprint §3.1–§3.6, Amendment A7
 *
 * Implements:
 * 1. Allowlisted constraint vocabulary (6 coarse dimensions).
 * 2. Device-only dimension dropping (protein, potassium, phosphorus).
 * 3. Step-up banding (rounding up to next standard step).
 * 4. Cohort gate (k >= 5) with automatic generalization.
 * 5. Ephemeral and pairwise shopper aliases (Browse: CSPRNG; Order: HMAC K_epoch).
 * 6. DPT assembly, Ed25519 signing via Signer, and commercial-side verification.
 */

import { createHash, createHmac, randomBytes, verify } from 'node:crypto'
import type { Signer } from './signer'

export const ALLOWLISTED_KEYS = [
  'sugars_g_100g_max',
  'carbs_g_100g_max',
  'sodium_mg_100g_max',
  'satfat_g_100g_max',
  'energy_kcal_100g_max',
  'fibre_g_100g_min',
] as const

export const DEVICE_ONLY_KEYS = [
  'protein_g_100g_max',
  'potassium_mg_100g_max',
  'phosphorus_mg_100g_max',
] as const

export const CONDITION_NAMED_PATTERNS = [
  /diabetic/i,
  /renal/i,
  /potassium/i,
  /hypertension/i,
  /cardiac/i,
  /cancer/i,
  /condition/i,
  /diagnosis/i,
  /disease/i,
]

export const BANDS: Record<string, number[]> = {
  sugars_g_100g_max: [5, 10, 15, 22.5, 30],
  carbs_g_100g_max: [10, 20, 30, 50, 75],
  sodium_mg_100g_max: [120, 300, 600, 900, 1500],
  satfat_g_100g_max: [1.5, 5, 10, 15],
  energy_kcal_100g_max: [100, 200, 350, 500],
  fibre_g_100g_min: [3, 6, 10],
}

export const GENERIC_HEALTHY_EATING_PROFILE: Record<string, number> = {
  sugars_g_100g_max: 22.5,
  carbs_g_100g_max: 50,
  sodium_mg_100g_max: 600,
  satfat_g_100g_max: 10,
}

export interface DptPayload {
  iss: string
  aud: string
  jti: string
  iat: number
  exp: number
  tnt: string
  shp: string
  cs: Record<string, number>
  pol: number
  cnf: { jkt: string }
}

function base64UrlEncode(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64UrlDecode(str: string): Buffer {
  const norm = str.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(norm, 'base64')
}

/**
 * Band a numeric constraint value upward to the next tier (or downward for minimums).
 */
export function bandValue(key: string, value: number): number {
  const tiers = BANDS[key]
  if (!tiers) return value

  if (key.endsWith('_min')) {
    // For minimums, band downward to the lowest safe threshold
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (value >= tiers[i]) return tiers[i]
    }
    return tiers[0]
  }

  // For maximums, round UP to next available band
  for (const tier of tiers) {
    if (value <= tier) return tier
  }
  return tiers[tiers.length - 1]
}

/**
 * Step 4: Scrub raw constraints.
 * 1. Checks for condition-named labels (throws error).
 * 2. Rejects unknown keys outside allowlist + device-only (throws error).
 * 3. Drops device-only dimensions.
 * 4. Bands allowlisted numeric bounds upward.
 */
export function scrubAndBandConstraints(raw: Record<string, unknown>): {
  banded: Record<string, number>
  droppedDeviceOnly: string[]
} {
  const droppedDeviceOnly: string[] = []
  const banded: Record<string, number> = {}

  for (const [k, v] of Object.entries(raw)) {
    // Check device-only dimensions FIRST → drop silently (no condition-name check needed)
    if ((DEVICE_ONLY_KEYS as readonly string[]).includes(k)) {
      droppedDeviceOnly.push(k)
      continue
    }

    // Check for condition-named labels (keys and string values)
    for (const pat of CONDITION_NAMED_PATTERNS) {
      if (pat.test(k) || (typeof v === 'string' && pat.test(v))) {
        throw new Error(`Condition-named tag or value forbidden in constraints: ${k}`)
      }
    }

    // Check allowlisted dimensions
    if ((ALLOWLISTED_KEYS as readonly string[]).includes(k)) {
      if (typeof v !== 'number' || isNaN(v)) {
        throw new Error(`Constraint value for ${k} must be a valid number, got ${typeof v}`)
      }
      banded[k] = bandValue(k, v)
      continue
    }

    // Any key not in allowlist or device-only must abort the mint
    throw new Error(`Unknown constraint key outside allowlist: ${k}`)
  }

  return { banded, droppedDeviceOnly }
}

/**
 * Compute canonical fingerprint (SHA-256) of a constraint dictionary.
 */
export function computeConstraintFingerprint(cs: Record<string, number>): string {
  const sortedKeys = Object.keys(cs).sort()
  const canonicalObj: Record<string, number> = {}
  for (const k of sortedKeys) canonicalObj[k] = cs[k]
  const jsonStr = JSON.stringify(canonicalObj)
  return createHash('sha256').update(jsonStr).digest('hex')
}

/**
 * Step 5: Cohort Gate (k >= 5).
 * If cohortCount < 5, generalise to avoid individual re-identification.
 */
export function applyCohortGate(
  banded: Record<string, number>,
  cohortCount: number,
  k = 5,
): { constraints: Record<string, number>; generalised: boolean } {
  if (cohortCount >= k) {
    return { constraints: banded, generalised: false }
  }

  // Generalisation: return the generic healthy eating profile
  return {
    constraints: { ...GENERIC_HEALTHY_EATING_PROFILE },
    generalised: true,
  }
}

/**
 * Step 6: Derive Shopper Alias.
 * Browse: 128-bit CSPRNG.
 * Order: HMAC-SHA256(kEpoch, patientId || ':order:' || epoch) truncated to 16 bytes.
 */
export function deriveShopperAlias(
  mode: 'browse' | 'order',
  patientId: string,
  epochKey?: Uint8Array,
  epoch?: string,
): string {
  if (mode === 'browse') {
    return base64UrlEncode(randomBytes(16))
  }

  if (!epochKey || !epoch) {
    throw new Error('Order mode requires epochKey and epoch identifier')
  }

  const hmac = createHmac('sha256', Buffer.from(epochKey))
    .update(Buffer.from(`${patientId}:order:${epoch}`, 'utf8'))
    .digest()

  return base64UrlEncode(hmac.subarray(0, 16))
}

/**
 * Derive opaque tenant routing alias: t_ + 8 base64url chars.
 */
export function deriveTenantAlias(tenantId: string, secret?: Uint8Array): string {
  const key = secret ? Buffer.from(secret) : Buffer.from('CAD_TENANT_ROUTING_SALT_V1', 'utf8')
  const h = createHmac('sha256', key)
    .update(Buffer.from(`tenant_alias:${tenantId}`, 'utf8'))
    .digest()
  return `t_${base64UrlEncode(h.subarray(0, 6))}`
}

/**
 * Assembles and signs a Dietary Profile Token (DPT).
 */
export function mintDpt(
  signer: Signer,
  params: {
    tenantId: string
    patientId: string
    constraints: Record<string, number>
    dpopJkt: string
    mode?: 'browse' | 'order'
    epochKey?: Uint8Array
    epoch?: string
    policyVersion?: number
    jti?: string
    iat?: number
    ttlSeconds?: number
  },
): { token: string; payload: DptPayload; jti: string; expiresAt: Date } {
  if (!signer.isAvailable()) {
    throw new Error('Signer is unavailable')
  }

  const now = params.iat ?? Math.floor(Date.now() / 1000)
  const ttl = params.ttlSeconds ?? 900 // 15-minute lifetime (Blueprint §3.4)
  const exp = now + ttl
  const jti = params.jti ?? randomBytes(16).toString('hex')
  const mode = params.mode ?? 'browse'
  const shp = deriveShopperAlias(mode, params.patientId, params.epochKey, params.epoch)
  const tnt = deriveTenantAlias(params.tenantId)

  const payload: DptPayload = {
    iss: 'https://exchange.nutriscore.co.ke',
    aud: 'ns-commercial',
    jti,
    iat: now,
    exp,
    tnt,
    shp,
    cs: params.constraints,
    pol: params.policyVersion ?? 4,
    cnf: { jkt: params.dpopJkt },
  }

  const header = {
    typ: 'JWT',
    alg: 'EdDSA',
    kid: signer.getKid(),
  }

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header), 'utf8'))
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signingInput = `${headerB64}.${payloadB64}`

  const sig = signer.sign(signingInput) as Uint8Array
  const sigB64 = base64UrlEncode(sig)

  return {
    token: `${signingInput}.${sigB64}`,
    payload,
    jti,
    expiresAt: new Date(exp * 1000),
  }
}

/**
 * Commercial-side verification of a DPT.
 */
export function verifyDpt(
  token: string,
  publicKey: any,
  dpopJkt?: string,
  revokedJtis?: Set<string>,
): { valid: boolean; payload?: DptPayload; error?: string } {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token: expected 3 parts' }
  }

  let header: { typ?: string; alg?: string; kid?: string }
  let payload: DptPayload

  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'))
    payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'))
  } catch (err) {
    return { valid: false, error: `Invalid JSON in token: ${(err as Error).message}` }
  }

  if (header.alg === 'none' || !header.alg) {
    return { valid: false, error: 'Algorithm "none" is rejected' }
  }

  if (payload.iss !== 'https://exchange.nutriscore.co.ke') {
    return { valid: false, error: `Untrusted issuer: ${payload.iss}` }
  }

  if (payload.aud !== 'ns-commercial') {
    return { valid: false, error: `Audience mismatch: ${payload.aud}` }
  }

  const now = Math.floor(Date.now() / 1000)
  if (payload.exp <= now) {
    return { valid: false, error: 'Token has expired' }
  }

  if (revokedJtis && revokedJtis.has(payload.jti)) {
    return { valid: false, error: 'Token jti has been revoked' }
  }

  // DPoP key binding check
  if (dpopJkt && payload.cnf?.jkt !== dpopJkt) {
    return {
      valid: false,
      error: `DPoP jkt mismatch: token cnf is ${payload.cnf?.jkt}, proof is ${dpopJkt}`,
    }
  }

  // Allowlist schema check on cs keys
  for (const k of Object.keys(payload.cs ?? {})) {
    if (!(ALLOWLISTED_KEYS as readonly string[]).includes(k as any)) {
      return { valid: false, error: `DPT contains forbidden or unknown constraint key: ${k}` }
    }
  }

  // Verify signature
  const signingInput = `${parts[0]}.${parts[1]}`
  const sig = base64UrlDecode(parts[2])

  try {
    const ok = verify(null, Buffer.from(signingInput, 'utf8'), publicKey, sig)
    if (!ok) return { valid: false, error: 'Invalid token signature' }
  } catch (err) {
    return { valid: false, error: `Signature verification error: ${(err as Error).message}` }
  }

  return { valid: true, payload }
}
