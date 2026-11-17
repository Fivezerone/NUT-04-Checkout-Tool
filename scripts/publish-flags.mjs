/**
 * scripts/publish-flags.mjs — Mint and sign feature flag manifests.
 * Reference: Blueprint §3.8, §5.6 (WP-03, ADR-5)
 *
 * Responsibilities:
 *   - Assemble valid FlagManifest JSON ({ typ: 'ns-flags+json', seq, issued_at, flags, kid, sig }).
 *   - Generate deterministic canonical body via stableStringify.
 *   - Sign canonical body with Ed25519 private key.
 *   - Provide CLI and programmatic API for tests and deployment pipelines.
 */

import { sign, createPrivateKey } from 'node:crypto'
import { stableStringify } from '../src/shared/canonical.mjs'

export const FLAGS_TYP = 'ns-flags+json'

/**
 * Creates a signed flag manifest from configuration parameters.
 *
 * @param {object} params
 * @param {Record<string, { enabled: boolean; cohort_pct: number; allow_ids?: string[]; min_ext_ver?: string }>} params.flags
 * @param {number} params.seq strictly increasing integer
 * @param {string} [params.issuedAt] ISO timestamp
 * @param {string} [params.kid] key ID
 * @param {*} params.privateKey Node KeyObject, PEM string, or 32-byte seed
 * @returns {object} signed FlagManifest
 */
export function mintFlagManifest({
  flags,
  seq,
  issuedAt = new Date().toISOString(),
  kid = 'flags-root-2026-q4',
  privateKey,
}) {
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) {
    throw new TypeError(`seq must be a positive integer, got ${seq}`)
  }
  if (!flags || typeof flags !== 'object') {
    throw new TypeError('flags must be an object dictionary')
  }
  if (!privateKey) {
    throw new Error('privateKey is required to sign flag manifest')
  }

  const body = {
    flags,
    issued_at: issuedAt,
    kid,
    seq,
    typ: FLAGS_TYP,
  }

  const canonicalString = stableStringify(body)
  const dataBytes = Buffer.from(canonicalString, 'utf8')

  let keyObj
  if (typeof privateKey === 'object' && privateKey !== null && 'asymmetricKeyType' in privateKey) {
    keyObj = privateKey
  } else if (typeof privateKey === 'string' && privateKey.trim().startsWith('-----BEGIN')) {
    keyObj = createPrivateKey(privateKey)
  } else if (privateKey instanceof Uint8Array && privateKey.length === 32) {
    // 32-byte raw seed -> wrap in PKCS#8 DER (48 bytes)
    const pkcs8Prefix = Buffer.from([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04,
      0x20,
    ])
    keyObj = createPrivateKey({
      key: Buffer.concat([pkcs8Prefix, Buffer.from(privateKey)]),
      format: 'der',
      type: 'pkcs8',
    })
  } else {
    keyObj = createPrivateKey(privateKey)
  }

  const sigBuffer = sign(null, dataBytes, keyObj)
  // Encode signature as base64url
  const sigB64 = sigBuffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  return {
    ...body,
    sig: sigB64,
  }
}

// CLI entrypoint if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('[publish-flags] CLI invocation helper')
}
