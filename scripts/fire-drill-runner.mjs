#!/usr/bin/env node
/**
 * scripts/fire-drill-runner.mjs
 *
 * Automated Fire Drill & Phase 2 Parity Verification Runner.
 * References: Blueprint §3.4 (N4), §3.7 (N7), §3.8 (N8), §5.2 (Shadow & Parity), §5.5 (DoD).
 *
 * Drill Scenarios Tested:
 *   1. Audit Ledger Tamper Detection (T-10): verifies cryptographic hash chain detects altered row.
 *   2. Latency Spike & Automated Rollback: verifies P95 > 200ms triggers automated flag rollback.
 *   3. Selector Failure & Retailer Kill-Switch: verifies failure > 2% actuates retailer kill-switch.
 *   4. Fail-Static Silent Controller: verifies controller silence > 10m freezes mutations.
 *   5. Scoring v5 Parity & Gate 2 Completeness: asserts strict nutrient completeness and ReviewState gating.
 */

import { verifyAuditLedger, computeRowHash } from '../services/api/src/audit/verifier.mjs'
import { CanaryController } from '../services/api/src/canary/controller.mjs'
import { runSelectorCanary } from './verify-selector-canary.mjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
require('../src/extension/db.js')
const { evaluateItem } = globalThis.NutriScoreDB

/**
 * Drill 1: Audit Ledger Tamper Detection (T-10)
 * Modifies one stored audit entry and verifies immediate tamper detection.
 */
export function runAuditTamperDrill() {
  const sampleEntries = []
  let prevHash = '0000000000000000000000000000000000000000000000000000000000000000'

  for (let seq = 1; seq <= 10; seq++) {
    const entry = {
      seq,
      ts: 1700000000000 + seq * 1000,
      actor_ref: 'usr-admin-01',
      action: 'policy.evaluate',
      resource_ref: `pol-${seq}`,
      decision: 'allow',
      trace_id: `trace-${seq}`,
      obj_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      prev_hash: prevHash,
    }
    entry.row_hash = computeRowHash(entry, prevHash)
    prevHash = entry.row_hash
    sampleEntries.push(entry)
  }

  // Baseline verification: perfectly linked chain
  const cleanResult = verifyAuditLedger(sampleEntries)
  if (cleanResult.status !== 'verified') {
    throw new Error(`Baseline audit chain unexpectedly failed: ${cleanResult.reason}`)
  }

  // Inject Tamper: alter payload / action of entry #5
  const tamperedEntries = JSON.parse(JSON.stringify(sampleEntries))
  tamperedEntries[4].action = 'policy.bypass_tampered'

  const tamperedResult = verifyAuditLedger(tamperedEntries)

  return {
    drill: 'AUDIT_TAMPER_T10',
    passed: tamperedResult.status === 'failed' && tamperedResult.first_bad_seq === 5,
    baselineStatus: cleanResult.status,
    tamperedStatus: tamperedResult.status,
    firstBadSeq: tamperedResult.first_bad_seq,
    reason: tamperedResult.reason,
  }
}

/**
 * Drill 2: Latency Spike & Automated Rollback
 * Injects P95 > 200ms latency breach and asserts automated rollback of scanner/nme flags.
 */
export function runLatencyRollbackDrill() {
  const controller = new CanaryController({
    initialSeq: 1,
  })

  // Promote scanner flag to Stage 2 (10%)
  controller.setFlagCohort('ns.scanner.v2', 2, 'Pre-drill promotion', true)
  const initialCohort = controller.getFlag('ns.scanner.v2').cohort_pct

  // Inject Latency Spike (> 200 ms)
  const evalResult = controller.evaluateMetrics({
    batches_count: 350,
    badge_ms_p95: 240,
  })

  const rolledBackCohort = controller.getFlag('ns.scanner.v2').cohort_pct

  return {
    drill: 'LATENCY_ROLLBACK',
    passed:
      !evalResult.healthy &&
      evalResult.actionsTaken.includes('ROLLBACK:ns.scanner.v2') &&
      rolledBackCohort < initialCohort,
    initialCohort,
    rolledBackCohort,
    actionsTaken: evalResult.actionsTaken,
    breaches: evalResult.breaches,
  }
}

/**
 * Drill 3: Selector Failure & Kill-Switch Actuation
 * Simulates a retailer markup failure (> 2%) and verifies automated kill-switch actuation.
 */
