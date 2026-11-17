// services/api/src/store.mjs
// Authoritative data storage layer for Telemetry Gateway & Consent Register.
// Supports hermetic in-memory store for unit tests and local runs,
// and PostgreSQL/PostgREST when connected in container cluster.
// Invariant Rule 5 & ADR-012: Append-only WORM ledger on telemetry_bronze.

export class TelemetryStore {
  constructor() {
    this.reset()
  }

  reset() {
    // Dedupe index: event_id -> received_at (ISO string)
    this.eventIndex = new Map()
    // Bronze append-only table: Array of TelemetryEvent
    this.bronze = []
    // Shadow table: Array of TelemetryEvent
    this.shadow = []
    // Idempotency: key -> { batch_id, response_body, created_at }
    this.batchIdempotency = new Map()
    // Consent register: consent_ref -> ConsentRegisterEntry
    this.consentRegister = new Map()
    // Simulates database connection health (true = healthy, false = down)
    this.healthy = true
    // Simulated current queue depth for backpressure testing
    this.queueDepth = 0
  }

  setHealthy(status) {
    this.healthy = Boolean(status)
  }

  setQueueDepth(depth) {
    this.queueDepth = Math.max(0, depth)
  }

  getQueueDepth() {
    return this.queueDepth
  }

  // --- Consent Register Methods ---

  async saveConsent(entry) {
    if (!this.healthy) {
      throw new Error('Database connection failed: Consent store unreachable')
    }
    const record = {
      consent_ref: String(entry.consent_ref),
      patient_ref: String(entry.patient_ref),
      tenant_id: entry.tenant_id ? String(entry.tenant_id) : null,
      purpose: String(entry.purpose),
      scope: entry.scope ? String(entry.scope) : null,
      notice_hash: String(entry.notice_hash),
      granted_at: entry.granted_at || new Date().toISOString(),
      expires_at: entry.expires_at || null,
      revoked_at: entry.revoked_at || null,
      created_at: entry.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    this.consentRegister.set(record.consent_ref, record)
    return { ...record }
  }

  async getConsent(consentRef) {
    if (!this.healthy) {
      throw new Error('Database connection failed: Consent store unreachable')
    }
    const record = this.consentRegister.get(consentRef)
    return record ? { ...record } : null
  }

  async revokeConsent(consentRef, revokedAt = new Date().toISOString()) {
    if (!this.healthy) {
      throw new Error('Database connection failed: Consent store unreachable')
    }
    const record = this.consentRegister.get(consentRef)
    if (!record) return null

    record.revoked_at = revokedAt
    record.updated_at = new Date().toISOString()
    this.consentRegister.set(consentRef, record)
    return { ...record }
  }

  // --- Idempotency Methods ---

  async getIdempotentBatch(idempotencyKey) {
    if (!this.healthy) {
      throw new Error('Database connection failed: Store unreachable')
    }
    const cached = this.batchIdempotency.get(idempotencyKey)
    if (!cached) return null

    // 24-hour TTL
    const ageMs = Date.now() - new Date(cached.created_at).getTime()
    if (ageMs > 24 * 60 * 60 * 1000) {
      this.batchIdempotency.delete(idempotencyKey)
      return null
    }

    return { ...cached }
  }

  async saveIdempotentBatch(idempotencyKey, batchId, responseBody) {
    if (!this.healthy) {
      throw new Error('Database connection failed: Store unreachable')
    }
    this.batchIdempotency.set(idempotencyKey, {
      batch_id: batchId,
      response_body: responseBody,
      created_at: new Date().toISOString(),
    })
  }

  // --- Deduplication & Atomic Ingest Methods ---

  async ingestBatch(events, isShadow = false) {
    if (!this.healthy) {
      throw new Error('Database connection failed: Telemetry store unreachable')
    }

    const results = []
    const receivedAt = new Date().toISOString()

    for (const event of events) {
      const eventId = event.event_id

      if (this.eventIndex.has(eventId)) {
        results.push({
          event_id: eventId,
          status: 'duplicate',
        })
      } else {
        // Record in dedupe gate
        this.eventIndex.set(eventId, receivedAt)

        const storedEvent = {
          event_id: eventId,
          received_at: receivedAt,
          occurred_at: event.occurred_at,
          shopper_ref: event.shopper_ref,
          retailer: event.retailer,
          type: event.type,
          consent_ref: event.consent_ref,
          profile_ver: event.profile_ver ?? null,
          client_seq: event.client_seq,
          schema_ver: event.schema,
          payload: event.payload,
          flags: Array.isArray(event.flags) ? [...event.flags] : [],
        }

        if (isShadow) {
          this.shadow.push(storedEvent)
        } else {
          this.bronze.push(storedEvent)
        }

        results.push({
          event_id: eventId,
          status: 'accepted',
        })
      }
    }

    return results
  }

  // --- WORM Ledger Safety Guards ---

  updateBronze() {
    throw new Error('WORM Ledger Invariant Violation: UPDATE prohibited on telemetry_bronze')
  }

  deleteBronze() {
    throw new Error('WORM Ledger Invariant Violation: DELETE prohibited on telemetry_bronze')
  }

  getBronzeCount() {
    return this.bronze.length
  }

  getShadowCount() {
    return this.shadow.length
  }
}

export const defaultStore = new TelemetryStore()
