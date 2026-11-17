// services/api/src/telemetry-gateway.mjs
// Telemetry Ingestion Gateway (Blueprint §3.3 N3; Invariants G-02, G-03, T-08)

import { generateUlid, isValidUlid } from './ulid.mjs'

export const MAX_BATCH_EVENTS = 100
export const MAX_BATCH_BYTES = 256 * 1024 // 256 KB
export const MAX_DEVICE_RATE_PER_SEC = 20
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000 // 24 hours
export const MAX_QUEUE_DEPTH_THRESHOLD = 5000

export const ALLOWED_SCHEMAS = new Set(['nutriscore.telemetry/1.1', 'nutriscore.telemetry/1.0'])

export class RateLimiter {
  constructor(limit = MAX_DEVICE_RATE_PER_SEC) {
    this.limit = limit
    // shopper_ref -> Array of timestamps in ms
    this.windows = new Map()
  }

  isRateExceeded(shopperRef, now = Date.now()) {
    if (!shopperRef) return false
    const cutoff = now - 1000 // 1-second rolling window
    let timestamps = this.windows.get(shopperRef) || []
    timestamps = timestamps.filter((t) => t > cutoff)

    if (timestamps.length >= this.limit) {
      this.windows.set(shopperRef, timestamps)
      return true
    }

    timestamps.push(now)
    this.windows.set(shopperRef, timestamps)
    return false
  }

  reset() {
    this.windows.clear()
  }
}

export class TelemetryGatewayService {
  constructor(store, consentService) {
    this.store = store
    this.consentService = consentService
    this.rateLimiter = new RateLimiter()
    // RED metrics tracking
    this.metrics = {
      requestsTotal: 0,
      requestsErrors: 0,
      eventsAccepted: 0,
      eventsDuplicate: 0,
      eventsRejected: {
        SCHEMA: 0,
        CONSENT: 0,
        SKEW: 0,
        RATE: 0,
        TOO_LARGE: 0,
      },
    }
  }

  resetMetrics() {
    this.metrics.requestsTotal = 0
    this.metrics.requestsErrors = 0
    this.metrics.eventsAccepted = 0
    this.metrics.eventsDuplicate = 0
    this.metrics.eventsRejected = {
      SCHEMA: 0,
      CONSENT: 0,
      SKEW: 0,
      RATE: 0,
      TOO_LARGE: 0,
    }
    this.rateLimiter.reset()
  }

