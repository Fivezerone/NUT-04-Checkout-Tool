import { CLAIM_SCHEMA_VERSION } from './constants'
import { getCryptoProvider, decodeBase64Url, encodeBase64Url } from './crypto'

export const CAD_ROLES = [
  'super_admin',
  'tenant_admin',
  'writing_clinician',
  'viewing_dietician',
  'compliance_auditor',
  'commercial_stakeholder',
  'patient',
] as const

export type CadRole = (typeof CAD_ROLES)[number]
export type AuditorScope = 'tenant' | 'platform'

export type AcrLevel = 0 | 1 | 2 | 3

export function parseAcrLevel(raw: unknown): AcrLevel {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 3) {
    return raw as AcrLevel
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase()
    if (trimmed === '3' || trimmed === 'loa3' || trimmed === 'aal3') return 3
    if (trimmed === '2' || trimmed === 'loa2' || trimmed === 'aal2') return 2
    if (trimmed === '1' || trimmed === 'loa1' || trimmed === 'aal1') return 1
    if (trimmed === '0' || trimmed === 'loa0') return 0
  }
  return 0
}

const verifiedSymbol = Symbol('nutriscore.claims.verified')

/**
 * Branded type representing claims that have been cryptographically verified
 * against trusted JWKS, checking signature, expiration, issuer, and audience.
 * Unverified claims cannot satisfy this type.
 */
export type VerifiedClaims = CanonicalClaims & { readonly [verifiedSymbol]: true }

/**
 * Checks if a claims object has been cryptographically verified.
 */
export function isVerifiedClaims(claims: unknown): claims is VerifiedClaims {
  return typeof claims === 'object' && claims !== null && (claims as any)[verifiedSymbol] === true
}

export function markClaimsVerified(claims: CanonicalClaims): VerifiedClaims {
  return Object.freeze({
    ...claims,
    acrLevel: claims.acrLevel ?? (claims.acr ? parseAcrLevel(claims.acr) : undefined),
    [verifiedSymbol]: true,
  }) as VerifiedClaims
}

/** The canonical application-facing representation of access-token claims. */
export interface CanonicalClaims {
  sub: string
  sid: string
  tenantId: string | null
  appRole: CadRole
  licOk: boolean
  auditorScope?: AuditorScope
  acr?: string
  acrLevel?: AcrLevel
  amr?: string[]
  iss?: string
  aud?: string | string[]
  exp?: number
  nbf?: number
  iat?: number
  jti?: string
  ver: number
}

type RawClaims = Record<string, unknown>

function isRecord(value: unknown): value is RawClaims {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCadRole(value: unknown): value is CadRole {
  return typeof value === 'string' && (CAD_ROLES as readonly string[]).includes(value)
}

function decodeB64UrlToString(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    if (typeof atob === 'function') return atob(normalized)
    const BufferCtor = (
      globalThis as {
        Buffer?: { from: (s: string, e: string) => { toString: (e: string) => string } }
      }
    ).Buffer
    return BufferCtor?.from(normalized, 'base64').toString('utf8') ?? null
  } catch {
    return null
  }
}

/**
 * Maps verified or raw OIDC claim names to the canonical contract.
 * Do not read raw token payload fields outside this module.
 */
