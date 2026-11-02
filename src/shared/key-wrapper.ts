/**
 * NutriScore CAD Phase 6 — KeyWrapper Provider Interface & Stage A Implementation
 *
 * Reference: Blueprint §4.1, §4.2, Amendment A7
 *
 * Local Stage A implementation wraps/unwraps per-patient Data Encryption Keys (DEKs)
 * using a local Master Key (CAD_MASTER_KEY) and derives per-tenant Key Encryption Keys (KEKs),
 * blind index keys, and keyed MAC keys via HMAC-SHA256.
 *
 * Cutover target: Vault transit / Sovereign Cloud HSM.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export interface KeyWrapper {
  /**
   * Wrap a 32-byte patient DEK under a tenant-specific KEK.
   */
  wrapKey(tenantId: string, dek: Uint8Array): Promise<Uint8Array> | Uint8Array

  /**
   * Unwrap a patient DEK using the tenant-specific KEK.
   * Throws if the key is invalid, corrupted, or has been shredded (zeroed).
   */
  unwrapKey(tenantId: string, wrappedDek: Uint8Array): Promise<Uint8Array> | Uint8Array

  /**
   * Derive a 32-byte key for tenant blind indexes.
   */
  deriveTenantIndexKey(tenantId: string): Promise<Uint8Array> | Uint8Array

  /**
   * Derive a 32-byte key for tenant keyed MAC commitments.
   */
  deriveTenantMacKey(tenantId: string): Promise<Uint8Array> | Uint8Array
}

export class LocalKeyWrapper implements KeyWrapper {
  private readonly masterKey: Buffer

  /**
   * @param masterKey - 32-byte master key buffer, or hex/base64 string.
   */
  constructor(masterKey?: string | Uint8Array) {
    if (masterKey) {
      if (typeof masterKey === 'string') {
        if (/^[0-9a-fA-F]{64}$/.test(masterKey)) {
          this.masterKey = Buffer.from(masterKey, 'hex')
        } else {
          // Derive 32 bytes via SHA-256 of supplied passphrase/string
          const h = createHmac('sha256', Buffer.from('CAD_STAGE_A_MASTER_SALT', 'utf8'))
          h.update(Buffer.from(masterKey, 'utf8'))
          this.masterKey = h.digest()
        }
      } else {
        if (masterKey.length !== 32) {
          throw new Error(`Master key must be exactly 32 bytes, got ${masterKey.length}`)
        }
        this.masterKey = Buffer.from(masterKey)
      }
    } else {
      const envKey = typeof process !== 'undefined' ? process.env?.CAD_MASTER_KEY : undefined
      if (envKey) {
        if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
          this.masterKey = Buffer.from(envKey, 'hex')
        } else {
          const h = createHmac('sha256', Buffer.from('CAD_STAGE_A_MASTER_SALT', 'utf8'))
          h.update(Buffer.from(envKey, 'utf8'))
          this.masterKey = h.digest()
        }
      } else {
        // Fallback default for deterministic local dev/test environment
        const h = createHmac('sha256', Buffer.from('CAD_STAGE_A_DEFAULT_DEV_KEY_V1', 'utf8'))
        h.update(Buffer.from('nutriscore-cad-local-master-key-seed', 'utf8'))
        this.masterKey = h.digest()
      }
    }
  }

  /**
   * Derive a 32-byte Key Encryption Key (KEK) for a specific tenant.
   */
  private deriveTenantKek(tenantId: string): Buffer {
    return createHmac('sha256', this.masterKey)
      .update(Buffer.from(`tenant-kek:${tenantId}`, 'utf8'))
      .digest()
  }

  /**
   * Wrap a 32-byte patient DEK.
   * Envelope format: 0x01 (version byte) || nonce (12 bytes) || tag (16 bytes) || ciphertext (32 bytes)
   * Total length: 1 + 12 + 16 + 32 = 61 bytes.
   */
  wrapKey(tenantId: string, dek: Uint8Array): Uint8Array {
    if (dek.length !== 32) {
      throw new Error(`DEK must be exactly 32 bytes, got ${dek.length}`)
    }
    const kek = this.deriveTenantKek(tenantId)
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', kek, nonce)
    cipher.setAAD(Buffer.from(`tenant:${tenantId}:dek`, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(dek)), cipher.final()])
    const tag = cipher.getAuthTag()

    return Buffer.concat([
      Buffer.from([0x01]), // Version 1
      nonce,
      tag,
      ciphertext,
    ])
  }

  /**
   * Unwrap a patient DEK.
   * Fails if the wrapped key is shredded (all zeros), corrupted, or has wrong tenant AAD.
   */
  unwrapKey(tenantId: string, wrappedDek: Uint8Array): Uint8Array {
    const buf = Buffer.from(wrappedDek)

    // Check for shredded key (all zeros or too short)
    if (buf.length < 61) {
      throw new Error('Wrapped DEK is invalid or has been shredded')
    }

    const isAllZeros = buf.every((byte: number) => byte === 0)
    if (isAllZeros) {
      throw new Error('Patient DEK has been shredded (crypto-shredded)')
    }

    const version = buf[0]
    if (version !== 0x01) {
      throw new Error(`Unsupported wrapped DEK version: ${version}`)
    }

    const nonce = buf.subarray(1, 13)
    const tag = buf.subarray(13, 29)
    const ciphertext = buf.subarray(29, 61)

    const kek = this.deriveTenantKek(tenantId)
    const decipher = createDecipheriv('aes-256-gcm', kek, nonce)
    decipher.setAuthTag(tag)
    decipher.setAAD(Buffer.from(`tenant:${tenantId}:dek`, 'utf8'))

    try {
      const dek = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      if (dek.length !== 32) {
        throw new Error('Unwrapped DEK has incorrect length')
      }
      return dek
    } catch (err) {
      throw new Error(`Failed to unwrap DEK for tenant ${tenantId}: ${(err as Error).message}`)
    }
  }

  /**
   * Derive tenant blind index key.
   */
  deriveTenantIndexKey(tenantId: string): Uint8Array {
    return createHmac('sha256', this.masterKey)
      .update(Buffer.from(`tenant-bidx:${tenantId}`, 'utf8'))
      .digest()
  }

  /**
   * Derive tenant keyed MAC key.
   */
  deriveTenantMacKey(tenantId: string): Uint8Array {
    return createHmac('sha256', this.masterKey)
      .update(Buffer.from(`tenant-mac:${tenantId}`, 'utf8'))
      .digest()
  }
}
