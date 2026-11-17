/**
 * NutriScore CAD Phase 7 — DPoP (Demonstrating Proof-of-Possession) Utility
 *
 * Reference: RFC 9449, RFC 7638, Blueprint §3.3, §3.4, §3.6
 *
 * Implements:
 * 1. RFC 7638 JWK Thumbprint computation (`cnf.jkt`).
 * 2. DPoP proof generation for client calls.
 * 3. DPoP proof verification with anti-replay, 60s freshness, method & URI binding.
 */

import { createHash, createPublicKey, randomBytes, sign, verify } from 'node:crypto'
import { encodeBase64Url, decodeBase64Url, getCryptoProvider } from './crypto'

export interface JwkPublicKey {
  kty: string
  crv?: string
  x?: string
  y?: string
  e?: string
  n?: string
  kid?: string
  [key: string]: unknown
}

export interface DpopProofPayload {
  jti: string
  htm: string
  htu: string
  iat: number
  nonce?: string
  ath?: string
}

export interface DpopVerificationResult {
  valid: boolean
  jkt?: string
  error?: string
}

export class BoundedReplayCache {
  private readonly maxEntries: number
  private readonly ttlMs: number
  private readonly entries = new Map<string, number>()

  constructor(maxEntries = 5000, ttlSeconds = 120) {
    this.maxEntries = maxEntries
    this.ttlMs = ttlSeconds * 1000
  }

  has(jti: string): boolean {
    const exp = this.entries.get(jti)
    if (exp === undefined) return false
    if (Date.now() > exp) {
      this.entries.delete(jti)
      return false
    }
    return true
  }

  add(jti: string): void {
    const now = Date.now()
    if (this.entries.size >= this.maxEntries) {
      for (const [k, exp] of this.entries) {
        if (now > exp) this.entries.delete(k)
      }
      if (this.entries.size >= this.maxEntries) {
        let toDrop = Math.ceil(this.maxEntries * 0.1)
        for (const k of this.entries.keys()) {
          this.entries.delete(k)
          if (--toDrop <= 0) break
        }
      }
    }
    this.entries.set(jti, now + this.ttlMs)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
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
 * Compute the RFC 7638 SHA-256 thumbprint of a public JWK.
 * For OKP (Ed25519): canonical keys are `crv`, `kty`, `x`.
 */
export function computeJwkThumbprint(jwk: JwkPublicKey): string {
  let canonicalJson: string
  if (jwk.kty === 'OKP') {
    canonicalJson = JSON.stringify({
      crv: jwk.crv,
      kty: jwk.kty,
      x: jwk.x,
    })
  } else if (jwk.kty === 'EC') {
    canonicalJson = JSON.stringify({
      crv: jwk.crv,
      kty: jwk.kty,
      x: jwk.x,
      y: jwk.y,
    })
  } else if (jwk.kty === 'RSA') {
    canonicalJson = JSON.stringify({
      e: jwk.e,
      kty: jwk.kty,
      n: jwk.n,
    })
  } else {
    throw new Error(`Unsupported JWK key type: ${jwk.kty}`)
  }

  const hash = createHash('sha256').update(canonicalJson).digest()
  return base64UrlEncode(hash)
}

/**
 * Compute the RFC 7638 SHA-256 thumbprint of a public JWK asynchronously via CryptoProvider.
 */
export async function computeJwkThumbprintAsync(jwk: JwkPublicKey): Promise<string> {
  let canonicalJson: string
  if (jwk.kty === 'OKP') {
    canonicalJson = JSON.stringify({
      crv: jwk.crv,
      kty: jwk.kty,
      x: jwk.x,
    })
  } else if (jwk.kty === 'EC') {
    canonicalJson = JSON.stringify({
      crv: jwk.crv,
      kty: jwk.kty,
      x: jwk.x,
      y: jwk.y,
    })
  } else if (jwk.kty === 'RSA') {
    canonicalJson = JSON.stringify({
      e: jwk.e,
      kty: jwk.kty,
      n: jwk.n,
    })
  } else {
    throw new Error(`Unsupported JWK key type: ${jwk.kty}`)
  }

  const hash = await getCryptoProvider().sha256(canonicalJson)
  return encodeBase64Url(hash)
}

/**
 * Strip query string and fragment from URL per RFC 9449 §4.3.
 */
export function normalizeDpopHtu(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return url.split('?')[0].split('#')[0]
  }
}

/**
 * Generate a DPoP proof JWT.
 */
export function createDpopProof(
  privateKey: any,
  publicJwk: JwkPublicKey,
  httpMethod: string,
  httpUrl: string,
  options?: { jti?: string; iat?: number; nonce?: string; accessToken?: string },
): string {
  const header = {
    typ: 'dpop+jwt',
    alg: 'EdDSA',
    jwk: {
      kty: publicJwk.kty,
      crv: publicJwk.crv,
      x: publicJwk.x,
    },
  }

  const htu = normalizeDpopHtu(httpUrl)
  const now = options?.iat ?? Math.floor(Date.now() / 1000)
  const jti = options?.jti ?? randomBytes(16).toString('hex')

  const payload: DpopProofPayload = {
    jti,
    htm: httpMethod.toUpperCase(),
    htu,
    iat: now,
  }

  if (options?.nonce) payload.nonce = options.nonce
  if (options?.accessToken) {
    const ath = createHash('sha256').update(options.accessToken).digest()
    payload.ath = base64UrlEncode(ath)
  }

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header), 'utf8'))
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signingInput = `${headerB64}.${payloadB64}`

  const sig = sign(null, Buffer.from(signingInput, 'utf8'), privateKey)
  const sigB64 = base64UrlEncode(sig)

  return `${signingInput}.${sigB64}`
}

