/**
 * src/ui/src/app/__tests__/wp18-observability-canary.test.ts
 *
 * WP-18: Observability Stack, SLOs, Closed-Loop Controller & Selector Canary Suite
 * References: Blueprint §3.4 (N4), §3.8 (N8, G-08), §5.3 (Phase 3 Cutover).
 *
 * Invariants Tested:
 *   1. Strict Flag Name Allowlist: only permitted flags can be mutated; unauthorized flags or scoring mutations rejected.
 *   2. Progressive Cohort Staging: 0% -> 1% -> 10% -> 50% -> 100% with monotonic sequence generation.
 *   3. 15-Minute Cooldown & Anti-Flapping Hysteresis: rapid flapping mutations blocked unless emergency bypass.
 *   4. Fail-Static Heartbeat & Freeze Architecture: silent controller (> 10m) triggers alert; frozen state blocks mutations.
 *   5. Google SRE Multi-Window Burn Rates: fast burn (14.4x over 1h & 5m) reverts flags; slow burn (6.0x) freezes.
 *   6. Automated Rollback Triggers (§5.3):
 *      - Latency breaches (P95 > 200ms or 3x > 120ms)
 *      - Neutral fallback rate elevation (> 3pp above baseline and > 5% total)
 *      - Evaluation error rate (> 0.5%)
 *      - Service worker RPC failure (> 2%)
 *      - Grade distribution shift (> 2pp)
 *      - Unresolved safety events or false-block reports (> 1%)
 *      - Telemetry degradation (ack P99 > 300ms, rejects > 2%, dupes > 1%)
 *      - BFF 5xx rate (> 0.5%)
 *      - SSE resync rate (> 5%)
 *   7. Selector Canary Runner: synthetic 50-card evaluations per retailer, detecting breaches (> 2%) and killSwitch actuation.
 *   8. Server API Canary Endpoints: status, manifest, cohort promotion, evaluation, and rollback HTTP routes.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import {
  CanaryController,
  ALLOWED_FLAGS,
  COHORT_STAGES,
  MIN_BATCHES_FOR_EVAL,
  COOLDOWN_MS,
  HEARTBEAT_TIMEOUT_MS,
} from '../../../../../services/api/src/canary/controller.mjs'
import { runSelectorCanary } from '../../../../../scripts/verify-selector-canary.mjs'
import { createApiApp } from '../../../../../services/api/src/server.mjs'

describe('WP-18: Observability Stack, SLOs & Closed-Loop Controller', () => {
  let controller: CanaryController
  let simulatedTime: number
  const keyPair = generateKeyPairSync('ed25519')

  beforeEach(() => {
    simulatedTime = 1700000000000 // Fixed deterministic epoch
    controller = new CanaryController({
      nowFn: () => simulatedTime,
      privateKey: keyPair.privateKey,
      initialSeq: 10,
    })
  })

  // ── 1. Flag Allowlist & Security Boundaries ──────────────────────────────

  describe('1. Flag Allowlist & Security Boundaries', () => {
    it('initializes all allowlisted flags with valid initial state', () => {
      for (const flag of ALLOWED_FLAGS) {
        const state = controller.getFlag(flag)
        expect(state).toBeDefined()
        expect(typeof state.cohort_pct).toBe('number')
      }
    })

    it('rejects attempts to get or modify flags outside the allowlist', () => {
      expect(() => controller.getFlag('ns.arbitrary.flag')).toThrow(/not in the allowed flag registry/)

      expect(() =>
        controller.setFlagCohort('ns.arbitrary.flag', 1, 'test', true),
      ).toThrow(/not an allowlisted feature flag/)

      expect(() =>
        controller.rollbackFlag('ns.unauthorized.flag', 'test', true),
      ).toThrow(/not an allowlisted feature flag/)
    })

    it('rejects attempt to alter scoring constants or clinical policies via controller', () => {
      expect(() =>
        controller.setFlagCohort('SODIUM_MAX_MG', 1, 'tamper', true),
      ).toThrow(/not an allowlisted feature flag/)

      expect(() =>
        controller.setFlagCohort('DIABETIC_ENERGY_KCAL', 1, 'tamper', true),
      ).toThrow(/not an allowlisted feature flag/)
    })
  })

  // ── 2. Progressive Cohort Promotion & Cooldown ───────────────────────────

  describe('2. Progressive Cohort Promotion & Cooldown (Anti-Flapping)', () => {
    it('promotes flag through progressive stages with monotonic seq', () => {
      const flag = 'ns.scanner.v2'
      expect(controller.getFlag(flag).cohort_pct).toBe(0)

      // Stage 1 (1%)
      let manifest = controller.setFlagCohort(flag, 1, 'Stage 1 cutover', true)
      expect(controller.getFlag(flag).cohort_pct).toBe(1)
      expect(controller.getFlag(flag).enabled).toBe(true)
      expect(manifest.seq).toBe(11)

      // Advance time past cooldown
      simulatedTime += COOLDOWN_MS + 1000

      // Stage 2 (10%)
      manifest = controller.setFlagCohort(flag, 2, 'Stage 2 cutover')
      expect(controller.getFlag(flag).cohort_pct).toBe(10)
      expect(manifest.seq).toBe(12)

      simulatedTime += COOLDOWN_MS + 1000

      // Stage 3 (50%)
      manifest = controller.setFlagCohort(flag, 3, 'Stage 3 cutover')
      expect(controller.getFlag(flag).cohort_pct).toBe(50)
      expect(manifest.seq).toBe(13)

      simulatedTime += COOLDOWN_MS + 1000

      // Stage 4 (100%)
      manifest = controller.setFlagCohort(flag, 4, 'Stage 4 full release')
      expect(controller.getFlag(flag).cohort_pct).toBe(100)
      expect(manifest.seq).toBe(14)
    })

    it('blocks rapid flapping changes within 15-minute cooldown window', () => {
      const flag = 'ns.nme.v2'
      controller.setFlagCohort(flag, 1, 'Initial promotion', true)

      // Immediate subsequent change within cooldown is blocked
      expect(() =>
        controller.setFlagCohort(flag, 2, 'Rapid promotion'),
      ).toThrow(/Rollout cooldown active/)

      // Advance time by 10 minutes (still in cooldown)
      simulatedTime += 10 * 60 * 1000
      expect(controller.isCooldownActive()).toBe(true)
      expect(controller.getCooldownRemainingMs()).toBeGreaterThan(0)
      expect(() => controller.setFlagCohort(flag, 2, 'Still in cooldown')).toThrow(/Rollout cooldown active/)

      // Advance remaining 6 minutes (cooldown expired)
      simulatedTime += 6 * 60 * 1000
      expect(controller.isCooldownActive()).toBe(false)
      expect(() => controller.setFlagCohort(flag, 2, 'Valid post-cooldown')).not.toThrow()
    })
  })

  // ── 3. Heartbeat & Fail-Static Architecture ──────────────────────────────

  describe('3. Heartbeat & Fail-Static Architecture', () => {
    it('reports ACTIVE when heartbeat is recent', () => {
      const status = controller.getHeartbeatStatus()
      expect(status.healthy).toBe(true)
      expect(status.status).toBe('ACTIVE')
    })

    it('triggers CONTROLLER_SILENT if controller is inactive for > 10 minutes', () => {
      simulatedTime += HEARTBEAT_TIMEOUT_MS + 5000
      const status = controller.getHeartbeatStatus()
      expect(status.healthy).toBe(false)
      expect(status.status).toBe('CONTROLLER_SILENT')

      // Touching heartbeat restores active state
      controller.touchHeartbeat()
      expect(controller.getHeartbeatStatus().status).toBe('ACTIVE')
    })

    it('rejects flag modifications when controller is frozen', () => {
      controller.freeze('Safety drill or uncontained alert')
      expect(controller.getStatus().frozen).toBe(true)

      expect(() =>
        controller.setFlagCohort('ns.ledger.v2', 1, 'blocked by freeze', true),
      ).toThrow(/controller is frozen/)

      controller.unfreeze('Drill resolved')
      expect(controller.getStatus().frozen).toBe(false)
      expect(() => controller.setFlagCohort('ns.ledger.v2', 1, 'allowed after unfreeze', true)).not.toThrow()
    })
  })

  // ── 4. Google SRE Multi-Window Burn Rates ─────────────────────────────────

  describe('4. Google SRE Multi-Window Burn Rates', () => {
    it('detects fast burn rate (14.4x) over 1h and 5m and triggers rollback', () => {
      // Advance flag to stage 2 first
      controller.setFlagCohort('ns.scoring.v5', 2, 'Initial stage', true)
      expect(controller.getFlag('ns.scoring.v5').cohort_pct).toBe(10)

      // Fast burn: error rate 8% (budget 0.5% * 14.4 = 7.2%)
      const evalResult = controller.evaluateMetrics({
        batches_count: 500,
        burn_rate: {
          errorRate1h: 0.08,
          errorRate5m: 0.085,
        },
      })

      expect(evalResult.healthy).toBe(false)
      expect(evalResult.breaches.some((b) => b.type === 'FAST_BURN')).toBe(true)
      expect(controller.getStatus().frozen).toBe(true)
      // Cohort rolled back from stage 2 (10%) to stage 1 (1%)
      expect(controller.getFlag('ns.scoring.v5').cohort_pct).toBe(1)
    })

    it('detects slow burn rate (6.0x) over 6h and 30m and freezes rollout', () => {
      const evalResult = controller.evaluateMetrics({
        batches_count: 500,
        burn_rate: {
          errorRate6h: 0.035, // > 3.0%
          errorRate30m: 0.038,
        },
      })

      expect(evalResult.healthy).toBe(false)
      expect(evalResult.breaches.some((b) => b.type === 'SLOW_BURN')).toBe(true)
      expect(controller.getStatus().frozen).toBe(true)
      expect(evalResult.actionsTaken).toContain('FREEZE_ROLLOUTS')
    })
  })

  // ── 5. Automated Rollback Triggers (§5.3) ─────────────────────────────────

  describe('5. Automated Rollback Triggers (§5.3)', () => {
    it('defers evaluation when sample volume is below 200 batches without emergency', () => {
      const res = controller.evaluateMetrics({
        batches_count: 150,
        badge_ms_p95: 180,
      })
      expect(res.evaluated).toBe(false)
      expect(res.reason).toContain('Insufficient sample volume: 150 batches')
    })

    it('safety breach: immediately triggers freeze and rolls back clinical flags', () => {
      controller.setFlagCohort('ns.scoring.v5', 3, 'stage 3', true)
      controller.setFlagCohort('ns.policy.v2', 3, 'stage 3', true)

      const res = controller.evaluateMetrics({
        batches_count: 50, // Evaluates even with small sample because emergency
        safety_events_unresolved: 1,
      })

      expect(res.healthy).toBe(false)
      expect(res.breaches.some((b) => b.type === 'SAFETY')).toBe(true)
      expect(controller.getStatus().frozen).toBe(true)
      expect(controller.getFlag('ns.scoring.v5').cohort_pct).toBe(10) // Rolled back one stage (50% -> 10%)
      expect(controller.getFlag('ns.policy.v2').cohort_pct).toBe(10)
    })

    it('badge latency breach: P95 > 200 ms triggers immediate rollback', () => {
      controller.setFlagCohort('ns.scanner.v2', 2, 'stage 2', true)

      const res = controller.evaluateMetrics({
        batches_count: 250,
        badge_ms_p95: 220,
      })

      expect(res.healthy).toBe(false)
      expect(res.breaches.some((b) => b.type === 'LATENCY_CRITICAL')).toBe(true)
      expect(controller.getFlag('ns.scanner.v2').cohort_pct).toBe(1)
    })

    it('badge latency breach: 3 consecutive windows of P95 > 120 ms triggers rollback', () => {
      controller.setFlagCohort('ns.scanner.v2', 2, 'stage 2', true)

      // Window 1: > 120ms
      controller.evaluateMetrics({ batches_count: 250, badge_ms_p95: 135 })
      expect(controller.getFlag('ns.scanner.v2').cohort_pct).toBe(10) // Still at stage 2

      // Window 2: > 120ms
      controller.evaluateMetrics({ batches_count: 250, badge_ms_p95: 140 })
      expect(controller.getFlag('ns.scanner.v2').cohort_pct).toBe(10)

      // Window 3: > 120ms -> Breach triggered!
      const res3 = controller.evaluateMetrics({ batches_count: 250, badge_ms_p95: 130 })
      expect(res3.breaches.some((b) => b.type === 'LATENCY_SUSTAINED')).toBe(true)
      expect(controller.getFlag('ns.scanner.v2').cohort_pct).toBe(1)
    })

    it('neutral fallback rate elevation triggers rollback after 2 windows', () => {
      controller.setFlagCohort('ns.scoring.v5', 2, 'stage 2', true)

      // Window 1: elevated fallback rate (6% vs 2% baseline)
      controller.evaluateMetrics({
        batches_count: 300,
        neutral_fallback_rate: 0.06,
        neutral_fallback_baseline: 0.02,
      })
      expect(controller.getFlag('ns.scoring.v5').cohort_pct).toBe(10)

      // Window 2: elevated again -> rollback triggered
      const res2 = controller.evaluateMetrics({
        batches_count: 300,
        neutral_fallback_rate: 0.065,
        neutral_fallback_baseline: 0.02,
      })
      expect(res2.breaches.some((b) => b.type === 'NEUTRAL_FALLBACK')).toBe(true)
      expect(controller.getFlag('ns.scoring.v5').cohort_pct).toBe(1)
    })

    it('eval error rate > 0.5% triggers rollback of scoring and policy', () => {
      controller.setFlagCohort('ns.scoring.v5', 3, 'stage 3', true)
      controller.setFlagCohort('ns.policy.v2', 3, 'stage 3', true)

      const res = controller.evaluateMetrics({
        batches_count: 300,
        eval_error_rate: 0.008, // 0.8%
      })

      expect(res.healthy).toBe(false)
      expect(res.breaches.some((b) => b.type === 'EVAL_ERROR')).toBe(true)
      expect(controller.getFlag('ns.scoring.v5').cohort_pct).toBe(10)
      expect(controller.getFlag('ns.policy.v2').cohort_pct).toBe(10)
    })

    it('service worker RPC failure > 2% triggers rollback of scanner.v2', () => {
      controller.setFlagCohort('ns.scanner.v2', 2, 'stage 2', true)

      const res = controller.evaluateMetrics({
        batches_count: 300,
        sw_rpc_fail_rate: 0.035, // 3.5%
      })

      expect(res.breaches.some((b) => b.type === 'SW_RPC_FAIL')).toBe(true)
      expect(controller.getFlag('ns.scanner.v2').cohort_pct).toBe(1)
    })

    it('telemetry degradation triggers rollback of telemetry.v2', () => {
      controller.setFlagCohort('ns.telemetry.v2', 2, 'stage 2', true)

      const res = controller.evaluateMetrics({
        batches_count: 300,
        telemetry_ack_p99_ms: 350, // > 300 ms
        telemetry_schema_reject_rate: 0.03, // > 2%
      })

      expect(res.breaches.some((b) => b.type === 'TELEMETRY_DEGRADED')).toBe(true)
      expect(controller.getFlag('ns.telemetry.v2').cohort_pct).toBe(1)
    })

    it('BFF 5xx rate > 0.5% triggers rollback of bff.enforce', () => {
      controller.setFlagCohort('ns.bff.enforce', 2, 'stage 2', true)

      const res = controller.evaluateMetrics({
        batches_count: 300,
        bff_5xx_rate: 0.012, // 1.2%
      })

      expect(res.breaches.some((b) => b.type === 'BFF_5XX')).toBe(true)
      expect(controller.getFlag('ns.bff.enforce').cohort_pct).toBe(1)
    })

    it('SSE resync rate > 5% triggers rollback of sse to polling', () => {
      controller.setFlagCohort('ns.sse', 2, 'stage 2', true)

      const res = controller.evaluateMetrics({
        batches_count: 300,
        sse_resync_rate: 0.08, // 8%
      })

      expect(res.breaches.some((b) => b.type === 'SSE_DEGRADED')).toBe(true)
      expect(controller.getFlag('ns.sse').cohort_pct).toBe(1)
    })

    it('retailer selector failure > 2% rolls back that retailer adapter', () => {
      controller.setFlagCohort('ns.adapter.core.quickmart', 2, 'stage 2', true)

      const res = controller.evaluateMetrics({
        batches_count: 300,
        retailer_selector_failures: {
          quickmart: 0.04, // 4% failure
        },
      })

      expect(res.breaches.some((b) => b.type === 'SELECTOR_FAILURE' && b.retailer === 'quickmart')).toBe(true)
      expect(controller.getFlag('ns.adapter.core.quickmart').cohort_pct).toBe(1)
    })
  })

  // ── 6. Selector Canary Runner Verification ────────────────────────────────

  describe('6. Selector Canary Runner Verification', () => {
    it('passes cleanly across all retailers when selectors match (0% failure)', () => {
      const report = runSelectorCanary({ cardsPerRetailer: 50 })
      expect(report.healthy).toBe(true)
      expect(report.breachesCount).toBe(0)

      for (const retailer of ['quickmart', 'naivas', 'carrefour']) {
        const ret = report.retailers[retailer]
        expect(ret.expected).toBe(50)
        expect(ret.extracted).toBe(50)
        expect(ret.valid).toBe(50)
        expect(ret.failureRate).toBe(0)
        expect(ret.breached).toBe(false)
        expect(ret.killSwitchRecommended).toBe(false)
      }
    })

    it('detects selector breach and recommends killSwitch when failure > 2%', () => {
      // Simulate 5 corrupt cards out of 50 for Quickmart (10% failure > 2% threshold)
      const report = runSelectorCanary({
        cardsPerRetailer: 50,
        simulatedErrors: {
          quickmart: 5,
        },
      })

      expect(report.healthy).toBe(false)
      expect(report.breachesCount).toBe(1)

      const qm = report.retailers.quickmart
      expect(qm.breached).toBe(true)
      expect(qm.failureRate).toBe(0.1) // 10%
      expect(qm.killSwitchRecommended).toBe(true)

      // Other retailers remain healthy
      expect(report.retailers.naivas.breached).toBe(false)
      expect(report.retailers.carrefour.breached).toBe(false)
    })
  })

  // ── 7. Server API Canary Endpoints Integration ───────────────────────────

  describe('7. Server API Canary Endpoints Integration', () => {
    it('mounts GET /v1/canary/status and returns controller state', async () => {
      const { requestListener } = createApiApp({ canaryController: controller })
      let statusCode = 0
      let responseBody = ''

      const req: any = {
        url: '/v1/canary/status',
        method: 'GET',
        headers: { host: 'localhost' },
      }
      const res: any = {
        writeHead: (status: number) => {
          statusCode = status
        },
        end: (data: string) => {
          responseBody = data
        },
      }

      await requestListener(req, res)
      expect(statusCode).toBe(200)

      const data = JSON.parse(responseBody)
      expect(data.seq).toBe(10)
      expect(data.frozen).toBe(false)
      expect(data.heartbeat.status).toBe('ACTIVE')
      expect(data.flags['ns.scanner.v2']).toBeDefined()
    })

    it('mounts GET /v1/canary/manifest and returns signed FlagManifest', async () => {
      const { requestListener } = createApiApp({ canaryController: controller })
      let statusCode = 0
      let responseBody = ''

      const req: any = {
        url: '/v1/canary/manifest',
        method: 'GET',
        headers: { host: 'localhost' },
      }
      const res: any = {
        writeHead: (status: number) => {
          statusCode = status
        },
        end: (data: string) => {
          responseBody = data
        },
      }

      await requestListener(req, res)
      expect(statusCode).toBe(200)

      const manifest = JSON.parse(responseBody)
      expect(manifest.typ).toBe('ns-flags+json')
      expect(manifest.seq).toBe(10)
      expect(typeof manifest.sig).toBe('string')
      expect(manifest.sig.length).toBeGreaterThan(40)
    })

    it('mounts POST /v1/canary/cohort to advance stage', async () => {
      const { requestListener } = createApiApp({ canaryController: controller })
      let statusCode = 0
      let responseBody = ''

      const req: any = {
        url: '/v1/canary/cohort',
        method: 'POST',
        headers: { host: 'localhost' },
        on: (evt: string, cb: any) => {
          if (evt === 'data') {
            cb(JSON.stringify({ flag: 'ns.ledger.v2', stageIndex: 1, bypassCooldown: true }))
          }
          if (evt === 'end') cb()
        },
      }
      const res: any = {
        writeHead: (status: number) => {
          statusCode = status
        },
        end: (data: string) => {
          responseBody = data
        },
      }

      await requestListener(req, res)
      expect(statusCode).toBe(200)

      const result = JSON.parse(responseBody)
      expect(result.success).toBe(true)
      expect(result.manifest.flags['ns.ledger.v2'].cohort_pct).toBe(1)
    })

    it('mounts POST /v1/canary/rollback for emergency rollback', async () => {
      controller.setFlagCohort('ns.ledger.v2', 2, 'setup', true)

      const { requestListener } = createApiApp({ canaryController: controller })
      let statusCode = 0
      let responseBody = ''

      const req: any = {
        url: '/v1/canary/rollback',
        method: 'POST',
        headers: { host: 'localhost' },
        on: (evt: string, cb: any) => {
          if (evt === 'data') {
            cb(JSON.stringify({ flag: 'ns.ledger.v2', reason: 'Emergency drill' }))
          }
          if (evt === 'end') cb()
        },
      }
      const res: any = {
        writeHead: (status: number) => {
          statusCode = status
        },
        end: (data: string) => {
          responseBody = data
        },
      }

      await requestListener(req, res)
      expect(statusCode).toBe(200)

      const result = JSON.parse(responseBody)
      expect(result.success).toBe(true)
      expect(result.manifest.flags['ns.ledger.v2'].cohort_pct).toBe(1) // Rolled back from 10% to 1%
    })
  })
})