export function canonicalizeClaims(raw: unknown): CanonicalClaims | null {
  if (!isRecord(raw) || typeof raw.sub !== 'string' || !isCadRole(raw.app_role)) return null

  const sid =
    typeof raw.sid === 'string'
      ? raw.sid
      : typeof raw.session_id === 'string'
        ? raw.session_id
        : null
  if (!sid) return null

  const tenantId = typeof raw.tenant_id === 'string' ? raw.tenant_id : null
  const auditorScope =
    raw.auditor_scope === 'tenant' || raw.auditor_scope === 'platform'
      ? raw.auditor_scope
      : undefined
  if (raw.app_role === 'compliance_auditor' ? !auditorScope : Boolean(auditorScope)) return null

  const acrRaw =
    typeof raw.acr === 'string'
      ? raw.acr
      : typeof raw.aal === 'string'
        ? raw.aal
        : typeof raw.acr === 'number'
          ? String(raw.acr)
          : undefined

  const acrLevel = acrRaw !== undefined ? parseAcrLevel(acrRaw) : undefined
  const amr = Array.isArray(raw.amr)
    ? raw.amr.filter((x): x is string => typeof x === 'string')
    : undefined
  const iss = typeof raw.iss === 'string' ? raw.iss : undefined
  const aud =
    typeof raw.aud === 'string'
      ? raw.aud
      : Array.isArray(raw.aud)
        ? raw.aud.filter((x): x is string => typeof x === 'string')
        : undefined
  const exp = typeof raw.exp === 'number' ? raw.exp : undefined
  const nbf = typeof raw.nbf === 'number' ? raw.nbf : undefined
  const iat = typeof raw.iat === 'number' ? raw.iat : undefined
  const jti = typeof raw.jti === 'string' ? raw.jti : undefined

  const result: CanonicalClaims = {
    sub: raw.sub,
    sid,
    tenantId,
    appRole: raw.app_role,
    licOk: raw.lic_ok === true,
    ver: typeof raw.ver === 'number' ? raw.ver : CLAIM_SCHEMA_VERSION,
  }

  if (auditorScope !== undefined) result.auditorScope = auditorScope
  if (acrRaw !== undefined) result.acr = acrRaw
  if (amr !== undefined) result.amr = amr
  if (iss !== undefined) result.iss = iss
  if (aud !== undefined) result.aud = aud
  if (exp !== undefined) result.exp = exp
  if (nbf !== undefined) result.nbf = nbf
  if (iat !== undefined) result.iat = iat
  if (jti !== undefined) result.jti = jti

  Object.defineProperty(result, 'acrLevel', {
    get() {
      return acrRaw !== undefined ? parseAcrLevel(acrRaw) : undefined
    },
    enumerable: false,
    configurable: true,
  })

  return result
}

/**
 * LEGACY(ns-p4): Cosmetic UI decoding only.
 * Banned in bff/ and server functions. Does NOT verify signature, expiration, or issuer.
 */
export function unsafeDecodeClaimsForUi(
  accessToken: string | null | undefined,
): CanonicalClaims | null {
  if (!accessToken) return null
  const segments = accessToken.split('.')
  if (segments.length !== 3) return null
  const decoded = decodeB64UrlToString(segments[1])
  if (!decoded) return null
  try {
    return canonicalizeClaims(JSON.parse(decoded))
  } catch {
    return null
  }
}

/** Legacy alias retained for backwards compatibility with existing UI callers. */
export const claimsFromAccessToken = unsafeDecodeClaimsForUi

/** Legacy helper: extracts unverified claims from Authorization header. */
export function claimsFromRequest(request: Request): CanonicalClaims | null {
  const authorization = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  return unsafeDecodeClaimsForUi(authorization.slice('Bearer '.length).trim())
}

// ── JWT Signature & Claims Verification (X-01, ADR-4) ───────────────────────

export class ClaimsVerificationError extends Error {
  readonly code:
    | 'INVALID_JWT_FORMAT'
    | 'INVALID_ALGORITHM'
    | 'UNKNOWN_KID'
    | 'KEY_NOT_FOUND'
    | 'INVALID_SIGNATURE'
    | 'TOKEN_EXPIRED'
    | 'TOKEN_NOT_YET_VALID'
    | 'INVALID_ISSUER'
    | 'INVALID_AUDIENCE'
    | 'MALFORMED_CLAIMS'

  constructor(code: ClaimsVerificationError['code'], message?: string) {
    super(message || code)
    this.name = 'ClaimsVerificationError'
    this.code = code
  }
}

export type JwksKeySource =
  | { keys: Array<Record<string, unknown>> }
  | Array<Record<string, unknown>>
  | Record<string, unknown>
  | ((kid?: string, alg?: string) => Promise<Record<string, unknown> | null>)

export interface VerifyClaimsOptions {
  expectedIss?: string
  expectedAud?: string | string[]
  clockToleranceSec?: number
  nowSec?: number
}

