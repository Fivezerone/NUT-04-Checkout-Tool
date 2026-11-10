#!/usr/bin/env node
/**
 * NutriScore CAD Phase 5 — Audit Chain Verifier
 *
 * Modes:
 *   --mode=full     (default) Connect to Postgres, fetch all chains, recompute
 *                   row hashes, verify HMAC signatures, check gapless seq,
 *                   verify checkpoint merkle roots.
 *   --mode=offline  Accept --export=<json-file> produced by --export-only, verify
 *                   without a DB connection (uses only public key / HMAC key).
 *
 * Usage:
 *   node scripts/verify-audit-chain.mjs [--chain-id=<uuid>] [--db-url=<url>]
 *                                        [--mode=full|offline] [--export=<file>]
 *                                        [--export-only=<outfile>]
 *
 * Exit codes:
 *   0 — all chains verified
 *   1 — tamper / gap / signature failure detected (starts 72-h breach clock)
 *   2 — configuration / connectivity error
 *
 * Blueprint refs: §4.4, §4.5, Amendment A7 (Stage A HMAC signer)
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { argv, env, exit } from 'node:process'
import { spawnSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.length ? v.join('=') : true]
  }),
)

const MODE = args['mode'] ?? 'full'
const CHAIN_ID = args['chain-id'] ?? null
const DB_URL =
  args['db-url'] ?? env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54322/postgres'
const EXPORT_FILE = args['export'] ?? null
const EXPORT_ONLY = args['export-only'] ?? null
const PLATFORM_SENTINEL = '00000000-0000-0000-0000-000000000000'

// ---------------------------------------------------------------------------
// Hash helpers — must mirror audit.append_ledger_entry exactly
// ---------------------------------------------------------------------------

/** SHA-256(buf) → Buffer */
function sha256(buf) {
  return createHash('sha256').update(buf).digest()
}

/**
 * Genesis hash: SHA-256('GENESIS:' + chainId)
 * Mirrors: audit.genesis_hash(p_chain_id) in SQL
 */
function genesisHash(chainId) {
  return sha256(Buffer.from('GENESIS:' + chainId, 'utf8'))
}

/**
 * Row hash:
 *   SHA-256(
 *     prev_hash
 *     || SHA-256(chain_id)
 *     || SHA-256(seq_as_string)
 *     || SHA-256(envelope::text)
 *     || coalesce(payload_mac, \x00)
 *   )
 * Mirrors: audit.append_ledger_entry() in SQL
 */
function computeRowHash(prevHashBuf, chainId, seq, envelopeText, payloadMacBuf) {
  const h = createHash('sha256')
  h.update(prevHashBuf)
  h.update(sha256(Buffer.from(chainId, 'utf8')))
  h.update(sha256(Buffer.from(String(seq), 'utf8')))
  h.update(sha256(Buffer.from(envelopeText, 'utf8')))
  h.update(payloadMacBuf ?? Buffer.from([0x00]))
  return h.digest()
}

/**
 * Stage A HMAC-SHA256 signature:
 *   HMAC-SHA256(key = chainId + ':audit_sig', data = row_hash)
 * Mirrors: extensions.hmac(v_row_hash, convert_to(chainId||':audit_sig','UTF8'), 'sha256')
 */
function computeSig(rowHashBuf, chainId) {
  return createHmac('sha256', Buffer.from(chainId + ':audit_sig', 'utf8'))
    .update(rowHashBuf)
    .digest()
}

/** Constant-time Buffer comparison */
function bufEq(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) return false
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Postgres bytea hex string → Buffer (strips leading \x if present) */
function hexToBuffer(hex) {
  if (!hex) return null
  const s = hex.startsWith('\\x') ? hex.slice(2) : hex
  return Buffer.from(s, 'hex')
}

