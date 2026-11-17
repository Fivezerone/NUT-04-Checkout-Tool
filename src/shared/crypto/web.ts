/**
 * src/shared/crypto/web.ts — Browser/SubtleCrypto implementation of CryptoProvider.
 * Reference: Blueprint §2.3 (N4), §3.1, §3.3, §5.6 (WP-02, X-05e, ADR-3)
 *
 * Responsibilities:
 *   - Pure WebCrypto implementation running in Chrome Extension MV3 Service Worker and UI.
 *   - Zero Node.js dependencies (no node:crypto, no Buffer).
 *   - Ed25519 feature detection and fail-closed verification.
 */

import {
  type CryptoProvider,
  type Ed25519PublicKeyInput,
  type Ed25519PrivateKeyInput,
  toUint8Array,
  toHexString,
  normalizeEd25519PublicKey,
  normalizeEd25519Signature,
  ED25519_PKCS8_PREFIX,
  decodeBase64Url,
  fromHexString,
} from './provider'

function getWebCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto
  }
  throw new Error('WebCrypto (globalThis.crypto.subtle) is not available in this environment')
}

export class WebCryptoProvider implements CryptoProvider {
  readonly name = 'web' as const

  async sha256(data: Uint8Array | string): Promise<Uint8Array> {
    const crypto = getWebCrypto()
    const bytes = toUint8Array(data)
    const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
    return new Uint8Array(buf)
  }

  async sha256Hex(data: Uint8Array | string): Promise<string> {
    const hash = await this.sha256(data)
    return toHexString(hash)
  }

  async hmacSha256(key: Uint8Array | string, data: Uint8Array | string): Promise<Uint8Array> {
    const crypto = getWebCrypto()
    const keyBytes = toUint8Array(key)
    const dataBytes = toUint8Array(data)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes as unknown as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )

    const signature = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      dataBytes as unknown as BufferSource,
    )
    return new Uint8Array(signature)
  }

  async hmacSha256Hex(key: Uint8Array | string, data: Uint8Array | string): Promise<string> {
    const hash = await this.hmacSha256(key, data)
    return toHexString(hash)
  }

  randomBytes(length: number): Uint8Array {
    if (length <= 0) return new Uint8Array(0)
    const crypto = getWebCrypto()
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return bytes
  }

  async verifyEd25519(
    publicKey: Ed25519PublicKeyInput,
    data: Uint8Array | string,
    signature: Uint8Array | string,
  ): Promise<boolean> {
    try {
      const crypto = getWebCrypto()
      const dataBytes = toUint8Array(data)
      const sigBytes = normalizeEd25519Signature(signature)

      let cryptoKey: CryptoKey

      if (
        typeof publicKey === 'object' &&
        publicKey !== null &&
        'kty' in publicKey &&
        publicKey.kty === 'OKP'
      ) {
        // JWK key format
        cryptoKey = await crypto.subtle.importKey('jwk', publicKey, { name: 'Ed25519' }, false, [
          'verify',
        ])
      } else {
        const { rawBytes } = normalizeEd25519PublicKey(publicKey)
        cryptoKey = await crypto.subtle.importKey(
          'raw',
          rawBytes as unknown as BufferSource,
          { name: 'Ed25519' },
          false,
          ['verify'],
        )
      }

      return await crypto.subtle.verify(
        { name: 'Ed25519' },
        cryptoKey,
        sigBytes as unknown as BufferSource,
        dataBytes as unknown as BufferSource,
      )
    } catch {
      return false
    }
  }

  async signEd25519(
    privateKey: Ed25519PrivateKeyInput,
    data: Uint8Array | string,
  ): Promise<Uint8Array> {
    const crypto = getWebCrypto()
    const dataBytes = toUint8Array(data)

    if (typeof privateKey === 'object' && privateKey !== null && 'algorithm' in privateKey) {
      const sig = await crypto.subtle.sign(
        { name: 'Ed25519' },
        privateKey as CryptoKey,
        dataBytes as unknown as BufferSource,
      )
      return new Uint8Array(sig)
    }

    let bytes: Uint8Array
    if (typeof privateKey === 'string') {
      const trimmed = privateKey.trim()
      if (/^[0-9a-fA-F]+$/.test(trimmed)) {
        bytes = fromHexString(trimmed)
      } else {
        bytes = decodeBase64Url(trimmed)
      }
    } else if (privateKey instanceof Uint8Array) {
      bytes = privateKey
    } else {
      throw new TypeError(`Unsupported private key type in WebCrypto: ${typeof privateKey}`)
    }

    let pkcs8: Uint8Array
    if (bytes.length === 32) {
      pkcs8 = new Uint8Array(48)
      pkcs8.set(ED25519_PKCS8_PREFIX, 0)
      pkcs8.set(bytes, 16)
    } else if (bytes.length === 48) {
      pkcs8 = bytes
    } else {
      throw new Error(`Invalid Ed25519 private key length: ${bytes.length}`)
    }

    const key = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8 as unknown as BufferSource,
      { name: 'Ed25519' },
      false,
      ['sign'],
    )

    const sig = await crypto.subtle.sign(
      { name: 'Ed25519' },
      key,
      dataBytes as unknown as BufferSource,
    )
    return new Uint8Array(sig)
  }

  async isEd25519Supported(): Promise<boolean> {
    try {
      const subtle = globalThis.crypto?.subtle
      if (!subtle) return false
      const dummyKey = new Uint8Array(32)
      await subtle.importKey(
        'raw',
        dummyKey as unknown as BufferSource,
        { name: 'Ed25519' },
        false,
        ['verify'],
      )
      return true
    } catch {
      return false
    }
  }
}