interface JwtHeader {
  alg: string
  kid?: string
  typ?: string
  [key: string]: unknown
}

function findJwkInSource(
  source: JwksKeySource,
  kid?: string,
  alg?: string,
): Promise<Record<string, unknown> | null> | Record<string, unknown> | null {
  if (typeof source === 'function') {
    return source(kid, alg)
  }

  const keys: Array<Record<string, unknown>> = Array.isArray(source)
    ? source
    : Array.isArray((source as any).keys)
      ? (source as any).keys
      : [source as Record<string, unknown>]

  if (kid) {
    const match = keys.find((k) => k.kid === kid)
    return match ?? null
  }

  // If no kid specified, find matching alg or return single key
  if (keys.length === 1) {
    return keys[0]
  }

  if (alg) {
    const algMatch = keys.find((k) => !k.alg || k.alg === alg)
    if (algMatch) return algMatch
  }

  return null
}

async function verifyJwtSignature(
  signingInput: string,
  signatureBytes: Uint8Array,
  header: JwtHeader,
  jwk: Record<string, unknown>,
): Promise<boolean> {
  const alg = header.alg

  if (alg === 'EdDSA' || jwk.crv === 'Ed25519') {
    const provider = getCryptoProvider()
    return provider.verifyEd25519(jwk, signingInput, signatureBytes)
  }

  // Fallback to WebCrypto / Node crypto for ES256, RS256
  const subtle =
    typeof crypto !== 'undefined' && crypto.subtle
      ? crypto.subtle
      : typeof globalThis !== 'undefined' && globalThis.crypto?.subtle
        ? globalThis.crypto.subtle
        : null

  if (subtle) {
    let importAlgorithm: RsaHashedImportParams | EcKeyImportParams
    let verifyAlgorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams

    if (alg === 'ES256') {
      importAlgorithm = { name: 'ECDSA', namedCurve: 'P-256' }
      verifyAlgorithm = { name: 'ECDSA', hash: { name: 'SHA-256' } }
    } else if (alg === 'RS256') {
      importAlgorithm = { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }
      verifyAlgorithm = { name: 'RSASSA-PKCS1-v1_5' }
    } else {
      throw new ClaimsVerificationError(
        'INVALID_ALGORITHM',
        `Unsupported signature algorithm: ${alg}`,
      )
    }

    try {
      const cryptoKey = await subtle.importKey('jwk', jwk, importAlgorithm, false, ['verify'])
      const inputBytes = new TextEncoder().encode(signingInput)
      return await subtle.verify(
        verifyAlgorithm,
        cryptoKey,
        signatureBytes as unknown as BufferSource,
        inputBytes,
      )
    } catch (err: any) {
      if (err instanceof ClaimsVerificationError) throw err
      return false
    }
  }

  // If in pure Node without subtle crypto
  try {
    const nodeCrypto = await import('node:crypto')
    const keyObject = nodeCrypto.createPublicKey({ key: jwk as any, format: 'jwk' })
    let nodeAlg: string | null = null
    if (alg === 'RS256') nodeAlg = 'RSA-SHA256'
    else if (alg === 'ES256') nodeAlg = 'SHA256'
    return nodeCrypto.verify(nodeAlg, Buffer.from(signingInput, 'utf8'), keyObject, signatureBytes)
  } catch {
    return false
  }
}

/**
 * Cryptographically verifies an access token JWT against trusted JWKS,
 * validates standard claims (exp, nbf, iss, aud), and constructs a branded VerifiedClaims.
 *
 * This is the ONLY trusted constructor of server-side claims (X-01).
 */
