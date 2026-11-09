#!/usr/bin/env node
/**
 * NutriScore CAD Phase 9 — Retention Purge Engine (Decision D5)
 *
 * Reference: Blueprint §4.1, Decision D5, Amendment A2
 *
 * Implements automated, fail-safe retention purge:
 * 1. Dry run by default (--execute required to perform actual deletion).
 * 2. Fail-safe: Refuses to purge any class without an explicit retain_years policy.
 * 3. Fail-safe: Blocks purge if legal_hold is true.
 * 4. Writes RETENTION_PURGE_PLAN / RETENTION_PURGE_EXECUTED to audit.worm_ledger.
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function queryPsql(sql) {
  try {
    return execFileSync(
      'docker',
      [
        'exec',
        '-i',
        'supabase_db_NUT-04_Checkout_Tool',
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-t',
        '-A',
        '-c',
        sql,
      ],
      { encoding: 'utf8' },
    ).trim()
  } catch (err) {
    throw new Error(`psql query failed: ${err.stderr || err.message}`, { cause: err })
  }
}

export function evaluatePurgeEligibility(policy, records = []) {
  if (!policy) {
    throw new Error('Refusing to purge: No retention policy configured (fail-safe rule D5)')
  }

  if (policy.retain_years === null || policy.retain_years === undefined) {
    throw new Error(
      `Refusing to purge class '${policy.record_class}': retain_years is NULL (purge forbidden until counsel provides basis)`,
    )
  }

  if (policy.legal_hold === true) {
    return {
      status: 'BLOCKED',
      reason: 'Legal hold is active',
      eligibleCount: 0,
      eligibleRecords: [],
    }
  }

  const now = Date.now()
  const cutoffMs = now - policy.retain_years * 365.25 * 24 * 60 * 60 * 1000

  const eligible = records.filter((r) => {
    const recordTime = new Date(r.timestamp || r.placed_at || r.deactivated_at || 0).getTime()
    return recordTime < cutoffMs
  })

  return {
    status: 'ELIGIBLE',
    cutoff: new Date(cutoffMs).toISOString(),
    eligibleCount: eligible.length,
    eligibleRecords: eligible,
  }
}

export async function runRetentionPurge(options = {}) {
  const tenantId = options.tenantId || '11111111-1111-1111-1111-111111111111'
  const recordClass = options.recordClass || 'commercial_orders'
  const dryRun = options.dryRun ?? true

  console.log(`[purge] Checking retention policy for tenant ${tenantId}, class: ${recordClass}`)
  console.log(`[purge] Execution mode: ${dryRun ? 'DRY-RUN (default)' : 'ACTIVE EXECUTION'}`)

  const sql = `SELECT clinical.execute_retention_purge('${tenantId}', '${recordClass}', ${dryRun});`

  const resultJson = queryPsql(sql)
  const result = JSON.parse(resultJson)

  console.log('[purge] Result:', JSON.stringify(result, null, 2))
  return result
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const execute = process.argv.includes('--execute')
  const dryRun = !execute

  const tenantArg = process.argv.find((a) => a.startsWith('--tenant-id='))
  const tenantId = tenantArg ? tenantArg.split('=')[1] : '11111111-1111-1111-1111-111111111111'

  const classArg = process.argv.find((a) => a.startsWith('--record-class='))
  const recordClass = classArg ? classArg.split('=')[1] : 'commercial_orders'

  runRetentionPurge({ tenantId, recordClass, dryRun })
    .then(() => {
      console.log('[purge] Completed successfully.')
      process.exit(0)
    })
    .catch((err) => {
      console.error('[purge] Aborted:', err.message)
      process.exit(1)
    })
}