/**
 * Verify a DPoP proof JWT.
 */
export function verifyDpopProof(
  proofJwt: string,
  expectedMethod: string,
  expectedUrl: string,
  replayCache?: Set<string> | BoundedReplayCache,
  maxAgeSeconds = 60,
): DpopVerificationResult {
  const parts = proofJwt.split('.')
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed DPoP proof: must have 3 parts' }
  }

  let header: { typ?: string; alg?: string; jwk?: JwkPublicKey }
  let payload: DpopProofPayload

  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'))
    payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'))
  } catch (err) {
    return { valid: false, error: `Failed to parse DPoP JSON: ${(err as Error).message}` }
  }

  if (header.typ !== 'dpop+jwt') {
    return { valid: false, error: `Invalid DPoP typ: expected 'dpop+jwt', got '${header.typ}'` }
  }

  if (!header.jwk) {
    return { valid: false, error: 'Missing jwk in DPoP header' }
  }

  // Check HTTP method
  if (payload.htm !== expectedMethod.toUpperCase()) {
    return {
      valid: false,
      error: `DPoP method mismatch: expected '${expectedMethod.toUpperCase()}', got '${payload.htm}'`,
    }
  }

  // Check HTTP URI (stripped of query string and fragments)
  const expectedHtu = normalizeDpopHtu(expectedUrl)
  if (payload.htu !== expectedHtu) {
    return {
      valid: false,
      error: `DPoP URI mismatch: expected '${expectedHtu}', got '${payload.htu}'`,
    }
  }

  // Check freshness (within maxAgeSeconds, default 60s)
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - payload.iat) > maxAgeSeconds) {
    return {
      valid: false,
      error: `DPoP proof expired or timestamp drifted (${Math.abs(now - payload.iat)}s > ${maxAgeSeconds}s)`,
    }
  }

  // Check replay
  if (replayCache) {
    if (replayCache.has(payload.jti)) {
      return { valid: false, error: `Replayed DPoP proof: jti ${payload.jti} already used` }
    }
    replayCache.add(payload.jti)
  }

  // Compute JWK thumbprint
  let jkt: string
  try {
    jkt = computeJwkThumbprint(header.jwk)
  } catch (err) {
    return { valid: false, error: `Failed to compute JWK thumbprint: ${(err as Error).message}` }
  }

  // Verify cryptographic signature
  const signingInput = `${parts[0]}.${parts[1]}`
  const sig = base64UrlDecode(parts[2])

  // In Node.js / Stage A, construct key from header.jwk
  try {
    const keyObject = createPublicKey({ key: header.jwk, format: 'jwk' })
    const sigValid = verify(null, Buffer.from(signingInput, 'utf8'), keyObject, sig)
    if (!sigValid) {
      return { valid: false, error: 'Invalid DPoP signature' }
    }
  } catch (err) {
    return { valid: false, error: `DPoP signature verification failed: ${(err as Error).message}` }
  }

  return { valid: true, jkt }
}