export async function claimsFromVerifiedToken(
  jwt: string,
  jwks: JwksKeySource,
  options: VerifyClaimsOptions = {},
): Promise<VerifiedClaims> {
  if (!jwt || typeof jwt !== 'string') {
    throw new ClaimsVerificationError('INVALID_JWT_FORMAT', 'JWT must be a non-empty string')
  }

  const parts = jwt.split('.')
  if (parts.length !== 3) {
    throw new ClaimsVerificationError(
      'INVALID_JWT_FORMAT',
      `JWT must contain 3 segments, found ${parts.length}`,
    )
  }

  const [headerB64, payloadB64, signatureB64] = parts
  const signingInput = `${headerB64}.${payloadB64}`

  // 1. Decode and validate header
  const headerStr = decodeB64UrlToString(headerB64)
  if (!headerStr) {
    throw new ClaimsVerificationError('INVALID_JWT_FORMAT', 'Failed to base64url-decode JWT header')
  }

  let header: JwtHeader
  try {
    header = JSON.parse(headerStr)
  } catch {
    throw new ClaimsVerificationError('INVALID_JWT_FORMAT', 'Malformed JSON in JWT header')
  }

  if (!header.alg || header.alg.toLowerCase() === 'none') {
    throw new ClaimsVerificationError(
      'INVALID_ALGORITHM',
      'JWT algorithm "none" is prohibited (fail-closed)',
    )
  }

  // 2. Decode and validate payload
  const payloadStr = decodeB64UrlToString(payloadB64)
  if (!payloadStr) {
    throw new ClaimsVerificationError(
      'INVALID_JWT_FORMAT',
      'Failed to base64url-decode JWT payload',
    )
  }

  let rawPayload: Record<string, unknown>
  try {
    rawPayload = JSON.parse(payloadStr)
  } catch {
    throw new ClaimsVerificationError('INVALID_JWT_FORMAT', 'Malformed JSON in JWT payload')
  }

  // 3. Resolve key from JWKS
  const jwk = await findJwkInSource(jwks, header.kid, header.alg)
  if (!jwk) {
    if (header.kid) {
      throw new ClaimsVerificationError(
        'UNKNOWN_KID',
        `Key with kid "${header.kid}" not found in JWKS`,
      )
    }
    throw new ClaimsVerificationError('KEY_NOT_FOUND', 'No matching key found in JWKS')
  }

  // 4. Verify cryptographic signature
  const signatureBytes = decodeBase64Url(signatureB64)
  const isSigValid = await verifyJwtSignature(signingInput, signatureBytes, header, jwk)
  if (!isSigValid) {
    throw new ClaimsVerificationError(
      'INVALID_SIGNATURE',
      'Cryptographic signature verification failed',
    )
  }

  // 5. Canonicalize claims
  const claims = canonicalizeClaims(rawPayload)
  if (!claims) {
    throw new ClaimsVerificationError(
      'MALFORMED_CLAIMS',
      'Payload does not conform to canonical claims schema',
    )
  }

  // 6. Temporal validation (exp, nbf)
  const now = options.nowSec ?? Math.floor(Date.now() / 1000)
  const tolerance = options.clockToleranceSec ?? 5

  if (claims.exp !== undefined) {
    if (now > claims.exp + tolerance) {
      throw new ClaimsVerificationError(
        'TOKEN_EXPIRED',
        `Token expired at ${claims.exp} (current time: ${now})`,
      )
    }
  }

  if (claims.nbf !== undefined) {
    if (now < claims.nbf - tolerance) {
      throw new ClaimsVerificationError(
        'TOKEN_NOT_YET_VALID',
        `Token not valid before ${claims.nbf} (current time: ${now})`,
      )
    }
  }

  // 7. Issuer validation
  if (options.expectedIss !== undefined) {
    if (claims.iss !== options.expectedIss) {
      throw new ClaimsVerificationError(
        'INVALID_ISSUER',
        `Issuer mismatch: expected "${options.expectedIss}", got "${claims.iss}"`,
      )
    }
  }

  // 8. Audience validation
  if (options.expectedAud !== undefined) {
    const expected = Array.isArray(options.expectedAud)
      ? options.expectedAud
      : [options.expectedAud]
    const actualAud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : []
    const hasAud = expected.some((aud) => actualAud.includes(aud))
    if (!hasAud) {
      throw new ClaimsVerificationError(
        'INVALID_AUDIENCE',
        `Audience mismatch: expected one of [${expected.join(', ')}], got [${actualAud.join(', ')}]`,
      )
    }
  }

  return markClaimsVerified(claims)
}
