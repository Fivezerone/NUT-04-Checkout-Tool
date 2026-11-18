/**
 * services/api/src/canary/controller.mjs
 *
 * Closed-Loop Canary Controller & Automated SLO Evaluator.
 * References: Blueprint §3.4 (N4), §3.8 (N8), §5.3 (Phase 3 Cutover).
 *
 * Responsibilities:
 *   1. Enforces strict Flag Name Allowlist (no arbitrary mutation of scoring constants or clinical policies).
 *   2. Manages progressive cohort progression: Stage 0 (0%/allow_ids) -> 1 (1%) -> 2 (10%) -> 3 (50%) -> 4 (100%).
 *   3. Enforces 15-minute cooldown & hysteresis to eliminate rollout flapping.
 *   4. Evaluates Google SRE Workbook multi-window burn rates (14.4x fast burn, 6.0x slow burn).
 *   5. Executes automated fail-soft/fail-closed rollbacks against §5.3 triggers:
 *      - Latency breaches (badge_ms P95 > 200ms or 3x > 120ms)
 *      - Neutral-fallback rate elevation (> 3pp above baseline and > 5% total)
 *      - Evaluation error rate (> 0.5%)
 *      - Service worker RPC failure (> 2%)
 *      - Unexplained grade distribution shifts (> 2pp)
 *      - Unresolved safety events or false-block reports (> 1%)
 *      - Catalogue integrity failures (> 0.1%)
 *      - Telemetry ingestion degradation (ack P99 > 300ms, rejects > 2%, dupes > 1%)
 *      - BFF 5xx rate (> 0.5%)
 *      - SSE resync rate (> 5%) or latency (> 5s)
 *      - Selector health failure (> 2%) setting retailer killSwitch
 *   6. Enforces Fail-Static Heartbeat (alerts and halts if controller silent > 10 min).
 *   7. Re-mints and signs FlagManifest with strictly increasing monotonic seq.
 */

import { generateKeyPairSync } from 'node:crypto'
import { mintFlagManifest } from '../../../../scripts/publish-flags.mjs'

export const ALLOWED_FLAGS = Object.freeze([
  'ns.scanner.v2',
  'ns.ui.closed_shadow',
  'ns.catalog.verify_v2',
  'ns.telemetry.v2',
  'ns.nme.v2',
  'ns.ledger.v2',
  'ns.scoring.v5',
  'ns.policy.v2',
  'ns.token.v2',
  'ns.bff.enforce',
  'ns.cad.bff_client',
  'ns.sse',
  'ns.adapter.core.quickmart',
  'ns.adapter.core.naivas',
  'ns.adapter.core.carrefour',
])

export const COHORT_STAGES = Object.freeze([0, 1, 10, 50, 100])

// Soak durations in minutes (§5.3):
// Stage 0: 3 days (4320m), Stage 1: 48h (2880m), Stage 2: 72h (4320m), Stage 3: 72h (4320m), Stage 4: 7 days (10080m)
export const STAGE_SOAK_MINUTES = Object.freeze({
  0: 4320,
  1: 2880,
  2: 4320,
  3: 4320,
  4: 10080,
})

export const MIN_BATCHES_FOR_EVAL = 200
export const COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes
export const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

export class CanaryController {
  constructor(options = {}) {
    this.allowedFlags = new Set(ALLOWED_FLAGS)
    this.nowFn = options.nowFn || (() => Date.now())

    // Private key for signing flag manifests (generated or supplied)
    if (options.privateKey) {
      this.privateKey = options.privateKey
    } else {
      const generated = generateKeyPairSync('ed25519')
      this.privateKey = generated.privateKey
      this.publicKey = generated.publicKey
    }

    this.kid = options.kid || 'flags-root-2026-q4'
    this.seq = Number(options.initialSeq || 1)
    this.frozen = false
    this.freezeReason = null
    this.lastActionTimestamp = 0
    this.lastHeartbeatTimestamp = this.nowFn()
    this.auditLog = options.auditLog || []

    // State tracking for consecutive breach windows
    this.badgeLatencyConsecutiveBreaches = 0
    this.neutralFallbackConsecutiveBreaches = 0

    // Initialize flags state
    this.flags = {}
    this.flagStages = {}
    this.stagePromotedAt = {}

    for (const flagName of ALLOWED_FLAGS) {
      const initialPct = options.initialFlags?.[flagName]?.cohort_pct ?? 0
      const initialEnabled = options.initialFlags?.[flagName]?.enabled ?? false
      const allowIds = options.initialFlags?.[flagName]?.allow_ids || []
      const minExtVer = options.initialFlags?.[flagName]?.min_ext_ver

      this.flags[flagName] = {
        enabled: initialEnabled,
        cohort_pct: initialPct,
        ...(allowIds.length ? { allow_ids: allowIds } : {}),
        ...(minExtVer ? { min_ext_ver: minExtVer } : {}),
      }

      const stageIdx = COHORT_STAGES.indexOf(initialPct)
      this.flagStages[flagName] = stageIdx >= 0 ? stageIdx : 0
      this.stagePromotedAt[flagName] = this.nowFn()
    }

    // Sign initial manifest
    this.currentManifest = this._mintCurrentManifest()
  }

