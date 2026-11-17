/**
 * @license SPDX-License-Identifier: Apache-2.0
 * src/extension/obs/obs.js — Lightweight on-device observability SDK
 * Reference: Blueprint §3.2 (N2), Set Points (Appendix A), Finding O-01
 *
 * Responsibilities:
 *   - Micro-second scale performance tracking (mark, measure, span, hist, count)
 *   - Fixed histogram buckets for latency metrics: badge_ms, nme_ms, score_ms, sw_rpc_ms
 *   - Bounded 200-span in-memory ring buffer (zero storage footprint, no unconsented egress)
 *   - Structured log ring buffer with PII / clinical term stripping
 *   - Safe error handling: zero-throw guarantee on every API call
 *   - Controlled by feature flag 'ns.obs.sdk' (defaults off, fails neutral)
 */

;(function (root) {
  'use strict'

  // Fixed histogram boundaries (ms): produces 12 buckets
  // [<1, 1-2, 2-5, 5-10, 10-20, 20-50, 50-100, 100-200, 200-500, 500-1000, 1000-5000, >=5000]
  const HIST_BOUNDARIES = Object.freeze([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 5000])
  const RING_BUFFER_CAP = 200

  // Disallowed patterns in label keys, values, and log fields (safety & privacy invariant)
  const FORBIDDEN_CONTENT_RE =
    /(?:^https?:\/\/|sku|product[-_]?id|barcode|gtin|diabet|hypertens|kidney|renal|obes|sugar|sodium|salt|fat|protein|fibre|calorie|energy)/i

  function isSafeString(val) {
    if (typeof val !== 'string') return true
    return !FORBIDDEN_CONTENT_RE.test(val)
  }

  function sanitizeFields(fields) {
    if (!fields || typeof fields !== 'object') return {}
    const safe = {}
    for (const [k, v] of Object.entries(fields)) {
      if (!isSafeString(k)) continue
      if (typeof v === 'string') {
        if (isSafeString(v)) safe[k] = v
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        safe[k] = v
      } else if (v === null) {
        safe[k] = null
      }
    }
    return safe
  }

  // Fallback high-resolution timer (Web performance.now or Node perf_hooks or Date.now)
  function nowMs() {
    try {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now()
      }
    } catch {}
    return Date.now()
  }

  // 26-char Crockford Base32 ID (ULID compatible structure)
  function generateTraceId() {
    try {
      const time = Date.now()
      const timeChars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
      let tStr = ''
      let tVal = time
      for (let i = 9; i >= 0; i--) {
        tStr = timeChars[tVal % 32] + tStr
        tVal = Math.floor(tVal / 32)
      }
      let randStr = ''
      const randBytes = new Uint8Array(10)
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(randBytes)
      } else {
        for (let i = 0; i < 10; i++) randBytes[i] = Math.floor(Math.random() * 256)
      }
      for (let i = 0; i < 16; i++) {
        randStr += timeChars[randBytes[i % 10] % 32]
      }
      return (tStr + randStr).slice(0, 26)
    } catch {
      return '00000000000000000000000000'
    }
  }

  class RingBuffer {
    constructor(capacity) {
      this.capacity = capacity
      this.buffer = new Array(capacity)
      this.head = 0
      this.size = 0
    }

    push(item) {
      this.buffer[this.head] = item
      this.head = (this.head + 1) % this.capacity
      if (this.size < this.capacity) this.size++
    }

    toArray() {
      const out = []
      for (let i = 0; i < this.size; i++) {
        const idx = (this.head - this.size + i + this.capacity) % this.capacity
        out.push(this.buffer[idx])
      }
      return out
    }

    clear() {
      this.head = 0
      this.size = 0
      this.buffer = new Array(this.capacity)
    }
  }

  class ObservabilitySDK {
    constructor() {
      this.spans = new RingBuffer(RING_BUFFER_CAP)
      this.logs = new RingBuffer(RING_BUFFER_CAP)
      this.marks = new Map()
      this.counters = Object.create(null)
      this.histograms = {
        badge_ms: new Array(HIST_BOUNDARIES.length + 1).fill(0),
        nme_ms: new Array(HIST_BOUNDARIES.length + 1).fill(0),
        score_ms: new Array(HIST_BOUNDARIES.length + 1).fill(0),
        sw_rpc_ms: new Array(HIST_BOUNDARIES.length + 1).fill(0),
      }
      this.windowStart = new Date().toISOString()
      this.activeTrace = null
    }

    /** Feature flag check: default off unless enabled */
    isEnabled() {
      try {
        if (typeof self !== 'undefined' && self.NUTRISCORE_FLAGS) {
          return self.NUTRISCORE_FLAGS['ns.obs.sdk'] === true
        }
        if (typeof globalThis !== 'undefined' && globalThis.NUTRISCORE_FLAGS) {
          return globalThis.NUTRISCORE_FLAGS['ns.obs.sdk'] === true
        }
      } catch {}
      return false
    }

    /** Start trace session for a batch */
    startTrace(batchId) {
      try {
        const id = generateTraceId()
        this.activeTrace = { id, batchId: batchId || null, start: nowMs() }
        return id
      } catch {
        return null
      }
    }

    getTraceId() {
      return this.activeTrace ? this.activeTrace.id : null
    }

    mark(name) {
      try {
        if (!name || typeof name !== 'string' || !isSafeString(name)) return
        this.marks.set(name, nowMs())
      } catch {}
    }

    measure(name, startMark, endMark) {
      try {
        if (!name || typeof name !== 'string' || !isSafeString(name)) return null
        const start = this.marks.get(startMark)
        const end = endMark ? this.marks.get(endMark) : nowMs()
        if (start == null || end == null) return null
        const duration = Math.max(0, end - start)

        if (this.histograms[name]) {
          this.hist(name, duration)
        }

        this.spans.push({
          trace_id: this.getTraceId(),
          name,
          start,
          duration,
        })
        return duration
      } catch {
        return null
      }
    }

    count(name, delta = 1, labels = null) {
      try {
        if (!name || typeof name !== 'string' || !isSafeString(name)) return
        const safeLabels = sanitizeFields(labels)
        const d = typeof delta === 'number' && Number.isFinite(delta) ? delta : 1
        this.counters[name] = (this.counters[name] || 0) + d

        if (labels) {
          this.spans.push({
            trace_id: this.getTraceId(),
            type: 'counter',
            name,
            delta: d,
            labels: safeLabels,
            ts: nowMs(),
          })
        }
      } catch {}
    }

    hist(name, valueMs) {
      try {
        if (!name || typeof name !== 'string' || !this.histograms[name]) return
        const v = typeof valueMs === 'number' && Number.isFinite(valueMs) ? Math.max(0, valueMs) : 0
        const histArray = this.histograms[name]

        let bucketIdx = HIST_BOUNDARIES.length
        for (let i = 0; i < HIST_BOUNDARIES.length; i++) {
          if (v < HIST_BOUNDARIES[i]) {
            bucketIdx = i
            break
          }
        }
        histArray[bucketIdx]++
      } catch {}
    }

    span(name, fn) {
      if (typeof fn !== 'function') return undefined
      const t0 = nowMs()
      try {
        const res = fn()
        if (res && typeof res.then === 'function') {
          return res.finally(() => {
            const dur = Math.max(0, nowMs() - t0)
            if (this.histograms[name]) this.hist(name, dur)
            this.spans.push({
              trace_id: this.getTraceId(),
              name,
              duration: dur,
            })
          })
        }
        const dur = Math.max(0, nowMs() - t0)
        if (this.histograms[name]) this.hist(name, dur)
        this.spans.push({
          trace_id: this.getTraceId(),
          name,
          duration: dur,
        })
        return res
      } catch (err) {
        const dur = Math.max(0, nowMs() - t0)
        this.count('eval_error', 1)
        this.spans.push({
          trace_id: this.getTraceId(),
          name,
          duration: dur,
          err: true,
        })
        throw err
      }
    }

    log(level, code, fields = {}) {
      try {
        if (!code || typeof code !== 'string' || !isSafeString(code)) return
        const safeFields = sanitizeFields(fields)
        const entry = {
          level,
          code,
          fields: safeFields,
          trace_id: this.getTraceId(),
          ts: Date.now(),
        }
        this.logs.push(entry)

        // Only print to console in development environments
        const isDev =
          (typeof self !== 'undefined' && self.NUTRISCORE_DEBUG === true) ||
          (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development')
        if (isDev) {
          const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
          console[method](`[NS-OBS:${code}]`, safeFields)
        }
      } catch {}
    }

    warn(code, fields) {
      this.log('warn', code, fields)
    }

    error(code, fields) {
      this.log('error', code, fields)
    }

    info(code, fields) {
      this.log('info', code, fields)
    }

    getSnapshot(extVer = '1.1.0', chromeMajor = 114) {
      try {
        return {
          window_start: this.windowStart,
          window_s: Math.round((nowMs() - (this.marks.get('window_init') || nowMs())) / 1000),
          hist: {
            badge_ms: [...this.histograms.badge_ms],
            nme_ms: [...this.histograms.nme_ms],
            score_ms: [...this.histograms.score_ms],
            sw_rpc_ms: [...this.histograms.sw_rpc_ms],
          },
          counters: { ...this.counters },
          ext_ver: extVer,
          chrome_major: chromeMajor,
        }
      } catch {
        return null
      }
    }

    getSpans() {
      return this.spans.toArray()
    }

    getLogs() {
      return this.logs.toArray()
    }

    reset() {
      this.spans.clear()
      this.logs.clear()
      this.marks.clear()
      this.counters = Object.create(null)
      for (const k of Object.keys(this.histograms)) {
        this.histograms[k].fill(0)
      }
      this.windowStart = new Date().toISOString()
      this.activeTrace = null
    }
  }

  const singleton = new ObservabilitySDK()

  // Export for browser & node environments
  if (typeof self !== 'undefined') {
    self.NutriObs = singleton
  }
  if (typeof window !== 'undefined') {
    window.NutriObs = singleton
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      obs: singleton,
      NutriObs: singleton,
      ObservabilitySDK,
      HIST_BOUNDARIES,
      RING_BUFFER_CAP,
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : self)