// ---------------------------------------------------------------------------
// DB access via psql Docker exec (no pg package dependency)
// ---------------------------------------------------------------------------
function queryPsql(sql) {
  const selectSql = `SELECT json_agg(q) FROM (${sql.replace(/;\s*$/, '')}) q;`
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'nut-04-checkout-tool-postgres-1',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      selectSql,
    ],
    { encoding: 'utf8', timeout: 30000 },
  )
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr || result.stdout}`)
  }
  const out = result.stdout.trim()
  if (!out || out.toLowerCase() === 'null') return []
  return JSON.parse(out)
}

async function fetchChainRows(chainId) {
  const where = chainId ? `WHERE chain_id = '${chainId}'::uuid` : ''
  return queryPsql(
    `SELECT chain_id::text, seq, event_id::text,
            encode(prev_hash, 'hex') AS prev_hash,
            encode(row_hash,  'hex') AS row_hash,
            encode(signature, 'hex') AS signature,
            envelope::text           AS envelope,
            encode(payload_mac,'hex') AS payload_mac
     FROM audit.ledger
     ${where}
     ORDER BY chain_id, seq`,
  )
}

async function fetchCheckpoints(chainId) {
  const where = chainId ? `WHERE chain_id = '${chainId}'::uuid` : ''
  return queryPsql(
    `SELECT chain_id::text, seq_from, seq_to,
            encode(merkle_root,'hex') AS merkle_root,
            anchor_uri
     FROM audit.checkpoints
     ${where}
     ORDER BY chain_id, seq_to`,
  )
}

// ---------------------------------------------------------------------------
// Verification logic
// ---------------------------------------------------------------------------
function verifyChain(chainId, rows) {
  const errors = []

  if (rows.length === 0) {
    errors.push(`[WARN] chain ${chainId}: no rows`)
    return errors
  }

  // 1. Gapless sequence starting at 0
  rows.forEach((row, idx) => {
    if (Number(row.seq) !== idx) {
      errors.push(
        `[BREACH] chain ${chainId}: sequence gap — expected seq ${idx} at position ${idx}, got seq ${row.seq}`,
      )
    }
  })

  // 2. Walk chain: recompute prev_hash, row_hash, signature
  let expectedPrevHash = genesisHash(chainId)

  for (const row of rows) {
    const prevHashBuf = hexToBuffer(row.prev_hash)
    const rowHashBuf = hexToBuffer(row.row_hash)
    const sigBuf = hexToBuffer(row.signature)
    const payloadMac = row.payload_mac ? hexToBuffer(row.payload_mac) : null

    // a) prev_hash must match
    if (!bufEq(prevHashBuf, expectedPrevHash)) {
      errors.push(
        `[BREACH] chain ${chainId} seq ${row.seq}: prev_hash mismatch — ` +
          `stored ${row.prev_hash}, expected ${expectedPrevHash.toString('hex')}`,
      )
    }

    // b) row_hash must be correctly computed
    const computedRowHash = computeRowHash(prevHashBuf, chainId, row.seq, row.envelope, payloadMac)
    if (!bufEq(rowHashBuf, computedRowHash)) {
      errors.push(
        `[BREACH] chain ${chainId} seq ${row.seq}: row_hash tampered — ` +
          `stored ${row.row_hash}, computed ${computedRowHash.toString('hex')}`,
      )
    }

    // c) signature must match Stage A HMAC
    const computedSig = computeSig(rowHashBuf, chainId)
    if (!bufEq(sigBuf, computedSig)) {
      errors.push(`[BREACH] chain ${chainId} seq ${row.seq}: signature invalid`)
    }

    // Advance chain pointer
    expectedPrevHash = rowHashBuf
  }

  return errors
}

function verifyCheckpoints(chainId, rows, checkpoints) {
  const errors = []

  for (const cp of checkpoints) {
    if (cp.chain_id !== chainId) continue

    const range = rows.filter((r) => Number(r.seq) >= cp.seq_from && Number(r.seq) <= cp.seq_to)

    // Compute expected merkle root as SHA-256(concat of row_hashes in range)
    const h = createHash('sha256')
    for (const r of range) {
      h.update(hexToBuffer(r.row_hash))
    }
    const expectedMerkle = h.digest().toString('hex')

    if (cp.merkle_root !== expectedMerkle) {
      errors.push(
        `[BREACH] chain ${chainId} checkpoint seq_to=${cp.seq_to}: ` +
          `merkle_root mismatch — stored ${cp.merkle_root}, computed ${expectedMerkle}`,
      )
    }

    // Warn if anchor_uri is a placeholder
    if (cp.anchor_uri.startsWith('local://') || cp.anchor_uri === '') {
      console.warn(
        `[WARN] chain ${chainId} checkpoint seq_to=${cp.seq_to}: ` +
          `anchor_uri is a local placeholder: ${cp.anchor_uri}`,
      )
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Full mode
// ---------------------------------------------------------------------------
async function runFull() {
  console.log(`[INFO] verify-audit-chain full mode — DB: ${DB_URL}`)

  let allRows, allCheckpoints

  try {
    allRows = await fetchChainRows(CHAIN_ID)
    allCheckpoints = await fetchCheckpoints(CHAIN_ID)
  } catch (err) {
    console.error('[ERROR] DB fetch failed:', err.message)
    exit(2)
  }

  // Export if requested
  if (EXPORT_ONLY) {
    writeFileSync(
      EXPORT_ONLY,
      JSON.stringify({ rows: allRows, checkpoints: allCheckpoints }, null, 2),
    )
    console.log(`[INFO] exported chain data to ${EXPORT_ONLY}`)
    exit(0)
  }

  // Group by chain_id
  const chains = {}
  for (const row of allRows) {
    ;(chains[row.chain_id] ??= []).push(row)
  }

  let totalErrors = 0

  for (const [chainId, rows] of Object.entries(chains)) {
    const chainErrors = verifyChain(chainId, rows)
    const cpErrors = verifyCheckpoints(chainId, rows, allCheckpoints)
    const allErrors = [...chainErrors, ...cpErrors]

    if (allErrors.length === 0) {
      console.log(`[OK] chain ${chainId}: ${rows.length} rows verified ✓`)
    } else {
      allErrors.forEach((e) => console.error(e))
      totalErrors += allErrors.length
    }
  }

  if (totalErrors > 0) {
    console.error(
      `\n[SEVERITY-1 BREACH ALERT] ${totalErrors} integrity violation(s) detected. ` +
        `72-hour breach clock assessment STARTED. Escalate immediately.`,
    )
    exit(1)
  }

  console.log(`\n[OK] all ${Object.keys(chains).length} chain(s) verified successfully.`)
  exit(0)
}

// ---------------------------------------------------------------------------
// Offline mode
// ---------------------------------------------------------------------------
async function runOffline() {
  if (!EXPORT_FILE) {
    console.error('[ERROR] --mode=offline requires --export=<json-file>')
    exit(2)
  }

  console.log(`[INFO] verify-audit-chain offline mode — file: ${EXPORT_FILE}`)

  let data
  try {
    data = JSON.parse(readFileSync(EXPORT_FILE, 'utf8'))
  } catch (err) {
    console.error('[ERROR] Cannot read export file:', err.message)
    exit(2)
  }

  const { rows: allRows, checkpoints: allCheckpoints } = data

  const chains = {}
  for (const row of allRows) {
    ;(chains[row.chain_id] ??= []).push(row)
  }

  let totalErrors = 0

  for (const [chainId, rows] of Object.entries(chains)) {
    const chainErrors = verifyChain(chainId, rows)
    const cpErrors = verifyCheckpoints(chainId, rows, allCheckpoints ?? [])
    const allErrors = [...chainErrors, ...cpErrors]

    if (allErrors.length === 0) {
      console.log(`[OK] chain ${chainId}: ${rows.length} rows verified ✓`)
    } else {
      allErrors.forEach((e) => console.error(e))
      totalErrors += allErrors.length
    }
  }

  if (totalErrors > 0) {
    console.error(
      `\n[SEVERITY-1 BREACH ALERT] ${totalErrors} integrity violation(s) detected. ` +
        `72-hour breach clock assessment STARTED. Escalate immediately.`,
    )
    exit(1)
  }

  console.log(`\n[OK] all ${Object.keys(chains).length} chain(s) verified successfully (offline).`)
  exit(0)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
if (MODE === 'offline') {
  runOffline().catch((err) => {
    console.error(err)
    exit(2)
  })
} else {
  runFull().catch((err) => {
    console.error(err)
    exit(2)
  })
}
