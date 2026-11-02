/**
 * NutriScore CAD Phase 6 — Field-Level Encryption & Blind Indexing
 *
 * Reference: Blueprint §4.1, §4.2, Amendment A7
 *
 * Implements:
 * 1. AES-256-GCM field encryption bound to authenticated row data (AAD):
 *    AAD = `${tenantId}:${tableName}:${columnName}:${rowId}`
 *    Copying ciphertext to another row, column, or tenant causes decryption authentication failure.
 * 2. Envelope format:
 *    [0x01 (version, 1B)] [key_version (uint16_be, 2B)] [nonce (12B)] [tag (16B)] [ciphertext (NB)]
 * 3. Blind indexes for equality lookups:
 *    `HMAC-SHA256(tenantIndexKey, normalize(value))`
 * 4. Keyed commitments (MACs) for digests:
 *    `HMAC-SHA256(tenantMacKey, data)` (replaces bare SHA-256 to prevent dictionary guessing)
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

export interface FieldBindingOptions {
  tenantId: string
  tableName: string
  columnName: string
  rowId: string
  keyVersion?: number
}

const ENVELOPE_HEADER_LEN = 31 // 1 (version) + 2 (keyVersion) + 12 (nonce) + 16 (tag)

/**
 * Format Authenticated Additional Data (AAD) for row binding.
 */
export function formatAad(
  tenantId: string,
  tableName: string,
  columnName: string,
  rowId: string,
): Buffer {
  return Buffer.from(`${tenantId}:${tableName}:${columnName}:${rowId}`, 'utf8')
}

/**
 * Encrypt a field with AES-256-GCM using the patient's DEK and bind it to row AAD.
 */
export function encryptField(
  plaintext: string | Uint8Array,
  dek: Uint8Array,
  options: FieldBindingOptions,
): Buffer {
  if (dek.length !== 32) {
    throw new Error(`DEK must be 32 bytes for AES-256-GCM, got ${dek.length}`)
  }

  const plainBuf =
    typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : Buffer.from(plaintext)
  const keyVersion = options.keyVersion ?? 1
  const nonce = randomBytes(12)
  const aad = formatAad(options.tenantId, options.tableName, options.columnName, options.rowId)

  const cipher = createCipheriv('aes-256-gcm', Buffer.from(dek), nonce)
  cipher.setAAD(aad)

  const ciphertext = Buffer.concat([cipher.update(plainBuf), cipher.final()])
  const tag = cipher.getAuthTag()

  const header = Buffer.alloc(ENVELOPE_HEADER_LEN)
  header[0] = 0x01 // Version 1
  header.writeUInt16BE(keyVersion, 1)
  nonce.copy(header, 3)
  tag.copy(header, 15)

  return Buffer.concat([header, ciphertext])
}

/**
 * Decrypt a field using AES-256-GCM with row AAD verification.
 * Fails if copied to another tenant, table, column, row, or if tampered with.
 */
export function decryptField(
  envelope: Uint8Array,
  dek: Uint8Array,
  options: FieldBindingOptions,
): Buffer {
  if (dek.length !== 32) {
    throw new Error(`DEK must be 32 bytes for AES-256-GCM, got ${dek.length}`)
  }

  const buf = Buffer.from(envelope)
  if (buf.length < ENVELOPE_HEADER_LEN) {
    throw new Error(
      `Ciphertext envelope too short (${buf.length} bytes, minimum ${ENVELOPE_HEADER_LEN})`,
    )
  }

  const version = buf[0]
  if (version !== 0x01) {
    throw new Error(`Unsupported ciphertext version: ${version}`)
  }

  const keyVersion = buf.readUInt16BE(1)
  const nonce = buf.subarray(3, 15)
  const tag = buf.subarray(15, 31)
  const ciphertext = buf.subarray(31)

  const aad = formatAad(options.tenantId, options.tableName, options.columnName, options.rowId)

  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(dek), nonce)
  decipher.setAuthTag(tag)
  decipher.setAAD(aad)

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch (err) {
    throw new Error(
      `Decryption failed for ${options.tableName}.${options.columnName} [row ${options.rowId}]: ` +
        `ciphertext authentication failure (AAD mismatch or corrupted data: ${(err as Error).message})`,
    )
  }
}

/**
 * Decrypt a field and return as UTF-8 string.
 */
export function decryptFieldToString(
  envelope: Uint8Array,
  dek: Uint8Array,
  options: FieldBindingOptions,
): string {
  return decryptField(envelope, dek, options).toString('utf8')
}

/**
 * Normalise a value for blind indexing (e.g. email, phone).
 * Strips surrounding whitespace and lowercases string values.
 */
export function normalizeForBlindIndex(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Compute blind index: HMAC-SHA256(tenantIndexKey, normalize(value)).
 */
export function computeBlindIndex(value: string, tenantIndexKey: Uint8Array): Buffer {
  const normalized = normalizeForBlindIndex(value)
  return createHmac('sha256', Buffer.from(tenantIndexKey))
    .update(Buffer.from(normalized, 'utf8'))
    .digest()
}

/**
 * Compute keyed commitment: HMAC-SHA256(tenantMacKey, data).
 * Used for body_mac in clinical_records to prevent dictionary guesses of diagnoses.
 */
export function computeKeyedMac(data: string | Uint8Array, tenantMacKey: Uint8Array): Buffer {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)
  return createHmac('sha256', Buffer.from(tenantMacKey)).update(buf).digest()
}
