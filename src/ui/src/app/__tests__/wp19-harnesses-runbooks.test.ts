/**
 * src/ui/src/app/__tests__/wp19-harnesses-runbooks.test.ts
 *
 * WP-19: Phase 2 Harnesses, Automated Fire Drills & Operational Runbooks Suite
 * References: Blueprint §5.2 (Shadow & Parity), §5.5 (DoD), §3.4 (N4), §3.7 (N7), §3.8 (N8).
 *
 * Invariants Tested:
 *   1. Automated Fire Drill 1 (T-10): Cryptographic audit ledger tamper detection (first_bad_seq pinpointed).
 *   2. Automated Fire Drill 2 (T-13 / §5.3): Latency spike (> 200 ms) automated rollback of scanner/nme flags.
 *   3. Automated Fire Drill 3 (G-08 / §3.8): Retailer selector failure (> 2%) kill-switch actuation.
 *   4. Automated Fire Drill 4 (§3.4): Controller heartbeat timeout (> 10m) fail-static lockdown.
 *   5. Automated Fire Drill 5 (§2.1, E-01..E-07): Scoring Gate 2 completeness and ReviewState gating.
 *   6. Comprehensive Fire Drill Suite: runAllFireDrills() execution and aggregate reporting.
 *   7. Operational Runbooks Coverage: validates existence and completeness of rollback protocols.
 */

import { describe, it, expect } from 'vitest'
import {
  runAuditTamperDrill,
  runLatencyRollbackDrill,
  runSelectorKillSwitchDrill,
  runControllerSilentDrill,
  runScoringParityDrill,
  runAllFireDrills,
} from '../../../../../scripts/fire-drill-runner.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('WP-19: Phase 2 Harnesses, Fire Drills & Runbooks Suite', () => {
  // ── 1. Audit Ledger Tamper Detection (T-10) ──────────────────────────────

  describe('1. Audit Ledger Tamper Detection (T-10 Drill)', () => {
    it('detects single-byte row tampering and pinpoints exact sequence index', () => {
      const result = runAuditTamperDrill()
      expect(result.drill).toBe('AUDIT_TAMPER_T10')
      expect(result.passed).toBe(true)
      expect(result.baselineStatus).toBe('verified')
      expect(result.tamperedStatus).toBe('failed')
      expect(result.firstBadSeq).toBe(5)
      expect(result.reason).toContain('seq 5')
    })
  })

  // ── 2. Latency Spike & Automated Rollback ────────────────────────────────

  describe('2. Latency Spike & Automated Rollback (T-13 Drill)', () => {
    it('automatically rolls back feature flag when badge latency P95 > 200 ms', () => {
      const result = runLatencyRollbackDrill()
      expect(result.drill).toBe('LATENCY_ROLLBACK')
      expect(result.passed).toBe(true)
      expect(result.initialCohort).toBe(10) // Stage 2
      expect(result.rolledBackCohort).toBe(1) // Stage 1
      expect(result.actionsTaken).toContain('ROLLBACK:ns.scanner.v2')
      expect(result.breaches.some((b: any) => b.type === 'LATENCY_CRITICAL')).toBe(true)
    })
  })

  // ── 3. Selector Failure & Kill-Switch Actuation ──────────────────────────

  describe('3. Selector Failure & Kill-Switch Actuation (G-08 Drill)', () => {
    it('detects retailer failure above 2% threshold and actuates killSwitch', () => {
      const result = runSelectorKillSwitchDrill()
      expect(result.drill).toBe('SELECTOR_KILL_SWITCH')
      expect(result.passed).toBe(true)
      expect(result.retailer).toBe('quickmart')
      expect(result.failureRate).toBe(0.1) // 10%
      expect(result.breached).toBe(true)
      expect(result.killSwitchRecommended).toBe(true)
    })
  })

  // ── 4. Fail-Static Silent Controller ─────────────────────────────────────

  describe('4. Fail-Static Silent Controller Drill', () => {
    it('halts flag mutations and reports CONTROLLER_SILENT when inactive > 10m', () => {
      const result = runControllerSilentDrill()
      expect(result.drill).toBe('FAIL_STATIC_SILENT_CONTROLLER')
      expect(result.passed).toBe(true)
      expect(result.initialStatus).toBe('ACTIVE')
      expect(result.postTimeoutStatus).toBe('CONTROLLER_SILENT')
      expect(result.elapsedMs).toBeGreaterThan(600000)
    })
  })

  // ── 5. Scoring v5 Negative Completeness & Gating ─────────────────────────

  describe('5. Scoring v5 Parity & Gate 2 Completeness Drill', () => {
    it('enforces strict 4-nutrient completeness (no zero-fill) and unreviewed gating', () => {
      const result = runScoringParityDrill()
      expect(result.drill).toBe('SCORING_PARITY_GATE2')
      expect(result.passed).toBe(true)
      expect(result.incompleteStatus).toBe('INSUFFICIENT_DATA')
      expect(result.gate2Missing).toContain('sugars')
      expect(result.unreviewedStatus).toBe('INSUFFICIENT_DATA')
      expect(result.unreviewedTier).toBe('not_rated')
    })
  })

  // ── 6. Aggregate Fire Drill Suite Execution ──────────────────────────────

  describe('6. Aggregate Fire Drill Suite Execution', () => {
    it('executes full fire drill suite and achieves 100% pass rate', () => {
      const summary = runAllFireDrills()
      expect(summary.allPassed).toBe(true)
      expect(summary.totalDrills).toBe(5)
      expect(summary.passedCount).toBe(5)
      expect(summary.failedCount).toBe(0)
      expect(summary.drills.length).toBe(5)
    })
  })

  // ── 7. Operational Runbooks Coverage & Alignment ─────────────────────────

  describe('7. Operational Runbooks Alignment', () => {
    const root = process.cwd()
    const rollbackPath = resolve(root, 'docs/operations/rollback-procedures.md')
    const envRunbookPath = resolve(root, 'docs/operations/environment-runbook.md')

    it('confirms rollback-procedures.md contains SEV1-3 classification and Canary rollback protocols', () => {
      expect(existsSync(rollbackPath)).toBe(true)
      const content = readFileSync(rollbackPath, 'utf8')
      expect(content).toContain('Incident Severity Classification')
      expect(content).toContain('Database Migration Rollback')
      expect(content).toContain('Docker Microservice Rollback')
    })

    it('confirms environment-runbook.md exists and contains verified operational procedures', () => {
      expect(existsSync(envRunbookPath)).toBe(true)
      const content = readFileSync(envRunbookPath, 'utf8')
      expect(content).toContain('Developer Environment & Operational Runbook')
      expect(content).toContain('Starting the Full Stack & Pre-Flight Checks')
    })
  })
})
