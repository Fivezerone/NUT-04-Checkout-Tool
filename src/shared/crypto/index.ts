/**
 * src/shared/crypto/index.ts — Cryptographic provider entrypoint & environment router.
 * Reference: Blueprint §2.3 (N4), §3.1, §3.3, §5.6 (WP-02, X-05e, X-10, ADR-3)
 */

import {
  type CryptoProvider,
  type Ed25519PublicKeyInput,
  type Ed25519PrivateKeyInput,
  encodeBase64Url,
  decodeBase64Url,
  toHexString,
  fromHexString,
  toUint8Array,
  fromUint8ArrayToString,
  codeUnitCompare,
  legacyCompare,
  normalizeEd25519PublicKey,
  normalizeEd25519Signature,
  ED25519_SPKI_PREFIX,
  ED25519_PKCS8_PREFIX,
  type JwkEd25519,
} from './provider'
import { WebCryptoProvider } from './web'

export * from './provider'
export { WebCryptoProvider } from './web'

let activeProvider: CryptoProvider | null = null

export function getCryptoProvider(): CryptoProvider {
  if (activeProvider) return activeProvider

  // Detect environment: prefer NodeCryptoProvider when running in Node.js
  if (
    typeof process !== 'undefined' &&
    process.versions &&
    process.versions.node &&
    typeof window === 'undefined'
  ) {
    try {
      // Dynamic require avoids bundling node:crypto in browser Vite builds
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const req =
        typeof globalThis !== 'undefined' && (globalThis as any).require
          ? (globalThis as any).require
          : eval('require')
      const { NodeCryptoProvider } = req('./node')
      const nodeProvider: CryptoProvider = new NodeCryptoProvider()
      activeProvider = nodeProvider
      return nodeProvider
    } catch (nodeCryptoErr) {
      // In browser contexts, fallback to WebCryptoProvider
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[CryptoProvider] Node crypto unavailable, using WebCrypto:', nodeCryptoErr)
      }
    }
  }

  const webProvider: CryptoProvider = new WebCryptoProvider()
  activeProvider = webProvider
  return webProvider
}

export function setCryptoProvider(provider: CryptoProvider): void {
  activeProvider = provider
}

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  return getCryptoProvider().sha256(data)
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  return getCryptoProvider().sha256Hex(data)
}

export async function hmacSha256(
  key: Uint8Array | string,
  data: Uint8Array | string,
): Promise<Uint8Array> {
  return getCryptoProvider().hmacSha256(key, data)
}

export async function hmacSha256Hex(
  key: Uint8Array | string,
  data: Uint8Array | string,
): Promise<string> {
  return getCryptoProvider().hmacSha256Hex(key, data)
}

export function randomBytes(length: number): Uint8Array {
  return getCryptoProvider().randomBytes(length)
}

export async function verifyEd25519(
  publicKey: Ed25519PublicKeyInput,
  data: Uint8Array | string,
  signature: Uint8Array | string,
): Promise<boolean> {
  return getCryptoProvider().verifyEd25519(publicKey, data, signature)
}

export async function signEd25519(
  privateKey: Ed25519PrivateKeyInput,
  data: Uint8Array | string,
): Promise<Uint8Array> {
  return getCryptoProvider().signEd25519(privateKey, data)
}

export async function isEd25519Supported(): Promise<boolean> {
  return getCryptoProvider().isEd25519Supported()
}
