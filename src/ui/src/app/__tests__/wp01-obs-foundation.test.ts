import { describe, it, expect, beforeEach } from 'vitest'
import { ObservabilitySDK, HIST_BOUNDARIES } from '../../../../extension/obs/obs.js'
import obsOrdersPkg from '../../../../extension/observed-orders-sync.js'

const NutriObservedOrdersSync = (obsOrdersPkg as any).default || obsOrdersPkg

describe('WP-01: Observability SDK & Hotfix Proofs', () => {
  let obs: any

  beforeEach(() => {
    obs = new ObservabilitySDK()
  })

  describe('1. Overhead Micro-benchmark (Set point: <= 20 µs/call, <= 1.2 ms/batch)', () => {
    it('executes individual SDK calls in under 20 microseconds on average', () => {
      const iterations = 5000

      // Mark benchmark
      const t0Mark = performance.now()
      for (let i = 0; i < iterations; i++) {
        obs.mark('bench_mark')
      }
      const t1Mark = performance.now()
      const avgMarkUs = ((t1Mark - t0Mark) / iterations) * 1000

      // Measure benchmark
      obs.mark('m_start')
      obs.mark('m_end')
      const t0Measure = performance.now()
      for (let i = 0; i < iterations; i++) {
        obs.measure('score_ms', 'm_start', 'm_end')
      }
      const t1Measure = performance.now()
      const avgMeasureUs = ((t1Measure - t0Measure) / iterations) * 1000

      // Count benchmark
      const t0Count = performance.now()
      for (let i = 0; i < iterations; i++) {
        obs.count('neutral_fallback', 1)
      }
      const t1Count = performance.now()
      const avgCountUs = ((t1Count - t0Count) / iterations) * 1000

      // Hist benchmark
      const t0Hist = performance.now()
      for (let i = 0; i < iterations; i++) {
        obs.hist('badge_ms', 42.5)
      }
      const t1Hist = performance.now()
      const avgHistUs = ((t1Hist - t0Hist) / iterations) * 1000

      console.log(
        `[WP-01 Benchmark] avgMark: ${avgMarkUs.toFixed(3)} µs | avgMeasure: ${avgMeasureUs.toFixed(3)} µs | avgCount: ${avgCountUs.toFixed(3)} µs | avgHist: ${avgHistUs.toFixed(3)} µs`,
      )

      expect(avgMarkUs).toBeLessThan(20.0)
      expect(avgMeasureUs).toBeLessThan(20.0)
      expect(avgCountUs).toBeLessThan(20.0)
      expect(avgHistUs).toBeLessThan(20.0)
    })

    it('processes a 10-item batch instrumentation pass in under 1.2 ms', () => {
      const batchRuns = 200
      const batchTimesMs: number[] = []

      for (let b = 0; b < batchRuns; b++) {
        const tStart = performance.now()

        const traceId = obs.startTrace(`batch_${b}`)
        const batchMark = `ns:batch:${traceId}`
        obs.mark(batchMark)
        obs.mark('ns:batch')

        const rpcMark = `ns:rpc_start:${traceId}`
        obs.mark(rpcMark)
        // Simulate SW RPC return
        obs.measure('sw_rpc_ms', rpcMark)

        // 10 items in card batch
        for (let i = 0; i < 10; i++) {
          obs.mark('ns:painted')
          obs.measure('badge_ms', batchMark)
          obs.hist('nme_ms', 4.2)
          obs.hist('score_ms', 1.8)
        }

        obs.count('neutral_fallback', 0)
        obs.warn('batch_completed', { items_count: 10 })

        const tEnd = performance.now()
        batchTimesMs.push(tEnd - tStart)
      }

      const avgBatchMs = batchTimesMs.reduce((a, b) => a + b, 0) / batchRuns
      const maxBatchMs = Math.max(...batchTimesMs)

      console.log(
        `[WP-01 Benchmark] 10-card batch instrumentation: avg = ${avgBatchMs.toFixed(3)} ms, max = ${maxBatchMs.toFixed(3)} ms`,
      )

      expect(avgBatchMs).toBeLessThan(1.2)
    })
  })

  describe('2. No-PII & Privacy Safety Schema Tests', () => {
    it('strips hostile, SKU, URL, nutrient, and medical condition strings from log fields and labels', () => {
      obs.warn('sample_event', {
        safe_metric: 123,
        product_url: 'https://naivas.online/product/12345',
        sku_id: 'SKU-999-DIABETIC',
        condition_name: 'diabetes_type_2',
        sugar_g: 45.2,
        sodium_mg: 900,
        normal_key: 'safe_value',
      })

      const logs = obs.getLogs()
      expect(logs.length).toBe(1)
      const entry = logs[0]

      // Safe fields preserved
      expect(entry.fields.safe_metric).toBe(123)
      expect(entry.fields.normal_key).toBe('safe_value')

      // Forbidden PII / Medical / Nutrient fields stripped
      expect(entry.fields.product_url).toBeUndefined()
      expect(entry.fields.sku_id).toBeUndefined()
      expect(entry.fields.condition_name).toBeUndefined()
      expect(entry.fields.sugar_g).toBeUndefined()
      expect(entry.fields.sodium_mg).toBeUndefined()
    })

    it('rejects forbidden strings in mark and counter names', () => {
      obs.mark('https://carrefour.ke/checkout')
      obs.mark('diabetes_alert_active')
      obs.count('sku_added_count', 1)

      expect(obs.marks.has('https://carrefour.ke/checkout')).toBe(false)
      expect(obs.marks.has('diabetes_alert_active')).toBe(false)
      expect(obs.counters['sku_added_count']).toBeUndefined()
    })
  })

  describe('3. Histogram Bucketing Correctness', () => {
    it('places durations accurately across 12 fixed buckets', () => {
      // Boundaries: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 5000]
      obs.hist('badge_ms', 0.5) // Bucket 0: <1
      obs.hist('badge_ms', 1.5) // Bucket 1: 1-2
      obs.hist('badge_ms', 3.0) // Bucket 2: 2-5
      obs.hist('badge_ms', 15.0) // Bucket 4: 10-20
      obs.hist('badge_ms', 120.0) // Bucket 7: 100-200
      obs.hist('badge_ms', 6000.0) // Bucket 11: >=5000

      const snapshot = obs.getSnapshot()
      const buckets = snapshot.hist.badge_ms

      expect(buckets.length).toBe(12)
      expect(buckets[0]).toBe(1)
      expect(buckets[1]).toBe(1)
      expect(buckets[2]).toBe(1)
      expect(buckets[4]).toBe(1)
      expect(buckets[7]).toBe(1)
      expect(buckets[11]).toBe(1)
      expect(buckets[3]).toBe(0)
    })
  })

  describe('4. Ring Buffer Boundary Invariant (Max 200 items, oldest dropped)', () => {
    it('caps spans to 200 and purges the oldest on overflow', () => {
      for (let i = 0; i < 250; i++) {
        obs.mark(`start_${i}`)
        obs.mark(`end_${i}`)
        obs.measure('score_ms', `start_${i}`, `end_${i}`)
      }

      const spans = obs.getSpans()
      expect(spans.length).toBe(200)
    })
  })

  describe('5. Retry-Same-Key Test (A-06 Idempotency Invariant)', () => {
    it('generates identical idempotency keys for identical observed cart payloads', async () => {
      const payload1 = {
        retailer: 'NAIVAS',
        total_kes: 1540.5,
        items: [
          { sku_id: 'prod-001', qty: 2, unit_price_kes: 500.0 },
          { sku_id: 'prod-002', qty: 1, unit_price_kes: 540.5 },
        ],
      }

      const payload2 = {
        retailer: 'NAIVAS',
        total_kes: 1540.5,
        items: [
          { sku_id: 'prod-001', qty: 2, unit_price_kes: 500.0 },
          { sku_id: 'prod-002', qty: 1, unit_price_kes: 540.5 },
        ],
      }

      const hash1 = await NutriObservedOrdersSync.sha256Hex(
        NutriObservedOrdersSync.canonicalStringify(payload1),
      )
      const hash2 = await NutriObservedOrdersSync.sha256Hex(
        NutriObservedOrdersSync.canonicalStringify(payload2),
      )

      expect(hash1).toBe(hash2)
      expect(hash1.length).toBeGreaterThan(10)
    })

    it('generates different idempotency keys when cart items or quantities change', async () => {
      const payloadA = {
        retailer: 'NAIVAS',
        total_kes: 1500,
        items: [{ sku_id: 'prod-001', qty: 1, unit_price_kes: 1500 }],
      }

      const payloadB = {
        retailer: 'NAIVAS',
        total_kes: 3000,
        items: [{ sku_id: 'prod-001', qty: 2, unit_price_kes: 1500 }],
      }

      const hashA = await NutriObservedOrdersSync.sha256Hex(
        NutriObservedOrdersSync.canonicalStringify(payloadA),
      )
      const hashB = await NutriObservedOrdersSync.sha256Hex(
        NutriObservedOrdersSync.canonicalStringify(payloadB),
      )

      expect(hashA).not.toBe(hashB)
    })
  })

  describe('6. Flag Control & Rollback Drill', () => {
    it('respects ns.obs.sdk flag state', () => {
      // Default / unset: false
      expect(obs.isEnabled()).toBe(false)

      // Flag enabled
      ;(globalThis as any).NUTRISCORE_FLAGS = { 'ns.obs.sdk': true }
      expect(obs.isEnabled()).toBe(true)

      // Rollback drill: flip flag off
      ;(globalThis as any).NUTRISCORE_FLAGS = { 'ns.obs.sdk': false }
      expect(obs.isEnabled()).toBe(false)
    })
  })
})