  touchHeartbeat() {
    this.lastHeartbeatTimestamp = this.nowFn()
  }

  getHeartbeatStatus() {
    const elapsed = this.nowFn() - this.lastHeartbeatTimestamp
    const silent = elapsed > HEARTBEAT_TIMEOUT_MS
    return {
      healthy: !silent,
      elapsedMs: elapsed,
      timeoutMs: HEARTBEAT_TIMEOUT_MS,
      status: silent ? 'CONTROLLER_SILENT' : 'ACTIVE',
    }
  }

  isCooldownActive() {
    return this.nowFn() - this.lastActionTimestamp < COOLDOWN_MS
  }

  getCooldownRemainingMs() {
    const remaining = COOLDOWN_MS - (this.nowFn() - this.lastActionTimestamp)
    return Math.max(0, remaining)
  }

  freeze(reason) {
    this.frozen = true
    this.freezeReason = reason
    this._recordAudit('FREEZE', { reason })
  }

  unfreeze(reason) {
    this.frozen = false
    this.freezeReason = null
    this._recordAudit('UNFREEZE', { reason })
  }

  getFlag(name) {
    if (!this.allowedFlags.has(name)) {
      throw new Error(`Flag '${name}' is not in the allowed flag registry`)
    }
    return { ...this.flags[name] }
  }

  setFlagCohort(name, stageIndex, reason, bypassCooldown = false) {
    if (!this.allowedFlags.has(name)) {
      throw new Error(`Rejected flag modification: '${name}' is not an allowlisted feature flag`)
    }
    if (this.frozen) {
      throw new Error(`Cannot modify flag '${name}': controller is frozen (${this.freezeReason})`)
    }
    if (!bypassCooldown && this.isCooldownActive()) {
      throw new Error(
        `Rollout cooldown active (${Math.round(this.getCooldownRemainingMs() / 1000)}s remaining). Action rejected to prevent flapping.`,
      )
    }
    if (stageIndex < 0 || stageIndex >= COHORT_STAGES.length) {
      throw new RangeError(
        `Invalid stage index ${stageIndex}. Must be 0..${COHORT_STAGES.length - 1}`,
      )
    }

    const newPct = COHORT_STAGES[stageIndex]
    const oldStage = this.flagStages[name]
    const oldPct = this.flags[name].cohort_pct

    this.flagStages[name] = stageIndex
    this.flags[name].cohort_pct = newPct
    this.flags[name].enabled = stageIndex > 0 || (this.flags[name].allow_ids?.length ?? 0) > 0
    this.stagePromotedAt[name] = this.nowFn()
    this.lastActionTimestamp = this.nowFn()
    this.seq += 1

    this.currentManifest = this._mintCurrentManifest()
    this._recordAudit('PROMOTION', {
      flag: name,
      fromStage: oldStage,
      toStage: stageIndex,
      fromPct: oldPct,
      toPct: newPct,
      reason,
    })

    return this.currentManifest
  }

