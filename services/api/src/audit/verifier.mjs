// services/api/src/audit/verifier.mjs
// Audit Writer & Tamper-Evident Merkle Verifier (Blueprint §3.7 N7, F-05; ADR-012, ADR-7)

import { createHash } from 'node:crypto'

export const INITIAL_PREV_HASH = '0'.repeat(64)

/**
 * Computes canonical SHA-256 row_hash for an audit entry.
 * row_hash = SHA-256(canonical(entry without row_hash) || prev_hash)
 */
export function computeRowHash(entry, prevHash = INITIAL_PREV_HASH) {
  const canonicalData = [
    String(entry.seq),
    String(entry.ts),
    String(entry.actor_ref),
    String(entry.action),
    String(entry.resource_ref),
    String(entry.decision),
    String(entry.trace_id),
    String(entry.obj_hash),
    String(prevHash),
  ].join('|')

  return createHash('sha256').update(canonicalData).digest('hex')
}

/**
 * RFC 6962 / RFC 9162 domain-separated leaf hash: SHA-256(0x00 || leaf)
 */
export function hashLeaf(leafHex) {
  const buf = Buffer.concat([Buffer.from([0x00]), Buffer.from(leafHex, 'hex')])
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * RFC 6962 / RFC 9162 domain-separated internal node hash: SHA-256(0x01 || left || right)
 */
export function hashNode(leftHex, rightHex) {
  const buf = Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from(leftHex, 'hex'),
    Buffer.from(rightHex, 'hex'),
  ])
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Computes binary Merkle tree root over leaf row_hashes.
 */
export function computeMerkleRoot(rowHashes) {
  if (!rowHashes || rowHashes.length === 0) return null
  let currentLevel = rowHashes.map(hashLeaf)

  while (currentLevel.length > 1) {
    const nextLevel = []
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(hashNode(currentLevel[i], currentLevel[i + 1]))
      } else {
        // Odd node duplicated to keep balanced binary tree
        nextLevel.push(hashNode(currentLevel[i], currentLevel[i]))
      }
    }
    currentLevel = nextLevel
  }

  return currentLevel[0]
}

/**
 * Verifies audit ledger continuity and Merkle root anchoring.
 * Tri-state verification: 'verified' | 'failed' | 'unavailable' (F-05).
 * Never defaults to 'verified' on empty sets or missing roots.
 */
export function verifyAuditLedger(entries, anchoredRoots = []) {
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return {
      status: 'unavailable',
      reason: 'No audit records available to verify',
      checked: 0,
      roots_verified: 0,
    }
  }

  let expectedPrevHash = INITIAL_PREV_HASH

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (i === 0 && entry.prev_hash) {
      expectedPrevHash = entry.prev_hash
    }

    if (entry.prev_hash !== expectedPrevHash) {
      return {
        status: 'failed',
        reason: `Hash chain break at seq ${entry.seq}: expected prev_hash ${expectedPrevHash}, got ${entry.prev_hash}`,
        checked: i,
        first_bad_seq: entry.seq,
        roots_verified: 0,
      }
    }

    const calculatedRowHash = computeRowHash(entry, expectedPrevHash)
    if (calculatedRowHash !== entry.row_hash) {
      return {
        status: 'failed',
        reason: `Tampered row_hash at seq ${entry.seq}`,
        checked: i,
        first_bad_seq: entry.seq,
        roots_verified: 0,
      }
    }

    expectedPrevHash = entry.row_hash
  }

  // Verify against anchored Merkle roots if available
  let verifiedRoots = 0
  if (anchoredRoots.length > 0) {
    const allRowHashes = entries.map((e) => e.row_hash)
    const calculatedRoot = computeMerkleRoot(allRowHashes)

    const matchingRoot = anchoredRoots.find((r) => r.root_hash === calculatedRoot)
    if (matchingRoot) {
      verifiedRoots++
    } else {
      return {
        status: 'failed',
        reason: 'Calculated Merkle root does not match anchored root',
        checked: entries.length,
        roots_verified: 0,
      }
    }
  }

  return {
    status: 'verified',
    checked: entries.length,
    roots_verified: verifiedRoots,
  }
}
