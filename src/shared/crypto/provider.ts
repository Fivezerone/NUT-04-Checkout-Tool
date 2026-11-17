/**
 * src/shared/crypto/provider.ts — CryptoProvider interface & shared cryptographic helpers.
 * Reference: Blueprint §3.1, §3.3, §3.4, §5.6 (WP-02, X-05e, X-10, ADR-3)
 *
 * Responsibilities:
 *   - Abstract cryptographic operations behind a unified provider interface.
 *   - Support environment-specific implementations: Node (node:crypto) and Web (SubtleCrypto).
 *   - Provide pure TypeScript helpers for hex, base64url, and code-unit string comparison.
 *   - Enforce fail-closed cryptographic safety across all environments.
 */

// 12-byte DER prefix for Ed25519 SubjectPublicKeyInfo (SPKI, RFC 8410)
// 30 2a (SEQUENCE 42) 30 05 (SEQUENCE 5) 06 03 2b 65 70 (OID 1.3.101.112 id-Ed25519) 03 21 00 (BIT STRING 33, 0 unused)
export const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
])

// 16-byte DER prefix for Ed25519 OneAsymmetricKey / PKCS#8 (RFC 8410)
// 30 2e (SEQUENCE 46) 02 01 00 (INTEGER 0) 30 05 06 03 2b 65 70 04 22 04 20 (OCTET STRING 32 seed)
export const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
])

export interface JwkEd25519 {
  kty: 'OKP'
  crv: 'Ed25519'
  x: string
  kid?: string
  use?: string
  alg?: string
  [key: string]: unknown
}

export type Ed25519PublicKeyInput =
  | Uint8Array
  | string // hex or base64url or PEM
  | JwkEd25519
  | Record<string, unknown>
  | any // Node KeyObject

export type Ed25519PrivateKeyInput =
  | Uint8Array
  | string // hex or base64url or PEM
  | any // Node KeyObject or WebCrypto CryptoKey

export interface CryptoProvider {
  readonly name: 'node' | 'web' | 'custom'

  sha256(data: Uint8Array | string): Promise<Uint8Array>
  sha256Hex(data: Uint8Array | string): Promise<string>

  hmacSha256(key: Uint8Array | string, data: Uint8Array | string): Promise<Uint8Array>
  hmacSha256Hex(key: Uint8Array | string, data: Uint8Array | string): Promise<string>

  randomBytes(length: number): Uint8Array

  verifyEd25519(
    publicKey: Ed25519PublicKeyInput,
    data: Uint8Array | string,
    signature: Uint8Array | string,
  ): Promise<boolean>

  signEd25519(privateKey: Ed25519PrivateKeyInput, data: Uint8Array | string): Promise<Uint8Array>

  isEd25519Supported(): Promise<boolean>
}

// ── Pure Encoding & Comparison Helpers (Zero Dependencies) ───────────────────

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function toUint8Array(input: Uint8Array | string): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (typeof input === 'string') return textEncoder.encode(input)
  throw new TypeError(`Expected Uint8Array or string, received ${typeof input}`)
}

export function fromUint8ArrayToString(bytes: Uint8Array): string {
  return textDecoder.decode(bytes)
}

export function toHexString(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

export function fromHexString(hex: string): Uint8Array {
  const cleanHex = hex.trim().replace(/^0x/i, '')
  if (cleanHex.length % 2 !== 0) {
    throw new TypeError(`Invalid hex string length: ${cleanHex.length}`)
  }
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < cleanHex.length; i += 2) {
    const byte = parseInt(cleanHex.slice(i, i + 2), 16)
    if (isNaN(byte)) {
      throw new TypeError(`Invalid hex character in: ${cleanHex}`)
    }
    bytes[i / 2] = byte
  }
  return bytes
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  let base64: string
  if (typeof btoa === 'function') {
    base64 = btoa(binary)
  } else if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes).toString('base64')
  } else {
    throw new Error('Neither btoa nor Buffer is available for base64 encoding')
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeBase64Url(str: string): Uint8Array {
  const norm = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4))
  const padded = norm + pad

  if (typeof atob === 'function') {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } else if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'))
  } else {
    throw new Error('Neither atob nor Buffer is available for base64 decoding')
  }
}

/**
 * Pure Unicode code-unit comparator (Invariant X-10).
 * Replaces localeCompare('en') to prevent ICU version drift between Node and Chrome.
 */
export function codeUnitCompare(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Legacy locale-sensitive comparator preserved for backward compatibility (ADR-008, Finding X-10).
 */
export function legacyCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'variant' })
}

/**
 * Normalizes an Ed25519 public key input to 32 raw bytes or 44 SPKI bytes.
 */
export function normalizeEd25519PublicKey(key: Ed25519PublicKeyInput): {
  rawBytes: Uint8Array
  spkiBytes: Uint8Array
} {
  if (typeof key === 'object' && key !== null && 'kty' in key) {
    if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || typeof key.x !== 'string') {
      throw new Error('Invalid Ed25519 JWK: expected kty: OKP, crv: Ed25519, and x string')
    }
    const raw = decodeBase64Url(key.x)
    if (raw.length !== 32) {
      throw new Error(`Invalid Ed25519 JWK x length: expected 32 bytes, got ${raw.length}`)
    }
    const spki = new Uint8Array(44)
    spki.set(ED25519_SPKI_PREFIX, 0)
    spki.set(raw, 12)
    return { rawBytes: raw, spkiBytes: spki }
  }

  let bytes: Uint8Array
  if (typeof key === 'string') {
    const trimmed = key.trim()
    if (/^[0-9a-fA-F]+$/.test(trimmed)) {
      bytes = fromHexString(trimmed)
    } else {
      bytes = decodeBase64Url(trimmed)
    }
  } else if (key instanceof Uint8Array) {
    bytes = key
  } else {
    throw new TypeError(`Unsupported public key type: ${typeof key}`)
  }

  if (bytes.length === 32) {
    const spki = new Uint8Array(44)
    spki.set(ED25519_SPKI_PREFIX, 0)
    spki.set(bytes, 12)
    return { rawBytes: bytes, spkiBytes: spki }
  }

  if (bytes.length === 44) {
    for (let i = 0; i < 12; i++) {
      if (bytes[i] !== ED25519_SPKI_PREFIX[i]) {
        throw new Error('Invalid Ed25519 SPKI DER prefix')
      }
    }
    return { rawBytes: bytes.subarray(12), spkiBytes: bytes }
  }

  throw new Error(
    `Invalid Ed25519 public key length: expected 32 raw or 44 SPKI bytes, got ${bytes.length}`,
  )
}

/**
 * Normalizes a 64-byte Ed25519 signature input.
 */
export function normalizeEd25519Signature(sig: Uint8Array | string): Uint8Array {
  if (typeof sig === 'string') {
    const trimmed = sig.trim()
    if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
      return fromHexString(trimmed)
    }
    return decodeBase64Url(trimmed)
  }
  if (sig instanceof Uint8Array) {
    if (sig.length !== 64) {
      throw new Error(`Invalid Ed25519 signature length: expected 64 bytes, got ${sig.length}`)
    }
    return sig
  }
  throw new TypeError(`Unsupported signature type: ${typeof sig}`)
}