  rollbackFlag(name, reason, emergencyBypass = false) {
    if (!this.allowedFlags.has(name)) {
      throw new Error(`Rejected rollback: '${name}' is not an allowlisted feature flag`)
    }
    if (!emergencyBypass && this.isCooldownActive()) {
      throw new Error('Rollout cooldown active')
    }

    const currentStage = this.flagStages[name]
    const targetStage = Math.max(0, currentStage - 1)
    const newPct = COHORT_STAGES[targetStage]

    this.flagStages[name] = targetStage
    this.flags[name].cohort_pct = newPct
    if (
      targetStage === 0 &&
      (!this.flags[name].allow_ids || this.flags[name].allow_ids.length === 0)
    ) {
      this.flags[name].enabled = false
    }

    this.stagePromotedAt[name] = this.nowFn()
    this.lastActionTimestamp = this.nowFn()
    this.seq += 1

    this.currentManifest = this._mintCurrentManifest()
    this._recordAudit('ROLLBACK', {
      flag: name,
      fromStage: currentStage,
      toStage: targetStage,
      newPct,
      reason,
    })

    return this.currentManifest
  }

  /**
   * Evaluates Google SRE Workbook multi-window burn rate math.
   * Target availability/accuracy SLO: 99.5% (error budget = 0.5% / 0.005).
   * Fast burn: 14.4x consumption over both 1h and 5m windows -> Page + Revert.
   * Slow burn: 6.0x consumption over both 6h and 30m windows -> Ticket + Freeze.
   */
  evaluateBurnRate({ errorRate1h, errorRate5m, errorRate6h, errorRate30m, budget = 0.005 }) {
    const fastBurnThreshold = 14.4 * budget // 0.072 (7.2%)
    const slowBurnThreshold = 6.0 * budget // 0.030 (3.0%)

    const isFastBurn =
      typeof errorRate1h === 'number' &&
      typeof errorRate5m === 'number' &&
      errorRate1h >= fastBurnThreshold &&
      errorRate5m >= fastBurnThreshold

    const isSlowBurn =
      typeof errorRate6h === 'number' &&
      typeof errorRate30m === 'number' &&
      errorRate6h >= slowBurnThreshold &&
      errorRate30m >= slowBurnThreshold

    return {
      budget,
      fastBurnThreshold,
      slowBurnThreshold,
      isFastBurn,
      isSlowBurn,
    }
  }

