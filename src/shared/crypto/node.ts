/**
 * src/shared/crypto/node.ts — Node.js implementation of CryptoProvider using node:crypto.
 * Reference: Blueprint §3.1, §3.3, §3.4, §5.6 (WP-02, X-05e, ADR-3)
 */

import {
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  sign as nodeSign,
  verify as nodeVerify,
  createPublicKey,
  createPrivateKey,
  type KeyObject,
} from 'node:crypto'

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

export class NodeCryptoProvider implements CryptoProvider {
  readonly name = 'node' as const

  async sha256(data: Uint8Array | string): Promise<Uint8Array> {
    const bytes = toUint8Array(data)
    const hash = createHash('sha256').update(bytes).digest()
    return new Uint8Array(hash.buffer, hash.byteOffset, hash.byteLength)
  }

  async sha256Hex(data: Uint8Array | string): Promise<string> {
    const bytes = toUint8Array(data)
    return createHash('sha256').update(bytes).digest('hex')
  }

  async hmacSha256(key: Uint8Array | string, data: Uint8Array | string): Promise<Uint8Array> {
    const keyBytes = toUint8Array(key)
    const dataBytes = toUint8Array(data)
    const hmac = createHmac('sha256', Buffer.from(keyBytes)).update(dataBytes).digest()
    return new Uint8Array(hmac.buffer, hmac.byteOffset, hmac.byteLength)
  }

  async hmacSha256Hex(key: Uint8Array | string, data: Uint8Array | string): Promise<string> {
    const keyBytes = toUint8Array(key)
    const dataBytes = toUint8Array(data)
    return createHmac('sha256', Buffer.from(keyBytes)).update(dataBytes).digest('hex')
  }

  randomBytes(length: number): Uint8Array {
    if (length <= 0) return new Uint8Array(0)
    const buf = nodeRandomBytes(length)
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  async verifyEd25519(
    publicKey: Ed25519PublicKeyInput,
    data: Uint8Array | string,
    signature: Uint8Array | string,
  ): Promise<boolean> {
    try {
      const dataBytes = toUint8Array(data)
      const sigBytes = normalizeEd25519Signature(signature)

      let keyObj: KeyObject
      if (
        typeof publicKey === 'object' &&
        publicKey !== null &&
        'type' in publicKey &&
        'asymmetricKeyType' in publicKey
      ) {
        keyObj = publicKey as KeyObject
      } else {
        const { spkiBytes } = normalizeEd25519PublicKey(publicKey)
        keyObj = createPublicKey({
          key: Buffer.from(spkiBytes),
          format: 'der',
          type: 'spki',
        })
      }

      return nodeVerify(null, Buffer.from(dataBytes), keyObj, Buffer.from(sigBytes))
    } catch {
      return false
    }
  }

  async signEd25519(
    privateKey: Ed25519PrivateKeyInput,
    data: Uint8Array | string,
  ): Promise<Uint8Array> {
    const dataBytes = toUint8Array(data)
    let keyObj: KeyObject

    if (
      typeof privateKey === 'object' &&
      privateKey !== null &&
      'type' in privateKey &&
      'asymmetricKeyType' in privateKey
    ) {
      keyObj = privateKey as KeyObject
    } else {
      let bytes: Uint8Array
      if (typeof privateKey === 'string') {
        const trimmed = privateKey.trim()
        if (trimmed.startsWith('-----BEGIN')) {
          keyObj = createPrivateKey(trimmed)
          const sig = nodeSign(null, Buffer.from(dataBytes), keyObj)
          return new Uint8Array(sig.buffer, sig.byteOffset, sig.byteLength)
        } else if (/^[0-9a-fA-F]+$/.test(trimmed)) {
          bytes = fromHexString(trimmed)
        } else {
          bytes = decodeBase64Url(trimmed)
        }
      } else if (privateKey instanceof Uint8Array) {
        bytes = privateKey
      } else {
        throw new TypeError(`Unsupported private key type: ${typeof privateKey}`)
      }

      if (bytes.length === 32) {
        // Raw seed: wrap in PKCS#8 DER (48 bytes)
        const pkcs8 = new Uint8Array(48)
        pkcs8.set(ED25519_PKCS8_PREFIX, 0)
        pkcs8.set(bytes, 16)
        keyObj = createPrivateKey({
          key: Buffer.from(pkcs8),
          format: 'der',
          type: 'pkcs8',
        })
      } else if (bytes.length === 48) {
        keyObj = createPrivateKey({
          key: Buffer.from(bytes),
          format: 'der',
          type: 'pkcs8',
        })
      } else {
        throw new Error(
          `Invalid Ed25519 private key length: expected 32 raw or 48 PKCS8 bytes, got ${bytes.length}`,
        )
      }
    }

    const sig = nodeSign(null, Buffer.from(dataBytes), keyObj)
    return new Uint8Array(sig.buffer, sig.byteOffset, sig.byteLength)
  }

  async isEd25519Supported(): Promise<boolean> {
    return true
  }
}