export function runSelectorKillSwitchDrill() {
  const canaryReport = runSelectorCanary({
    cardsPerRetailer: 50,
    simulatedErrors: {
      quickmart: 5, // 10% failure (> 2% threshold)
    },
  })

  const qm = canaryReport.retailers.quickmart

  return {
    drill: 'SELECTOR_KILL_SWITCH',
    passed: qm.breached && qm.killSwitchRecommended && !canaryReport.healthy,
    retailer: 'quickmart',
    failureRate: qm.failureRate,
    breached: qm.breached,
    killSwitchRecommended: qm.killSwitchRecommended,
  }
}

/**
 * Drill 4: Fail-Static Silent Controller
 * Advances time past the 10-minute heartbeat timeout and asserts controller fails static.
 */
export function runControllerSilentDrill() {
  let currentTime = 1700000000000
  const controller = new CanaryController({
    nowFn: () => currentTime,
  })

  const initialStatus = controller.getHeartbeatStatus()

  // Advance time by 11 minutes (exceeding 10m timeout)
  currentTime += 11 * 60 * 1000
  const silentStatus = controller.getHeartbeatStatus()

  return {
    drill: 'FAIL_STATIC_SILENT_CONTROLLER',
    passed:
      initialStatus.healthy && !silentStatus.healthy && silentStatus.status === 'CONTROLLER_SILENT',
    initialStatus: initialStatus.status,
    postTimeoutStatus: silentStatus.status,
    elapsedMs: silentStatus.elapsedMs,
  }
}

/**
 * Drill 5: Scoring v5 Gate 2 Completeness & ReviewState Gating
 * Asserts strict compliance with negative completeness and review state requirements.
 */
export function runScoringParityDrill() {
  // Test product missing sugar (violates Gate 2: energy, sodium, satFat, sugar all mandatory)
  const productMissingSugar = {
    Identity: { ProductID: 'drill-prod-01', ProductName: 'Sample Item 500g' },
    Nutrition: {
      EnergyKcal: 150,
      SodiumMG: 120,
      SaturatedFatG: 2.5,
      // SugarsG intentionally omitted
    },
    ReviewState: 'CONFIRMED',
  }

  const resultIncomplete = evaluateItem(productMissingSugar, null, {
    now: 1700000000000,
    bypassCache: true,
  })

  // Test product with unreviewed review state (RAW)
  const productUnreviewed = {
    Identity: { ProductID: 'drill-prod-02', ProductName: 'Unreviewed Item 500g' },
    Nutrition: {
      EnergyKcal: 150,
      SodiumMG: 120,
      SaturatedFatG: 2.5,
      SugarsG: 5.0,
    },
    ReviewState: 'RAW',
  }

  const resultUnreviewed = evaluateItem(productUnreviewed, null, {
    now: 1700000000000,
    bypassCache: true,
  })

  return {
    drill: 'SCORING_PARITY_GATE2',
    passed:
      resultIncomplete.status === 'INSUFFICIENT_DATA' &&
      resultIncomplete.missing?.includes('sugars') &&
      resultUnreviewed.status === 'INSUFFICIENT_DATA' &&
      resultUnreviewed.tier === 'not_rated',
    incompleteStatus: resultIncomplete.status,
    gate2Missing: resultIncomplete.missing,
    unreviewedStatus: resultUnreviewed.status,
    unreviewedTier: resultUnreviewed.tier,
  }
}

/**
 * Executes the full automated fire drill suite.
 */
export function runAllFireDrills() {
  const results = [
    runAuditTamperDrill(),
    runLatencyRollbackDrill(),
    runSelectorKillSwitchDrill(),
    runControllerSilentDrill(),
    runScoringParityDrill(),
  ]

  const allPassed = results.every((r) => r.passed)

  return {
    timestamp: new Date().toISOString(),
    allPassed,
    totalDrills: results.length,
    passedCount: results.filter((r) => r.passed).length,
    failedCount: results.filter((r) => !r.passed).length,
    drills: results,
  }
}

// CLI Execution Entrypoint
const isMain = process.argv[1] && process.argv[1].endsWith('fire-drill-runner.mjs')
if (isMain) {
  console.log('[FireDrill] Running Phase 2 Automated Fire Drill Suite...')
  const summary = runAllFireDrills()
  console.log(JSON.stringify(summary, null, 2))

  if (summary.allPassed) {
    console.log(`\n[FireDrill OK] All ${summary.totalDrills} operational fire drills PASSED.`)
    process.exit(0)
  } else {
    console.error(`\n[FireDrill FAILED] ${summary.failedCount} drill(s) failed.`)
    process.exit(1)
  }
}