/**
 * Verify a DPoP proof JWT asynchronously via CryptoProvider.
 * Compatible with both Node and Browser / WebCrypto environments.
 */
export async function verifyDpopProofAsync(
  proofJwt: string,
  expectedMethod: string,
  expectedUrl: string,
  replayCache?: Set<string> | BoundedReplayCache,
  maxAgeSeconds = 60,
): Promise<DpopVerificationResult> {
  const parts = proofJwt.split('.')
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed DPoP proof: must have 3 parts' }
  }

  let header: { typ?: string; alg?: string; jwk?: JwkPublicKey }
  let payload: DpopProofPayload

  try {
    const headerStr = new TextDecoder().decode(decodeBase64Url(parts[0]))
    const payloadStr = new TextDecoder().decode(decodeBase64Url(parts[1]))
    header = JSON.parse(headerStr)
    payload = JSON.parse(payloadStr)
  } catch (err) {
    return { valid: false, error: `Failed to parse DPoP JSON: ${(err as Error).message}` }
  }

  if (header.typ !== 'dpop+jwt') {
    return { valid: false, error: `Invalid DPoP typ: expected 'dpop+jwt', got '${header.typ}'` }
  }

  if (!header.jwk) {
    return { valid: false, error: 'Missing jwk in DPoP header' }
  }

  // Check HTTP method
  if (payload.htm !== expectedMethod.toUpperCase()) {
    return {
      valid: false,
      error: `DPoP method mismatch: expected '${expectedMethod.toUpperCase()}', got '${payload.htm}'`,
    }
  }

  // Check HTTP URI (stripped of query string and fragments)
  const expectedHtu = normalizeDpopHtu(expectedUrl)
  if (payload.htu !== expectedHtu) {
    return {
      valid: false,
      error: `DPoP URI mismatch: expected '${expectedHtu}', got '${payload.htu}'`,
    }
  }

  // Check freshness (within maxAgeSeconds, default 60s)
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - payload.iat) > maxAgeSeconds) {
    return {
      valid: false,
      error: `DPoP proof expired or timestamp drifted (${Math.abs(now - payload.iat)}s > ${maxAgeSeconds}s)`,
    }
  }

  // Check replay
  if (replayCache) {
    if (replayCache.has(payload.jti)) {
      return { valid: false, error: `Replayed DPoP proof: jti ${payload.jti} already used` }
    }
    replayCache.add(payload.jti)
  }

  // Compute JWK thumbprint
  let jkt: string
  try {
    jkt = await computeJwkThumbprintAsync(header.jwk)
  } catch (err) {
    return { valid: false, error: `Failed to compute JWK thumbprint: ${(err as Error).message}` }
  }

  // Verify cryptographic signature via CryptoProvider
  const signingInput = `${parts[0]}.${parts[1]}`
  const sig = decodeBase64Url(parts[2])

  try {
    const sigValid = await getCryptoProvider().verifyEd25519(header.jwk, signingInput, sig)
    if (!sigValid) {
      return { valid: false, error: 'Invalid DPoP signature' }
    }
  } catch (err) {
    return { valid: false, error: `DPoP signature verification failed: ${(err as Error).message}` }
  }

  return { valid: true, jkt }
}
