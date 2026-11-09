/**
 * NutriScore CAD Phase 7 — Signer Provider Interface & Stage A Implementation
 *
 * Reference: Blueprint §3.4, §3.6, Amendment A7
 *
 * Stage A local provider uses an Ed25519 key pair to sign Dietary Profile Tokens (DPTs)
 * and ledger rows with alg: "EdDSA".
 *
 * Cutover target: HashiCorp Vault transit / HSM (key never leaves Vault, kid rotates every 90 days).
 */

import { generateKeyPairSync, sign, verify, createHash, type KeyPairSyncResult } from 'node:crypto'

export interface Signer {
  sign(data: Uint8Array | string): Promise<Uint8Array> | Uint8Array
  getPublicKeyJwk(): Promise<Record<string, unknown>> | Record<string, unknown>
  getKid(): string
  isAvailable(): boolean
}

export class LocalEd25519Signer implements Signer {
  private readonly keyPair: KeyPairSyncResult
  private readonly kid: string
  private available = true
  private cachedJwk: Record<string, unknown> | null = null

  constructor(kid = 'dpt-key-2026-q4') {
    this.kid = kid
    this.keyPair = generateKeyPairSync('ed25519')
  }

  isAvailable(): boolean {
    return this.available
  }

  setAvailable(available: boolean): void {
    this.available = available
  }

  getKid(): string {
    return this.kid
  }

  getPublicKeyJwk(): Record<string, unknown> {
    if (!this.cachedJwk) {
      const exported = this.keyPair.publicKey.export({ format: 'jwk' } as Parameters<
        typeof this.keyPair.publicKey.export
      >[0]) as Record<string, unknown>
      this.cachedJwk = {
        ...exported,
        kty: 'OKP',
        crv: 'Ed25519',
        kid: this.kid,
        use: 'sig',
        alg: 'EdDSA',
      }
    }
    return this.cachedJwk
  }

  getPrivateKey(): any {
    return this.keyPair.privateKey
  }

  getPublicKey(): any {
    return this.keyPair.publicKey
  }

  sign(data: Uint8Array | string): Uint8Array {
    if (!this.available) {
      throw new Error('Signer is unavailable (Vault unreachable)')
    }
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)
    // In Node.js, Ed25519 signing algorithm is null (built-in to Ed25519)
    return sign(null, buf, this.keyPair.privateKey)
  }

  verify(data: Uint8Array | string, signature: Uint8Array): boolean {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)
    return verify(null, buf, this.keyPair.publicKey, signature)
  }
}
