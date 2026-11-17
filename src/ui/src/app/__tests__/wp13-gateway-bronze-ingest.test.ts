/**
 * @file wp13-gateway-bronze-ingest.test.ts
 * Comprehensive test suite for WP-13: Gateway, Bronze Ingest, Consent Register.
 *
 * Blueprint §3.3 (N3), §3.9 (N9), §4.2; ADR-005, ADR-008, ADR-012.
 * Invariants:
 * - G-02, G-03 (Deduplication, Consent Verification, Outliers, Quarantine)
 * - T-08 (100% consent linkage, purge on revocation, fail-closed on 503)
 * - Rule 5 & ADR-012 (Append-only WORM ledger)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

let activeDbMock: any = null

vi.mock('../lib/db/shared', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    getDB: vi.fn(() => Promise.resolve(activeDbMock)),
  }
})

import { TelemetryStore } from '../../../../../services/api/src/store.mjs'
import { ConsentRegisterService } from '../../../../../services/api/src/consent-register.mjs'
import {
  TelemetryGatewayService,
  MAX_BATCH_EVENTS,
  MAX_BATCH_BYTES,
  MAX_DEVICE_RATE_PER_SEC,
} from '../../../../../services/api/src/telemetry-gateway.mjs'
import { generateUlid, isValidUlid } from '../../../../../services/api/src/ulid.mjs'
import { createApiApp } from '../../../../../services/api/src/server.mjs'
import { hasActiveConsent } from '../../../../shared/consent'
import { validateTelemetryEventSchema } from '../../../../shared/telemetry-envelope'
import {
  enqueueTelemetryEvent,
  flushTelemetryQueue,
  type QueuedTelemetryRecord,
} from '../lib/db/telemetry'

// Fake IDB for testing
class FakeTelemetryQueueStore {
  public records = new Map<string, QueuedTelemetryRecord>()

  async get(id: string) {
    return this.records.get(id) || null
  }

  async getAll() {
    return Array.from(this.records.values())
  }

  async put(record: QueuedTelemetryRecord) {
    this.records.set(record.event_id, JSON.parse(JSON.stringify(record)))
  }

  async delete(id: string) {
    this.records.delete(id)
  }

  async clear() {
    this.records.clear()
  }
}

function createFakeDb() {
  const queueStore = new FakeTelemetryQueueStore()
  return {
    objectStoreNames: {
      contains: (name: string) => name === 'telemetry_queue',
    },
    transaction: (_stores: any, _mode: any) => ({
      objectStore: (_name: string) => queueStore,
      done: Promise.resolve(),
    }),
    _queueStore: queueStore,
  }
}

describe('WP-13: Gateway, Bronze Ingest & Consent Register', () => {
  let store: any
  let consentService: ConsentRegisterService
  let gatewayService: TelemetryGatewayService

  beforeEach(() => {
    store = new TelemetryStore()
    consentService = new ConsentRegisterService(store)
    gatewayService = new TelemetryGatewayService(store, consentService)
    activeDbMock = createFakeDb()
    ;(globalThis as any).__NUTRI_FLAGS__ = { 'ns.telemetry.v2': true }
  })

  // Helper to generate a valid test event
  function createTestEvent(overrides: Record<string, any> = {}) {
    return {
      event_id: generateUlid(),
      occurred_at: new Date().toISOString(),
      shopper_ref: 'shopper-test-01',
      retailer: 'carrefour',
      type: 'cart_item_added',
      consent_ref: 'consent-test-01',
      profile_ver: 1,
      client_seq: 1,
      schema: 'nutriscore.telemetry/1.1',
      payload: {
        product_ref: 'sku-123',
        quantity: 1,
        coverage_c: 0.95,
      },
      ...overrides,
    }
  }

  describe('1. ULID & Shared Schema Validation', () => {
    it('generates valid 26-character Crockford Base32 ULIDs', () => {
      const id1 = generateUlid()
      const id2 = generateUlid()
      expect(isValidUlid(id1)).toBe(true)
      expect(isValidUlid(id2)).toBe(true)
      expect(id1.length).toBe(26)
      expect(id2.length).toBe(26)
      expect(id1).not.toBe(id2)
    })

    it('validates compliant telemetry envelope schemas', () => {
      const valid = createTestEvent()
      const res = validateTelemetryEventSchema(valid)
      expect(res.valid).toBe(true)
    })

    it('rejects malformed or non-ULID event_id', () => {
      const invalid = createTestEvent({ event_id: 'not-a-valid-ulid' })
      const res = validateTelemetryEventSchema(invalid)
      expect(res.valid).toBe(false)
      expect(res.code).toBe('SCHEMA')
    })

    it('rejects missing or empty consent_ref (Invariant T-08)', () => {
      const invalid = createTestEvent({ consent_ref: '' })
      const res = validateTelemetryEventSchema(invalid)
      expect(res.valid).toBe(false)
      expect(res.code).toBe('SCHEMA')
    })

    it('rejects unsupported schema version', () => {
      const invalid = createTestEvent({ schema: 'nutriscore.telemetry/9.9' })
      const res = validateTelemetryEventSchema(invalid)
      expect(res.valid).toBe(false)
      expect(res.code).toBe('SCHEMA')
    })
  })

  describe('2. Batch Limits & Payload Sizing', () => {
    it('accepts an empty batch with empty results', async () => {
      const res = await gatewayService.handleBatch({ events: [] })
      expect(res.status).toBe(200)
      expect(res.body.results).toEqual([])
      expect(isValidUlid(res.body.batch_id)).toBe(true)
    })

    it('rejects batch exceeding MAX_BATCH_EVENTS (100 events)', async () => {
      const events = Array.from({ length: MAX_BATCH_EVENTS + 1 }, (_, i) =>
        createTestEvent({ client_seq: i }),
      )

      await expect(gatewayService.handleBatch({ events })).rejects.toMatchObject({
        statusCode: 400,
        code: 'TOO_LARGE',
      })
    })

    it('rejects batch exceeding MAX_BATCH_BYTES (256 KB)', async () => {
      const hugeString = 'X'.repeat(MAX_BATCH_BYTES + 1024)
      const hugeEvent = createTestEvent({
        payload: { bigData: hugeString },
      })

      await expect(gatewayService.handleBatch({ events: [hugeEvent] })).rejects.toMatchObject({
        statusCode: 413,
        code: 'TOO_LARGE',
      })
    })
  })

  describe('3. Clock Skew & Outliers', () => {
    beforeEach(async () => {
      await consentService.registerConsent({
        consent_ref: 'consent-test-01',
        patient_ref: 'patient-test-01',
        purpose: 'C2',
        notice_hash: 'hash-abc',
      })
    })

    it('rejects events with timestamp older than 24 hours (SKEW)', async () => {
      const pastTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      const event = createTestEvent({ occurred_at: pastTime })

      const res = await gatewayService.handleBatch({ events: [event] })
      expect(res.body.results[0]).toMatchObject({
        event_id: event.event_id,
        status: 'rejected',
        code: 'SKEW',
      })
      expect(store.getBronzeCount()).toBe(0)
    })

    it('rejects events with timestamp more than 24 hours in the future (SKEW)', async () => {
      const futureTime = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString()
      const event = createTestEvent({ occurred_at: futureTime })

      const res = await gatewayService.handleBatch({ events: [event] })
      expect(res.body.results[0]).toMatchObject({
        event_id: event.event_id,
        status: 'rejected',
        code: 'SKEW',
      })
      expect(store.getBronzeCount()).toBe(0)
    })

    it('accepts events with timestamp within 24-hour window', async () => {
      const recentTime = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      const event = createTestEvent({ occurred_at: recentTime })

      const res = await gatewayService.handleBatch({ events: [event] })
      expect(res.body.results[0]).toMatchObject({
        event_id: event.event_id,
        status: 'accepted',
      })
      expect(store.getBronzeCount()).toBe(1)
    })
  })

  describe('4. Device Rate Limiting', () => {
    beforeEach(async () => {
      await consentService.registerConsent({
        consent_ref: 'consent-test-01',
        patient_ref: 'patient-test-01',
        purpose: 'C2',
        notice_hash: 'hash-abc',
      })
    })

    it('permits up to 20 events per second per shopper', async () => {
      const events = Array.from({ length: MAX_DEVICE_RATE_PER_SEC }, (_, i) =>
        createTestEvent({ client_seq: i, event_id: generateUlid() }),
      )

      const res = await gatewayService.handleBatch({ events })
      const accepted = res.body.results.filter((r: any) => r.status === 'accepted')
      expect(accepted.length).toBe(MAX_DEVICE_RATE_PER_SEC)
    })

    it('rejects events beyond 20 per second with code RATE', async () => {
      const events = Array.from({ length: MAX_DEVICE_RATE_PER_SEC + 5 }, (_, i) =>
        createTestEvent({ client_seq: i, event_id: generateUlid() }),
      )

      const res = await gatewayService.handleBatch({ events })
      const accepted = res.body.results.filter((r: any) => r.status === 'accepted')
      const rejected = res.body.results.filter(
        (r: any) => r.status === 'rejected' && r.code === 'RATE',
      )

      expect(accepted.length).toBe(MAX_DEVICE_RATE_PER_SEC)
      expect(rejected.length).toBe(5)
    })

    it('tracks rate limits per shopper independently', async () => {
      const shopperAEvents = Array.from({ length: MAX_DEVICE_RATE_PER_SEC }, (_, i) =>
        createTestEvent({ shopper_ref: 'shopper-A', client_seq: i, event_id: generateUlid() }),
      )
      const shopperBEvent = createTestEvent({
        shopper_ref: 'shopper-B',
        event_id: generateUlid(),
      })

      const res = await gatewayService.handleBatch({
        events: [...shopperAEvents, shopperBEvent],
      })

      const shopperAResults = res.body.results.slice(0, MAX_DEVICE_RATE_PER_SEC)
      const shopperBResult = res.body.results[MAX_DEVICE_RATE_PER_SEC]

      expect(shopperAResults.every((r: any) => r.status === 'accepted')).toBe(true)
      expect(shopperBResult.status).toBe('accepted')
    })
  })

  describe('5. Consent Verification & Revocation Push Invalidation', () => {
    it('accepts event when active C2 consent exists', async () => {
      await consentService.registerConsent({
        consent_ref: 'consent-active-01',
        patient_ref: 'patient-01',
        purpose: 'C2',
        notice_hash: 'notice-123',
      })

      const event = createTestEvent({ consent_ref: 'consent-active-01' })
      const res = await gatewayService.handleBatch({ events: [event] })

      expect(res.body.results[0]).toMatchObject({
        event_id: event.event_id,
        status: 'accepted',
      })
    })

    it('rejects event with code CONSENT when consent_ref does not exist', async () => {
      const event = createTestEvent({ consent_ref: 'unknown-consent-ref' })
      const res = await gatewayService.handleBatch({ events: [event] })

      expect(res.body.results[0]).toMatchObject({
        event_id: event.event_id,
        status: 'rejected',
        code: 'CONSENT',
      })
    })

    it('rejects event with code CONSENT when consent is expired', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      await consentService.registerConsent({
        consent_ref: 'consent-expired-01',
        patient_ref: 'patient-01',
        purpose: 'C2',
        notice_hash: 'notice-123',
        expires_at: yesterday,
      })

      const event = createTestEvent({ consent_ref: 'consent-expired-01' })
      const res = await gatewayService.handleBatch({ events: [event] })

      expect(res.body.results[0]).toMatchObject({
        event_id: event.event_id,
        status: 'rejected',
        code: 'CONSENT',
      })
    })

    it('rejects event with code CONSENT when consent purpose is not C2', async () => {
      await consentService.registerConsent({
        consent_ref: 'consent-c1-only',
        patient_ref: 'patient-01',
        purpose: 'C1',
        notice_hash: 'notice-123',
      })

      const event = createTestEvent({ consent_ref: 'consent-c1-only' })
      const res = await gatewayService.handleBatch({ events: [event] })

      expect(res.body.results[0]).toMatchObject({
        event_id: event.event_id,
        status: 'rejected',
        code: 'CONSENT',
      })
    })

    it('demonstrates push invalidation: event arriving after revoke is immediately rejected', async () => {
      await consentService.registerConsent({
        consent_ref: 'consent-revoke-race',
        patient_ref: 'patient-01',
        purpose: 'C2',
        notice_hash: 'notice-123',
      })

      // 1. Initial event is accepted and cached
      const event1 = createTestEvent({
        consent_ref: 'consent-revoke-race',
        event_id: generateUlid(),
      })
      const res1 = await gatewayService.handleBatch({ events: [event1] })
      expect(res1.body.results[0].status).toBe('accepted')

      // 2. Patient revokes consent
      await consentService.revokeConsent('consent-revoke-race')

      // 3. Next event arriving 5 seconds later is immediately rejected (cache was pushed/cleared)
      const event2 = createTestEvent({
        consent_ref: 'consent-revoke-race',
        event_id: generateUlid(),
      })
      const res2 = await gatewayService.handleBatch({ events: [event2] })
      expect(res2.body.results[0]).toMatchObject({
        event_id: event2.event_id,
        status: 'rejected',
        code: 'CONSENT',
      })
    })

    it('shared hasActiveConsent helper validates entries correctly', () => {
      const activeEntry = {
        consent_ref: 'c-1',
        patient_ref: 'p-1',
        purpose: 'C2' as const,
        notice_hash: 'h-1',
        granted_at: new Date(Date.now() - 1000).toISOString(),
      }
      expect(hasActiveConsent(activeEntry, 'C2')).toBe(true)
      expect(hasActiveConsent(activeEntry, 'C1')).toBe(false)

      const revokedEntry = { ...activeEntry, revoked_at: new Date().toISOString() }
      expect(hasActiveConsent(revokedEntry, 'C2')).toBe(false)
    })
  })

  describe('6. Fail-Closed on Consent Store Outage (Invariant T-08)', () => {
    it('returns HTTP 503 Retry-After when consent store is unreachable, NEVER dropping events', async () => {
      store.setHealthy(false)

      const event = createTestEvent()
      await expect(gatewayService.handleBatch({ events: [event] })).rejects.toMatchObject({
        statusCode: 503,
        retryAfter: 30,
      })

      expect(store.getBronzeCount()).toBe(0)
    })
  })

  describe('7. Deduplication & Append-Only WORM Ledger', () => {
    beforeEach(async () => {
      await consentService.registerConsent({
        consent_ref: 'consent-test-01',
        patient_ref: 'patient-test-01',
        purpose: 'C2',
        notice_hash: 'hash-abc',
      })
    })

    it('deduplicates identical events on replay (1st accepted, 2nd duplicate)', async () => {
      const event1 = createTestEvent({ event_id: generateUlid() })
      const event2 = createTestEvent({ event_id: generateUlid() })

      // First submission
      const res1 = await gatewayService.handleBatch({ events: [event1, event2] })
      expect(res1.body.results[0].status).toBe('accepted')
      expect(res1.body.results[1].status).toBe('accepted')
      expect(store.getBronzeCount()).toBe(2)

      // Replay identical batch
      const res2 = await gatewayService.handleBatch({ events: [event1, event2] })
      expect(res2.body.results[0].status).toBe('duplicate')
      expect(res2.body.results[1].status).toBe('duplicate')
      expect(store.getBronzeCount()).toBe(2)
    })

    it('enforces WORM immutability: UPDATE and DELETE operations throw', () => {
      expect(() => store.updateBronze()).toThrow(
        /WORM Ledger Invariant Violation: UPDATE prohibited/,
      )
      expect(() => store.deleteBronze()).toThrow(
        /WORM Ledger Invariant Violation: DELETE prohibited/,
      )
    })
  })

  describe('8. Batch Idempotency-Key Header', () => {
    beforeEach(async () => {
      await consentService.registerConsent({
        consent_ref: 'consent-test-01',
        patient_ref: 'patient-test-01',
        purpose: 'C2',
        notice_hash: 'hash-abc',
      })
    })

    it('short-circuits retry using Idempotency-Key returning cached batch response', async () => {
      const event = createTestEvent({ event_id: generateUlid() })
      const idempotencyKey = 'sha256-idempotency-key-001'

      // First call
      const res1 = await gatewayService.handleBatch(
        { events: [event] },
        { 'idempotency-key': idempotencyKey },
      )
      expect(res1.cached).toBe(false)
      expect(res1.body.results[0].status).toBe('accepted')

      // Second call with same idempotency key
      const res2 = await gatewayService.handleBatch(
        { events: [event] },
        { 'idempotency-key': idempotencyKey },
      )
      expect(res2.cached).toBe(true)
      expect(res2.body.batch_id).toBe(res1.body.batch_id)
      expect(res2.body.results).toEqual(res1.body.results)
    })
  })

  describe('9. Shadow Mode (X-NS-Shadow: 1)', () => {
    beforeEach(async () => {
      await consentService.registerConsent({
        consent_ref: 'consent-test-01',
        patient_ref: 'patient-test-01',
        purpose: 'C2',
        notice_hash: 'hash-abc',
      })
    })

    it('routes ingested events to shadow store and leaves bronze untouched', async () => {
      const event = createTestEvent({ event_id: generateUlid() })

      const res = await gatewayService.handleBatch(
        { events: [event] },
        { 'X-NS-Shadow': '1' },
      )

      expect(res.body.results[0].status).toBe('accepted')
      expect(store.getBronzeCount()).toBe(0)
      expect(store.getShadowCount()).toBe(1)
    })
  })

  describe('10. Backpressure & Queue Thresholds', () => {
    it('returns HTTP 429 with Retry-After when queue depth exceeds 5000', async () => {
      store.setQueueDepth(5500)

      const event = createTestEvent()
      await expect(gatewayService.handleBatch({ events: [event] })).rejects.toMatchObject({
        statusCode: 429,
        retryAfter: expect.any(Number),
      })
    })
  })

  describe('11. Full HTTP App & API Routes Integration', () => {
    let app: ReturnType<typeof createApiApp>

    beforeEach(() => {
      app = createApiApp({ store, consentService, gatewayService })
    })

    it('serves health probe at /health, /healthz and /v1/health', async () => {
      const mockReq = { url: '/v1/health', method: 'GET', headers: {} } as any
      let statusCode = 0
      let responseData = ''

      const mockRes = {
        writeHead: (code: number) => {
          statusCode = code
        },
        end: (data: string) => {
          responseData = data
        },
      } as any

      await app.requestListener(mockReq, mockRes)
      expect(statusCode).toBe(200)
      const parsed = JSON.parse(responseData)
      expect(parsed.status).toBe('ok')
      expect(parsed.service).toBe('nutriscore-api')
    })

    it('handles consent registration, lookup and revocation over HTTP', async () => {
      // 1. Register consent
      const regReq = {
        url: '/v1/consent/register',
        method: 'POST',
        headers: {},
        on: (event: string, cb: any) => {
          if (event === 'data') {
            cb(
              JSON.stringify({
                consent_ref: 'http-consent-01',
                patient_ref: 'patient-http-01',
                purpose: 'C2',
                notice_hash: 'hash-http',
              }),
            )
          }
          if (event === 'end') cb()
        },
      } as any

      let statusCode = 0
      let responseData = ''
      const mockRes = {
        writeHead: (code: number) => {
          statusCode = code
        },
        end: (data: string) => {
          responseData = data
        },
      } as any

      await app.requestListener(regReq, mockRes)
      expect(statusCode).toBe(200)
      expect(JSON.parse(responseData).ok).toBe(true)

      // 2. Lookup consent
      const getReq = {
        url: '/v1/consent/http-consent-01',
        method: 'GET',
        headers: {},
      } as any

      await app.requestListener(getReq, mockRes)
      expect(statusCode).toBe(200)
      const lookup = JSON.parse(responseData)
      expect(lookup.active).toBe(true)
      expect(lookup.consent.purpose).toBe('C2')

      // 3. Revoke consent
      const revokeReq = {
        url: '/v1/consent/revoke',
        method: 'POST',
        headers: {},
        on: (event: string, cb: any) => {
          if (event === 'data') {
            cb(JSON.stringify({ consent_ref: 'http-consent-01' }))
          }
          if (event === 'end') cb()
        },
      } as any

      await app.requestListener(revokeReq, mockRes)
      expect(statusCode).toBe(200)

      // 4. Verify lookup is now inactive
      await app.requestListener(getReq, mockRes)
      expect(statusCode).toBe(200)
      expect(JSON.parse(responseData).active).toBe(false)
    })
  })

  describe('12. End-to-End Client Flush to Gateway Integration', () => {
    let app: ReturnType<typeof createApiApp>

    beforeEach(() => {
      app = createApiApp({ store, consentService, gatewayService })
    })

    it('flushes client queue successfully to gateway and deletes accepted events', async () => {
      // 1. Register active consent
      await consentService.registerConsent({
        consent_ref: 'client-consent-01',
        patient_ref: 'patient-client-01',
        purpose: 'C2',
        notice_hash: 'hash-client-notice',
      })

      // 2. Enqueue 2 events on device
      await enqueueTelemetryEvent({
        type: 'cart_item_added',
        shopperRef: 'shopper-c1',
        retailer: 'carrefour',
        cartEpisodeId: 'ep-001',
        consentRef: 'client-consent-01',
        payload: { product_ref: 'item-1' },
      })
      await enqueueTelemetryEvent({
        type: 'cart_item_added',
        shopperRef: 'shopper-c1',
        retailer: 'carrefour',
        cartEpisodeId: 'ep-001',
        consentRef: 'client-consent-01',
        payload: { product_ref: 'item-2' },
      })

      const queueBefore = await activeDbMock._queueStore.getAll()
      expect(queueBefore.length).toBe(2)

      // 3. Custom fetch bridge to our gateway
      const bridgeFetch: any = async (_url: string, init: any) => {
        let statusCode = 200
        let resHeaders: Record<string, string> = {}
        let responseBody = ''

        const fakeReq = {
          url: '/v1/telemetry/batch',
          method: 'POST',
          headers: init.headers || {},
          on: (event: string, cb: any) => {
            if (event === 'data') cb(init.body)
            if (event === 'end') cb()
          },
        }
        const fakeRes = {
          writeHead: (code: number, headers: any) => {
            statusCode = code
            resHeaders = headers || {}
          },
          end: (data: string) => {
            responseBody = data
          },
        }

        await app.requestListener(fakeReq as any, fakeRes as any)

        return {
          ok: statusCode >= 200 && statusCode < 300,
          status: statusCode,
          headers: {
            get: (name: string) => resHeaders[name] || null,
          },
          json: async () => JSON.parse(responseBody),
        }
      }

      // 4. Flush queue
      const flushResult = await flushTelemetryQueue(bridgeFetch)
      expect(flushResult.flushed).toBe(2)
      expect(flushResult.accepted).toBe(2)
      expect(flushResult.rejected).toBe(0)

      // Accepted events removed from device queue
      const queueAfter = await activeDbMock._queueStore.getAll()
      expect(queueAfter.length).toBe(0)

      // Ingested into gateway shadow store (default header X-NS-Shadow: 1)
      expect(store.getShadowCount()).toBe(2)
    })
  })
})
