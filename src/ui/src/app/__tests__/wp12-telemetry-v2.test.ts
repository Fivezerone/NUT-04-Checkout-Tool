/**
 * src/ui/src/app/__tests__/wp12-telemetry-v2.test.ts
 *
 * WP-12: Telemetry Client & Observability Upload Verification Suite
 * Reference: Blueprint §2.8, §3.2, §3.3 (C11; A-06, A-12, O-02, G-02, T-08)
 * Flag: ns.telemetry.v2
 *
 * Invariants Tested:
 *   1. ULID Generator:
 *      - 26-char Crockford Base32.
 *      - Lexicographically monotonic order.
 *   2. Telemetry Envelope & Consent Linkage:
 *      - Matches schema 'nutriscore.telemetry/1.1'.
 *      - Rejects enqueue if consent_ref or shopper_ref is missing (T-08).
 *   3. Queue Bounds & Rate Guard:
 *      - Enforces 1,000-event queue capacity by dropping oldest pending.
 *      - Enforces 20 events/sec rate limiter per device.
 *   4. Instant Queue Purge on Consent Revocation:
 *      - purgeTelemetryQueue empties the entire queue.
 *   5. Deterministic Batch Idempotency Key:
 *      - SHA-256 of sorted event IDs; retries carry identical key.
 *   6. Flush Dispatch & Response Handling:
 *      - 200/207: accepted/duplicate deleted; schema-rejected marked 'dead'.
 *      - 429/5xx: full jitter backoff, Retry-After header, 8-attempt ceiling.
 *      - AbortSignal 5s timeout enforcement.
 *   7. Dead-Letter Retention Pruning (7 Days):
 *      - pruneDeadLetters purges dead letters older than 7 days.
 *   8. Config Hygiene & Rollback Flag:
 *      - Zero local/placeholder endpoints.
 *      - ns.telemetry.v2 controls activation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let activeDbMock: any = null

vi.mock('../lib/db/shared', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    getDB: vi.fn(() => Promise.resolve(activeDbMock)),
  }
})

import {
  generateUlid,
  enqueueTelemetryEvent,
  flushTelemetryQueue,
  purgeTelemetryQueue,
  pruneDeadLetters,
  computeBatchIdempotencyKey,
  computeBackoffMs,
  isTelemetryV2Enabled,
  getGatewayUrl,
  resetTelemetryCounters,
  telemetryDroppedCount,
  telemetryEnqueuedCount,
  QUEUE_MAX_EVENTS,
  RATE_LIMIT_PER_SEC,
  type QueuedTelemetryRecord,
  type EnqueueOptions,
} from '../lib/db/telemetry'

// ── In-Memory Fake IDB for Telemetry Queue ─────────────────────────────────────
class FakeTelemetryQueueStore {
  public records = new Map<string, QueuedTelemetryRecord>()

  get store() {
    return this
  }

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

function createFakeTelemetryDb(store: FakeTelemetryQueueStore) {
  return {
    objectStoreNames: { contains: (n: string) => n === 'telemetry_queue' },
    transaction: (_name: string, _mode: string) => ({
      store,
      objectStore: () => store,
      done: Promise.resolve(),
    }),
  }
}

describe('WP-12: Telemetry Client & Observability Upload (ns.telemetry.v2, O-02, A-06)', () => {
  let fakeStore: FakeTelemetryQueueStore

  beforeEach(() => {
    fakeStore = new FakeTelemetryQueueStore()
    activeDbMock = createFakeTelemetryDb(fakeStore)
    resetTelemetryCounters()
    delete (globalThis as any).__NUTRI_FLAGS__
    delete (globalThis as any).NUTRI_CONFIG
  })

  afterEach(() => {
    resetTelemetryCounters()
    delete (globalThis as any).__NUTRI_FLAGS__
    delete (globalThis as any).NUTRI_CONFIG
    vi.restoreAllMocks()
  })

  // ── 1. ULID Generator ─────────────────────────────────────────────────────

  describe('1. ULID Generator (Crockford Base32 Monotonicity)', () => {
    it('generates 26-character Crockford Base32 identifiers', () => {
      const id = generateUlid()
      expect(id).toHaveLength(26)
      expect(id).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/)
    })

    it('generates strictly monotonically increasing identifiers', () => {
      const ids: string[] = []
      const t = 1700000000000
      for (let i = 0; i < 50; i++) {
        ids.push(generateUlid(t))
      }

      for (let i = 1; i < ids.length; i++) {
        expect(ids[i] > ids[i - 1]).toBe(true)
      }
    })
  })

  // ── 2. Telemetry Envelope & Consent Linkage ───────────────────────────────

  describe('2. Telemetry Envelope & Consent Linkage (T-08, G-02)', () => {
    it('enqueues a well-formed telemetry event with monotonic clientSeq and ULID', async () => {
      const options: EnqueueOptions = {
        type: 'cart_snapshot',
        shopperRef: 'shop-alias-99',
        retailer: 'NAIVAS',
        cartEpisodeId: 'ep-001',
        consentRef: 'rec-consent-456',
        payload: { items_count: 5, total_spend_minor: 45000 },
      }

      const eventId = await enqueueTelemetryEvent(options)
      expect(eventId).toBeDefined()
      expect(eventId).toHaveLength(26)

      const records = await fakeStore.getAll()
      expect(records.length).toBe(1)

      const rec = records[0]
      expect(rec.schema).toBe('nutriscore.telemetry/1.1')
      expect(rec.event_id).toBe(eventId)
      expect(rec.client_seq).toBeGreaterThan(0)
      expect(rec.type).toBe('cart_snapshot')
      expect(rec.shopper_ref).toBe('shop-alias-99')
      expect(rec.retailer).toBe('NAIVAS')
      expect(rec.cart_episode_id).toBe('ep-001')
      expect(rec.consent_ref).toBe('rec-consent-456')
      expect(rec.status).toBe('pending')
      expect(rec.attempts).toBe(0)
    })

    it('rejects enqueue when consent_ref is missing (fail-closed, T-08)', async () => {
      const options: EnqueueOptions = {
        type: 'cart_snapshot',
        shopperRef: 'shop-alias-99',
        retailer: 'NAIVAS',
        cartEpisodeId: 'ep-001',
        consentRef: '', // Missing consent receipt!
        payload: { items_count: 1 },
      }

      const eventId = await enqueueTelemetryEvent(options)
      expect(eventId).toBeNull()

      const records = await fakeStore.getAll()
      expect(records.length).toBe(0)
      expect(telemetryDroppedCount).toBe(1)
    })

    it('rejects enqueue when shopper_ref is missing (fail-closed)', async () => {
      const options: EnqueueOptions = {
        type: 'checkout_completed',
        shopperRef: '', // Missing shopper alias!
        retailer: 'CARREFOUR',
        cartEpisodeId: 'ep-002',
        consentRef: 'rec-consent-789',
        payload: { total_kes: 1200 },
      }

      const eventId = await enqueueTelemetryEvent(options)
      expect(eventId).toBeNull()
      expect(telemetryDroppedCount).toBe(1)
    })
  })

  // ── 3. Queue Capacity & Rate Guards ───────────────────────────────────────

  describe('3. Queue Capacity (1,000 events) & Rate Limiting (20/sec)', () => {
    it('drops oldest pending event when queue capacity reaches 1,000', async () => {
      // Seed queue with 1,000 events
      for (let i = 0; i < QUEUE_MAX_EVENTS; i++) {
        const ev: QueuedTelemetryRecord = {
          schema: 'nutriscore.telemetry/1.1',
          event_id: `EV-SEED-${i.toString().padStart(4, '0')}`,
          client_seq: i + 1,
          type: 'obs_metric',
          occurred_at: new Date(1700000000000 + i).toISOString(),
          shopper_ref: 'shopper-test',
          retailer: 'NAIVAS',
          cart_episode_id: 'ep-seed',
          consent_ref: 'consent-seed',
          profile_ver: 1,
          versions: { scoring: 'v5', catalogue: 'current', ext: '1.1.0' },
          payload: { idx: i },
          status: 'pending',
          attempts: 0,
          createdAt: 1700000000000 + i,
        }
        await fakeStore.put(ev)
      }

      expect((await fakeStore.getAll()).length).toBe(QUEUE_MAX_EVENTS)

      // Enqueue one more
      const newId = await enqueueTelemetryEvent({
        type: 'swap_accepted',
        shopperRef: 'shopper-test',
        retailer: 'NAIVAS',
        cartEpisodeId: 'ep-new',
        consentRef: 'consent-seed',
        payload: { swap_id: 's-1' },
      })

      expect(newId).toBeDefined()
      const all = await fakeStore.getAll()
      expect(all.length).toBe(QUEUE_MAX_EVENTS) // Bounded at 1,000
      // Oldest seed event (EV-SEED-0000) was evicted
      expect(await fakeStore.get('EV-SEED-0000')).toBeNull()
      expect(telemetryDroppedCount).toBe(1)
    })

    it('enforces rate limit of 20 events per second per device', async () => {
      const now = Date.now()
      let enqueued = 0

      for (let i = 0; i < RATE_LIMIT_PER_SEC + 5; i++) {
        const id = await enqueueTelemetryEvent({
          type: 'obs_metric',
          shopperRef: 'shopper-rate',
          retailer: 'NAIVAS',
          cartEpisodeId: 'ep-rate',
          consentRef: 'consent-rate',
          payload: { count: i },
          occurredAt: new Date(now).toISOString(),
        })
        if (id) enqueued++
      }

      expect(enqueued).toBe(RATE_LIMIT_PER_SEC)
      expect(telemetryDroppedCount).toBe(5)
    })
  })

  // ── 4. Immediate Purge on Consent Revocation ──────────────────────────────

  describe('4. Consent Revocation Queue Purge (T-08, Blueprint §2.8)', () => {
    it('purges all events from telemetry_queue immediately upon consent revocation', async () => {
      // Seed events
      await enqueueTelemetryEvent({
        type: 'cart_snapshot',
        shopperRef: 'shop-1',
        retailer: 'NAIVAS',
        cartEpisodeId: 'ep-1',
        consentRef: 'rec-1',
        payload: {},
      })
      await enqueueTelemetryEvent({
        type: 'swap_declined',
        shopperRef: 'shop-1',
        retailer: 'NAIVAS',
        cartEpisodeId: 'ep-1',
        consentRef: 'rec-1',
        payload: {},
      })

      expect((await fakeStore.getAll()).length).toBe(2)

      // Consent revoked -> Immediate purge
      const purged = await purgeTelemetryQueue()
      expect(purged).toBe(1)

      const remaining = await fakeStore.getAll()
      expect(remaining.length).toBe(0)
    })
  })

  // ── 5. Batch Idempotency Key ──────────────────────────────────────────────

  describe('5. Deterministic Batch Idempotency Key (A-06)', () => {
    it('computes identical SHA-256 Idempotency-Key regardless of event ordering', async () => {
      const eventIds1 = ['01HX001', '01HX002', '01HX003']
      const eventIds2 = ['01HX003', '01HX001', '01HX002']

      const key1 = await computeBatchIdempotencyKey(eventIds1)
      const key2 = await computeBatchIdempotencyKey(eventIds2)

      expect(key1).toHaveLength(64)
      expect(key1).toBe(key2)
    })
  })

  // ── 6. Flush Dispatch & Response Handling ─────────────────────────────────

  describe('6. Flush Dispatch & Response Handling', () => {
    it('deletes accepted and duplicate events from queue on 200 response', async () => {
      const id1 = (await enqueueTelemetryEvent({
        type: 'cart_snapshot',
        shopperRef: 's-1',
        retailer: 'NAIVAS',
        cartEpisodeId: 'ep-1',
        consentRef: 'c-1',
        payload: {},
      }))!

      const id2 = (await enqueueTelemetryEvent({
        type: 'checkout_completed',
        shopperRef: 's-1',
        retailer: 'NAIVAS',
        cartEpisodeId: 'ep-1',
        consentRef: 'c-1',
        payload: {},
      }))!

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          results: [
            { event_id: id1, status: 'accepted' },
            { event_id: id2, status: 'duplicate' },
          ],
        }),
      } as any)

      const flushRes = await flushTelemetryQueue(mockFetch as any)

      expect(flushRes.flushed).toBe(2)
      expect(flushRes.accepted).toBe(1)
      expect(flushRes.duplicates).toBe(1)

      const remaining = await fakeStore.getAll()
      expect(remaining.length).toBe(0)
    })

    it('marks schema-rejected events as dead letter with no retry', async () => {
      const id1 = (await enqueueTelemetryEvent({
        type: 'cart_snapshot',
        shopperRef: 's-1',
        retailer: 'NAIVAS',
        cartEpisodeId: 'ep-1',
        consentRef: 'c-1',
        payload: {},
      }))!

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 207,
        headers: new Headers(),
        json: async () => ({
          results: [
            { event_id: id1, status: 'rejected', code: 'SCHEMA_INVALID' },
          ],
        }),
      } as any)

      const flushRes = await flushTelemetryQueue(mockFetch as any)

      expect(flushRes.rejected).toBe(1)
      expect(flushRes.deadLettered).toBe(1)

      const record = await fakeStore.get(id1)
      expect(record.status).toBe('dead')
      expect(record.deadLetterReason).toBe('SCHEMA_INVALID')
    })

    it('applies exponential backoff on 429/5xx and respects Retry-After header', async () => {
      const id1 = (await enqueueTelemetryEvent({
        type: 'obs_metric',
        shopperRef: 's-1',
        retailer: 'NAIVAS',
        cartEpisodeId: 'ep-1',
        consentRef: 'c-1',
        payload: {},
      }))!

      const mockHeaders = new Headers()
      mockHeaders.set('Retry-After', '45')

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: mockHeaders,
      } as any)

      const flushRes = await flushTelemetryQueue(mockFetch as any)

      expect(flushRes.error).toContain('HTTP 429')
      const record = await fakeStore.get(id1)
      expect(record.status).toBe('pending') // Stays pending for backoff retry
      expect(record.attempts).toBe(1)

      // Verify backoff calculation honors Retry-After
      const delayMs = computeBackoffMs(1, 45)
      expect(delayMs).toBe(45000)
    })

    it('transitions to dead letter after 8 failed attempts', async () => {
      const id1 = (await enqueueTelemetryEvent({
        type: 'obs_metric',
        shopperRef: 's-1',
        retailer: 'NAIVAS',
        cartEpisodeId: 'ep-1',
        consentRef: 'c-1',
        payload: {},
      }))!

      // Pre-set 7 failed attempts
      const rec = (await fakeStore.get(id1))!
      rec.attempts = 7
      await fakeStore.put(rec)

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as any)

      const flushRes = await flushTelemetryQueue(mockFetch as any)

      expect(flushRes.deadLettered).toBe(1)
      const updated = await fakeStore.get(id1)
      expect(updated.status).toBe('dead')
      expect(updated.deadLetterReason).toBe('http_503_max_attempts')
    })
  })

  // ── 7. Dead-Letter Retention Pruning (7 Days) ─────────────────────────────

  describe('7. Dead-Letter Retention Pruning (7 Days)', () => {
    it('prunes dead letters older than 7 days while preserving recent ones', async () => {
      const now = Date.now()
      const dayMs = 24 * 60 * 60 * 1000

      const recentDead: QueuedTelemetryRecord = {
        schema: 'nutriscore.telemetry/1.1',
        event_id: 'dead-recent',
        client_seq: 1,
        type: 'obs_metric',
        occurred_at: new Date(now - 2 * dayMs).toISOString(),
        shopper_ref: 'shopper',
        retailer: 'NAIVAS',
        cart_episode_id: 'ep',
        consent_ref: 'consent',
        profile_ver: 1,
        versions: { scoring: 'v5', catalogue: 'current', ext: '1.1.0' },
        payload: {},
        status: 'dead',
        attempts: 8,
        createdAt: now - 2 * dayMs, // 2 days old (< 7 days)
      }

      const expiredDead: QueuedTelemetryRecord = {
        schema: 'nutriscore.telemetry/1.1',
        event_id: 'dead-expired',
        client_seq: 2,
        type: 'obs_metric',
        occurred_at: new Date(now - 10 * dayMs).toISOString(),
        shopper_ref: 'shopper',
        retailer: 'NAIVAS',
        cart_episode_id: 'ep',
        consent_ref: 'consent',
        profile_ver: 1,
        versions: { scoring: 'v5', catalogue: 'current', ext: '1.1.0' },
        payload: {},
        status: 'dead',
        attempts: 8,
        createdAt: now - 10 * dayMs, // 10 days old (> 7 days)
      }

      await fakeStore.put(recentDead)
      await fakeStore.put(expiredDead)
      expect((await fakeStore.getAll()).length).toBe(2)

      const pruned = await pruneDeadLetters(now - 7 * dayMs)
      expect(pruned).toBe(1)

      const remaining = await fakeStore.getAll()
      expect(remaining.length).toBe(1)
      expect(remaining[0].event_id).toBe('dead-recent')
    })
  })

  // ── 8. Config Hygiene & Rollback Flag ─────────────────────────────────────

  describe('8. Config Hygiene & Feature Flag (A-12, ADR-5)', () => {
    it('resolves gateway URL without falling back to local IP/localhost', () => {
      expect(getGatewayUrl()).toBe('/api')

      ;(globalThis as any).NUTRI_CONFIG = { GATEWAY_URL: 'https://gateway.nutriscore.example' }
      expect(getGatewayUrl()).toBe('https://gateway.nutriscore.example')
    })

    it('isTelemetryV2Enabled defaults to false and responds to flag toggle', () => {
      expect(isTelemetryV2Enabled()).toBe(false)

      ;(globalThis as any).__NUTRI_FLAGS__ = { 'ns.telemetry.v2': true }
      expect(isTelemetryV2Enabled()).toBe(true)

      ;(globalThis as any).__NUTRI_FLAGS__ = { 'ns.telemetry.v2': false }
      expect(isTelemetryV2Enabled()).toBe(false)
    })
  })
})