  validateEventSchema(ev) {
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
      return { valid: false, code: 'SCHEMA', reason: 'Event must be a non-null object' }
    }
    if (!isValidUlid(ev.event_id)) {
      return {
        valid: false,
        code: 'SCHEMA',
        reason: 'Invalid or missing 26-character ULID event_id',
      }
    }
    if (typeof ev.occurred_at !== 'string' || Number.isNaN(new Date(ev.occurred_at).getTime())) {
      return { valid: false, code: 'SCHEMA', reason: 'Invalid occurred_at timestamp' }
    }
    if (typeof ev.shopper_ref !== 'string' || ev.shopper_ref.trim().length === 0) {
      return { valid: false, code: 'SCHEMA', reason: 'Missing shopper_ref' }
    }
    if (typeof ev.retailer !== 'string' || ev.retailer.trim().length === 0) {
      return { valid: false, code: 'SCHEMA', reason: 'Missing retailer' }
    }
    if (typeof ev.type !== 'string' || ev.type.trim().length === 0) {
      return { valid: false, code: 'SCHEMA', reason: 'Missing event type' }
    }
    if (typeof ev.consent_ref !== 'string' || ev.consent_ref.trim().length === 0) {
      return { valid: false, code: 'SCHEMA', reason: 'Missing consent_ref' }
    }
    if (
      typeof ev.client_seq !== 'number' ||
      !Number.isInteger(ev.client_seq) ||
      ev.client_seq < 0
    ) {
      return { valid: false, code: 'SCHEMA', reason: 'client_seq must be a non-negative integer' }
    }
    if (typeof ev.schema !== 'string' || !ALLOWED_SCHEMAS.has(ev.schema)) {
      return { valid: false, code: 'SCHEMA', reason: `Unsupported schema version: ${ev.schema}` }
    }
    if (!ev.payload || typeof ev.payload !== 'object' || Array.isArray(ev.payload)) {
      return { valid: false, code: 'SCHEMA', reason: 'payload must be a JSON object' }
    }
    return { valid: true }
  }

  async handleBatch(requestBodyRaw, headers = {}, now = Date.now()) {
    this.metrics.requestsTotal++

    // 1. Payload Size Cap (<= 256 KB)
    const rawLength =
      typeof requestBodyRaw === 'string'
        ? Buffer.byteLength(requestBodyRaw, 'utf8')
        : Buffer.byteLength(JSON.stringify(requestBodyRaw), 'utf8')

    if (rawLength > MAX_BATCH_BYTES) {
      this.metrics.requestsErrors++
      const error = new Error('Payload size exceeds 256 KB limit')
      error.statusCode = 413
      error.code = 'TOO_LARGE'
      throw error
    }

    // Parse body
    const body = typeof requestBodyRaw === 'string' ? JSON.parse(requestBodyRaw) : requestBodyRaw
    const rawEvents = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : null

    if (!rawEvents) {
      this.metrics.requestsErrors++
      const error = new Error("Invalid request body: expected array or object with 'events' array")
      error.statusCode = 400
      error.code = 'SCHEMA'
      throw error
    }

    // 2. Batch Item Count Cap (<= 100 events)
    if (rawEvents.length > MAX_BATCH_EVENTS) {
      this.metrics.requestsErrors++
      const error = new Error(
        `Batch size exceeds ${MAX_BATCH_EVENTS} event limit (got ${rawEvents.length})`,
      )
      error.statusCode = 400
      error.code = 'TOO_LARGE'
      throw error
    }

    // 3. Batch Idempotency-Key Check
    const idempotencyKey = headers['idempotency-key'] || headers['Idempotency-Key']
    if (idempotencyKey) {
      try {
        const cached = await this.store.getIdempotentBatch(idempotencyKey)
        if (cached) {
          return {
            status: 200,
            cached: true,
            body: cached.response_body,
          }
        }
      } catch (err) {
        // If DB down, fail closed
        const error = new Error('Database unreachable during idempotency check')
        error.statusCode = 503
        error.retryAfter = 30
        throw error
      }
    }

    // 4. Backpressure & Queue Depth Check
    const queueDepth = this.store.getQueueDepth()
    if (queueDepth > MAX_QUEUE_DEPTH_THRESHOLD) {
      this.metrics.requestsErrors++
      const error = new Error('Gateway queue depth threshold exceeded')
      error.statusCode = 429
      error.retryAfter = Math.min(300, Math.ceil(queueDepth / 100))
      throw error
    }

    // Check shadow mode
    const isShadow =
      headers['x-ns-shadow'] === '1' ||
      headers['X-NS-Shadow'] === '1' ||
      headers['x-ns-shadow'] === 'true'

    const resultsMap = new Map()
    const validEventsToIngest = []

    // 5. Per-event validation pipeline
    for (const ev of rawEvents) {
      const eventId = ev?.event_id || 'unknown'

      // (a) Schema Check
      const schemaCheck = this.validateEventSchema(ev)
      if (!schemaCheck.valid) {
        this.metrics.eventsRejected.SCHEMA++
        resultsMap.set(eventId, {
          event_id: eventId,
          status: 'rejected',
          code: 'SCHEMA',
          reason: schemaCheck.reason,
        })
        continue
      }

      // (b) Clock Skew Check (<= 24h past or future)
      const occurredTime = new Date(ev.occurred_at).getTime()
      if (Math.abs(now - occurredTime) > MAX_CLOCK_SKEW_MS) {
        this.metrics.eventsRejected.SKEW++
        resultsMap.set(eventId, {
          event_id: eventId,
          status: 'rejected',
          code: 'SKEW',
          reason: `Event timestamp skew exceeds 24 hours: ${ev.occurred_at}`,
        })
        continue
      }

      // (c) Device Rate Limit Check (<= 20 events/sec per shopper)
      if (this.rateLimiter.isRateExceeded(ev.shopper_ref, now)) {
        this.metrics.eventsRejected.RATE++
        resultsMap.set(eventId, {
          event_id: eventId,
          status: 'rejected',
          code: 'RATE',
          reason: `Device rate limit exceeded (> ${MAX_DEVICE_RATE_PER_SEC} events/sec)`,
        })
        continue
      }

      // (d) Consent Verification
      // Blueprint Invariant: If consent store is unreachable, FAIL CLOSED with 503,
      // NOT a CONSENT rejection, so the client keeps events in queue and does not drop!
      let hasConsent = false
      try {
        hasConsent = await this.consentService.hasActiveConsent(ev.consent_ref, 'C2', now)
      } catch (err) {
        this.metrics.requestsErrors++
        const error = new Error('Consent store unreachable: failing closed')
        error.statusCode = 503
        error.retryAfter = 30
        throw error
      }

      if (!hasConsent) {
        this.metrics.eventsRejected.CONSENT++
        resultsMap.set(eventId, {
          event_id: eventId,
          status: 'rejected',
          code: 'CONSENT',
          reason: 'No active C2 telemetry consent found for consent_ref',
        })
        continue
      }

      // Passed all pre-ingest gates
      validEventsToIngest.push(ev)
    }

    // 6. Ingest validated events into store (deduplication & append)
    if (validEventsToIngest.length > 0) {
      try {
        const ingestResults = await this.store.ingestBatch(validEventsToIngest, isShadow)
        for (const res of ingestResults) {
          if (res.status === 'accepted') {
            this.metrics.eventsAccepted++
          } else if (res.status === 'duplicate') {
            this.metrics.eventsDuplicate++
          }
          resultsMap.set(res.event_id, res)
        }
      } catch (err) {
        this.metrics.requestsErrors++
        const error = new Error('Database unreachable during batch ingest')
        error.statusCode = 503
        error.retryAfter = 30
        throw error
      }
    }

    // Reconstruct results array in original order
    const orderedResults = rawEvents.map((ev) => {
      const id = ev?.event_id || 'unknown'
      return (
        resultsMap.get(id) || {
          event_id: id,
          status: 'rejected',
          code: 'SCHEMA',
        }
      )
    })

    const batchId = generateUlid(now)
    const responsePayload = {
      batch_id: batchId,
      results: orderedResults,
    }

    // Save in batch idempotency store if key was provided
    if (idempotencyKey) {
      try {
        await this.store.saveIdempotentBatch(idempotencyKey, batchId, responsePayload)
      } catch {
        // Log or ignore non-fatal idempotency save failure
      }
    }

    return {
      status: 200,
      cached: false,
      body: responsePayload,
    }
  }
}