  /**
   * Primary Evaluation Cycle: processes a metrics snapshot against all §5.3 rollback triggers.
   */
  evaluateMetrics(metrics, options = {}) {
    this.touchHeartbeat()
    const actionsTaken = []
    const breaches = []

    const batchesCount = metrics.batches_count ?? 0
    const isEmergency = Boolean(metrics.safety_events_unresolved || metrics.eval_error_rate > 0.02)

    // Check evidence threshold (minimum 200 batches) unless emergency safety event
    if (batchesCount < MIN_BATCHES_FOR_EVAL && !isEmergency && !options.skipMinBatchesCheck) {
      return {
        evaluated: false,
        reason: `Insufficient sample volume: ${batchesCount} batches (minimum: ${MIN_BATCHES_FOR_EVAL})`,
        actionsTaken: [],
        breaches: [],
      }
    }

    // 1. Safety Invariant Check (Blueprint §5.3)
    if (metrics.safety_events_unresolved > 0 || (metrics.false_block_rate ?? 0) > 0.01) {
      const reason = `Safety breach: unresolved events=${metrics.safety_events_unresolved}, false_block_rate=${metrics.false_block_rate}`
      breaches.push({ type: 'SAFETY', detail: reason })
      this.freeze(reason)
      // Revert active high-sensitivity flags
      for (const flag of ['ns.scoring.v5', 'ns.policy.v2', 'ns.token.v2']) {
        if (this.flagStages[flag] > 0) {
          this.rollbackFlag(flag, reason, true)
          actionsTaken.push(`ROLLBACK:${flag}`)
        }
      }
    }

    // 2. Multi-Window Burn Rate Check (§3.4)
    if (metrics.burn_rate) {
      const burn = this.evaluateBurnRate(metrics.burn_rate)
      if (burn.isFastBurn) {
        const reason = `Fast burn rate (14.4x) triggered on error budget`
        breaches.push({ type: 'FAST_BURN', detail: reason })
        this.freeze(reason)
        // Roll back most recently progressed flag
        const activeFlags = Object.keys(this.flagStages).filter((f) => this.flagStages[f] > 0)
        if (activeFlags.length > 0) {
          const lastFlag = activeFlags[activeFlags.length - 1]
          this.rollbackFlag(lastFlag, reason, true)
          actionsTaken.push(`ROLLBACK:${lastFlag}`)
        }
      } else if (burn.isSlowBurn) {
        const reason = `Slow burn rate (6.0x) triggered on error budget`
        breaches.push({ type: 'SLOW_BURN', detail: reason })
        this.freeze(reason)
        actionsTaken.push('FREEZE_ROLLOUTS')
      }
    }

    // 3. Badge Latency Trigger (P95 > 200 ms in any window, or > 120 ms in 3 consecutive)
    if (typeof metrics.badge_ms_p95 === 'number') {
      if (metrics.badge_ms_p95 > 200) {
        const reason = `badge_ms P95 > 200 ms (${metrics.badge_ms_p95} ms)`
        breaches.push({ type: 'LATENCY_CRITICAL', detail: reason })
        for (const flag of ['ns.scanner.v2', 'ns.nme.v2']) {
          if (this.flagStages[flag] > 0) {
            this.rollbackFlag(flag, reason, true)
            actionsTaken.push(`ROLLBACK:${flag}`)
          }
        }
      } else if (metrics.badge_ms_p95 > 120) {
        this.badgeLatencyConsecutiveBreaches += 1
        if (this.badgeLatencyConsecutiveBreaches >= 3) {
          const reason = `badge_ms P95 > 120 ms for 3 consecutive windows (${metrics.badge_ms_p95} ms)`
          breaches.push({ type: 'LATENCY_SUSTAINED', detail: reason })
          for (const flag of ['ns.scanner.v2', 'ns.nme.v2']) {
            if (this.flagStages[flag] > 0) {
              this.rollbackFlag(flag, reason, true)
              actionsTaken.push(`ROLLBACK:${flag}`)
            }
          }
        }
      } else {
        this.badgeLatencyConsecutiveBreaches = 0
      }
    }

    // 4. Neutral-Fallback Rate Trigger (> 3pp above baseline and > 5% total for 2 windows)
    if (typeof metrics.neutral_fallback_rate === 'number') {
      const baseline = metrics.neutral_fallback_baseline ?? 0.02
      if (metrics.neutral_fallback_rate > baseline + 0.03 && metrics.neutral_fallback_rate > 0.05) {
        this.neutralFallbackConsecutiveBreaches += 1
        if (this.neutralFallbackConsecutiveBreaches >= 2) {
          const reason = `neutral_fallback_rate elevated: ${(metrics.neutral_fallback_rate * 100).toFixed(1)}% vs baseline ${(baseline * 100).toFixed(1)}%`
          breaches.push({ type: 'NEUTRAL_FALLBACK', detail: reason })
          for (const flag of ['ns.scoring.v5', 'ns.nme.v2', 'ns.scanner.v2']) {
            if (this.flagStages[flag] > 0) {
              this.rollbackFlag(flag, reason, true)
              actionsTaken.push(`ROLLBACK:${flag}`)
            }
          }
        }
      } else {
        this.neutralFallbackConsecutiveBreaches = 0
      }
    }

    // 5. Evaluation Error Rate (> 0.5%)
    if ((metrics.eval_error_rate ?? 0) > 0.005) {
      const reason = `eval_error_rate > 0.5% (${(metrics.eval_error_rate * 100).toFixed(2)}%)`
      breaches.push({ type: 'EVAL_ERROR', detail: reason })
      for (const flag of ['ns.scoring.v5', 'ns.policy.v2']) {
        if (this.flagStages[flag] > 0) {
          this.rollbackFlag(flag, reason, true)
          actionsTaken.push(`ROLLBACK:${flag}`)
        }
      }
    }

    // 6. Service Worker RPC Fail (> 2%)
    if ((metrics.sw_rpc_fail_rate ?? 0) > 0.02) {
      const reason = `sw_rpc_fail_rate > 2% (${(metrics.sw_rpc_fail_rate * 100).toFixed(2)}%)`
      breaches.push({ type: 'SW_RPC_FAIL', detail: reason })
      if (this.flagStages['ns.scanner.v2'] > 0) {
        this.rollbackFlag('ns.scanner.v2', reason, true)
        actionsTaken.push('ROLLBACK:ns.scanner.v2')
      }
    }

    // 7. Grade Distribution Shift (> 2pp unexplained divergence)
    if ((metrics.grade_distribution_shift ?? 0) > 0.02) {
      const reason = `Unexplained grade distribution shift > 2pp (${(metrics.grade_distribution_shift * 100).toFixed(2)}%)`
      breaches.push({ type: 'GRADE_SHIFT', detail: reason })
      this.freeze(reason)
      if (this.flagStages['ns.scoring.v5'] > 0) {
        this.rollbackFlag('ns.scoring.v5', reason, true)
        actionsTaken.push('ROLLBACK:ns.scoring.v5')
      }
    }

    // 8. Telemetry Ingestion Degradation (ack P99 > 300ms, rejects > 2%, dupes > 1%)
    if (
      (metrics.telemetry_ack_p99_ms ?? 0) > 300 ||
      (metrics.telemetry_schema_reject_rate ?? 0) > 0.02 ||
      (metrics.telemetry_duplicate_rate ?? 0) > 0.01
    ) {
      const reason = `Telemetry ingestion degradation: ackP99=${metrics.telemetry_ack_p99_ms}ms, rejects=${metrics.telemetry_schema_reject_rate}, dupes=${metrics.telemetry_duplicate_rate}`
      breaches.push({ type: 'TELEMETRY_DEGRADED', detail: reason })
      if (this.flagStages['ns.telemetry.v2'] > 0) {
        this.rollbackFlag('ns.telemetry.v2', reason, true)
        actionsTaken.push('ROLLBACK:ns.telemetry.v2')
      }
    }

    // 9. BFF 5xx Rate (> 0.5% over 5m)
    if ((metrics.bff_5xx_rate ?? 0) > 0.005) {
      const reason = `BFF 5xx rate > 0.5% (${(metrics.bff_5xx_rate * 100).toFixed(2)}%)`
      breaches.push({ type: 'BFF_5XX', detail: reason })
      if (this.flagStages['ns.bff.enforce'] > 0) {
        this.rollbackFlag('ns.bff.enforce', reason, true)
        actionsTaken.push('ROLLBACK:ns.bff.enforce')
      }
    }

    // 10. SSE Resync Rate (> 5%) or Delivery Latency (> 5s)
    if ((metrics.sse_resync_rate ?? 0) > 0.05 || (metrics.sse_delivery_p95_ms ?? 0) > 5000) {
      const reason = `SSE degradation: resync_rate=${metrics.sse_resync_rate}, p95=${metrics.sse_delivery_p95_ms}ms`
      breaches.push({ type: 'SSE_DEGRADED', detail: reason })
      if (this.flagStages['ns.sse'] > 0) {
        this.rollbackFlag('ns.sse', reason, true)
        actionsTaken.push('ROLLBACK:ns.sse')
      }
    }

    // 11. Retailer Selector Health Breaches (> 2%)
    if (metrics.retailer_selector_failures) {
      for (const [retailer, failRate] of Object.entries(metrics.retailer_selector_failures)) {
        if (failRate > 0.02) {
          const reason = `Selector failure rate > 2% for ${retailer} (${(failRate * 100).toFixed(1)}%)`
          breaches.push({ type: 'SELECTOR_FAILURE', retailer, detail: reason })
          const adapterFlag = `ns.adapter.core.${retailer.toLowerCase()}`
          if (this.allowedFlags.has(adapterFlag) && this.flagStages[adapterFlag] > 0) {
            this.rollbackFlag(adapterFlag, reason, true)
            actionsTaken.push(`ROLLBACK:${adapterFlag}`)
          }
        }
      }
    }

    return {
      evaluated: true,
      batchesCount,
      healthy: breaches.length === 0,
      breaches,
      actionsTaken,
    }
  }

  getSignedManifest() {
    return this.currentManifest
  }

  getStatus() {
    return {
      seq: this.seq,
      frozen: this.frozen,
      freezeReason: this.freezeReason,
      cooldownActive: this.isCooldownActive(),
      cooldownRemainingMs: this.getCooldownRemainingMs(),
      heartbeat: this.getHeartbeatStatus(),
      flagStages: { ...this.flagStages },
      flags: JSON.parse(JSON.stringify(this.flags)),
    }
  }

  _mintCurrentManifest() {
    return mintFlagManifest({
      flags: this.flags,
      seq: this.seq,
      issuedAt: new Date(this.nowFn()).toISOString(),
      kid: this.kid,
      privateKey: this.privateKey,
    })
  }

  _recordAudit(action, payload) {
    this.auditLog.push({
      timestamp: new Date(this.nowFn()).toISOString(),
      action,
      seq: this.seq,
      payload,
    })
  }
}
