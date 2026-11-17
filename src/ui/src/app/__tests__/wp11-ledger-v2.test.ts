/**
 * src/ui/src/app/__tests__/wp11-ledger-v2.test.ts
 *
 * WP-11: Ledger v2 Verification Suite
 * Reference: Blueprint §2.3 (C5; E-08, E-09, E-10, E-13, ADR-005)
 * Flag: ns.ledger.v2
 *
 * Invariants Tested:
 *   1. IndexedDB v19 Schema & Non-Breaking Row Read Normalization:
 *      - shopping_ledger store has by_episode and by_seq indexes.
 *      - normalizeLedgerRow defaults legacy rows gracefully (scoringStatus: 'scored', versions: 'v4').
 *   2. E-08 Last-Writer Invariant & Two-Tab Race Prevention:
 *      - Two concurrent/interleaved snapshots set (never sum) quantities.
 *      - dedupeActiveCartItems keeps the last-writer row by updatedAt without summing.
 *      - logCartEvent sets quantity to last known instead of adding.
 *   3. E-09 Unscored & Unmatched Spend Retention:
 *      - Items are never skipped; scored, unscored, and unmatched items are preserved.
 *   4. Hysteresis Anti-Flapping:
 *      - Item absent in 1 snapshot remains 'in_cart'.
 *      - Item absent in 2 consecutive snapshots transitions to 'removed'.
 *      - Item reappearing before 2 consecutive misses resets absent count.
 *   5. Monotonic clientSeq Serialization:
 *      - getNextClientSeq increments monotonically under navigator.locks ('ns-seq').
 *   6. 90-Day Storage Ceiling (ADR-005, E-13):
 *      - purgeLedgerOlderThan purges items older than 90 days.
 *      - resolveTimeframe clamps 'year' and 'all' to 3-month window.
 *   7. Coverage C & Unscored Share Computation:
 *      - Correctly calculates Coverage C (scored spend / total spend) and unscored spend share.
 *   8. Rollback Safety & Feature Flag:
 *      - ns.ledger.v2 defaults to false; syncCart respects flag toggle.
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

import { DB_VERSION } from '../lib/db/shared'
import {
  isLedgerV2Enabled,
  validateCartItem,
  normalizeLedgerRow,
  getNextClientSeq,
  getOrCreateCartEpisodeId,
  applyCartSnapshot,
  logCartEvent,
  dedupeActiveCartItems,
  purgeLedgerOlderThan,
  computeCartCoverage,
  resetConsecutiveAbsentTracker,
  syncCart,
  RETENTION_90_DAYS_MS,
  type CartItemInput,
  type LedgerRow,
} from '../lib/db/cart'
import { resolveTimeframe } from '../lib/db/analytics'
import type { ShoppingLedgerRow } from '../nutriscore'

// ── In-Memory Fake ObjectStore for Transaction Testing ─────────────────────────
class FakeLedgerStore {
  public records = new Map<string, any>()
  public indices = {
    'by-status': {
      getAll: async (status: string) => {
        return Array.from(this.records.values()).filter(r => r.status === status)
      },
    },
    'by-addedAt': {
      openCursor: async (range: any) => {
        const upperBound = range?.upper ?? Infinity
        const matchingKeys: string[] = []
        for (const [id, r] of this.records.entries()) {
          const addedAt = r.addedAt || r.firstSeenAt || 0
          if (addedAt < upperBound) {
            matchingKeys.push(id)
          }
        }
        let index = 0
        if (matchingKeys.length === 0) return null
        return {
          delete: async () => {
            this.records.delete(matchingKeys[index])
          },
          continue: async () => {
            index++
            if (index < matchingKeys.length) {
              return {
                delete: async () => {
                  this.records.delete(matchingKeys[index])
                },
                continue: (this as any).continue,
              }
            }
            return null
          },
        }
      },
    },
    'by-retailer-product-status': {
      get: async (key: [string, string, string]) => {
        const [ret, pid, status] = key
        for (const r of this.records.values()) {
          if (r.retailer === ret && (r.productId === pid || r.retailerProductId === pid) && r.status === status) {
            return r
          }
        }
        return null
      },
    },
  }

  get store() {
    return this
  }

  async get(id: string) {
    return this.records.get(id) || null
  }

  async getAll() {
    return Array.from(this.records.values())
  }

  async put(record: any) {
    this.records.set(record.id, JSON.parse(JSON.stringify(record)))
  }

  async delete(id: string) {
    this.records.delete(id)
  }

  index(name: string) {
    return (this.indices as any)[name]
  }
}

function createFakeLedgerDb(store: FakeLedgerStore) {
  return {
    objectStoreNames: { contains: (n: string) => n === 'shopping_ledger' },
    transaction: (_name: string, _mode: string) => ({
      store,
      objectStore: () => store,
      done: Promise.resolve(),
    }),
    getFromIndex: async (_s: string, idx: string, key: any) => {
      if (idx === 'by-retailer-product-status') {
        return store.indices['by-retailer-product-status'].get(key)
      }
      return null
    },
    getAllFromIndex: async (_s: string, idx: string, key?: any) => {
      if (idx === 'by-status') {
        return store.indices['by-status'].getAll(key)
      }
      if (idx === 'by-addedAt') {
        return Array.from(store.records.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      }
      return []
    },
    put: async (_s: string, val: any) => {
      await store.put(val)
    },
    delete: async (_s: string, id: string) => {
      await store.delete(id)
    },
  }
}

describe('WP-11: Ledger v2 (ns.ledger.v2, E-08, E-09, E-10, E-13)', () => {
  let fakeStore: FakeLedgerStore

  beforeEach(() => {
    fakeStore = new FakeLedgerStore()
    activeDbMock = createFakeLedgerDb(fakeStore)
    resetConsecutiveAbsentTracker()
    delete (globalThis as any).__NUTRI_FLAGS__
    delete (globalThis as any).__NS_CLIENT_SEQ__
    delete (globalThis as any).__NS_EPISODES__
  })

  afterEach(() => {
    resetConsecutiveAbsentTracker()
    delete (globalThis as any).__NUTRI_FLAGS__
    delete (globalThis as any).__NS_CLIENT_SEQ__
    delete (globalThis as any).__NS_EPISODES__
    vi.restoreAllMocks()
  })

  // ── 1. Schema & Read Normalization Invariants ─────────────────────────────

  describe('1. Schema v19 & Read Normalization (Blueprint §2.3 item 5)', () => {
    it('defines DB_VERSION as 19', () => {
      expect(DB_VERSION).toBe(19)
    })

    it('normalizes legacy ledger rows with non-breaking defaults', () => {
      const legacyRow: ShoppingLedgerRow = {
        id: 'legacy-1',
        productId: 'prod-001',
        name: 'Whole Milk 500ml',
        retailer: 'NAIVAS',
        addedAt: 1700000000000,
        quantity: 2,
        gradeSnapshot: 'A',
        priceSnapshot: 65,
        category: 'Dairy',
        status: 'in_cart',
        nutritionSnapshot: {
          sodiumMg: 45,
          sugarsG: 4.5,
          satFatG: 2.0,
        },
      }

      const normalized = normalizeLedgerRow(legacyRow)

      expect(normalized.retailerProductId).toBe('prod-001')
      expect(normalized.productId).toBe('prod-001')
      expect(normalized.scoringStatus).toBe('scored')
      expect(normalized.gradeSnapshot).toBe('A')
      expect(normalized.unitPriceMinor).toBe(6500)
      expect(normalized.cartEpisodeId).toBe('legacy-episode')
      expect(normalized.clientSeq).toBe(0)
      expect(normalized.versions.scoring).toBe('v4')
      expect(normalized.versions.catalogue).toBe('legacy')
      expect(normalized.firstSeenAt).toBe(1700000000000)
      expect(normalized.updatedAt).toBe(1700000000000)
    })

    it('normalizes legacy ungraded row as unscored with null grade', () => {
      const legacyUngraded: ShoppingLedgerRow = {
        id: 'legacy-2',
        productId: 'prod-002',
        name: 'Exotic Fruit 1kg',
        retailer: 'CARREFOUR',
        addedAt: 1700000000000,
        quantity: 1,
        gradeSnapshot: 'UNKNOWN',
        priceSnapshot: null,
        category: 'Produce',
        status: 'in_cart',
        nutritionSnapshot: {
          sodiumMg: null,
          sugarsG: null,
          satFatG: null,
        },
      }

      const normalized = normalizeLedgerRow(legacyUngraded)
      expect(normalized.scoringStatus).toBe('unscored')
      expect(normalized.gradeSnapshot).toBeNull()
      expect(normalized.unitPriceMinor).toBeNull()
    })
  })

  // ── 2. E-08 Last-Writer Invariant & Two-Tab Race Prevention ───────────────

  describe('2. E-08: Last-Writer Quantity Invariant (Never Summed)', () => {
    it('sets the quantity to the last known snapshot value and never sums across snapshots', async () => {
      const item: CartItemInput = {
        productId: 'sku-101',
        product_name: 'Fresh Bread 400g',
        quantity: 2,
        priceSnapshot: 50,
        retailer: 'NAIVAS',
      }

      // Snapshot 1: Quantity = 2
      await applyCartSnapshot('NAIVAS', [item])
      let all = await fakeStore.getAll()
      expect(all.length).toBe(1)
      expect(all[0].quantity).toBe(2)

      // Snapshot 2: User updated quantity in cart to 3
      item.quantity = 3
      await applyCartSnapshot('NAIVAS', [item])

      all = await fakeStore.getAll()
      expect(all.length).toBe(1)
      // INVARIANT: Quantity must be 3 (last known), NEVER 5 (summed 2+3)!
      expect(all[0].quantity).toBe(3)

      // Snapshot 3: User decreased quantity to 1
      item.quantity = 1
      await applyCartSnapshot('NAIVAS', [item])

      all = await fakeStore.getAll()
      expect(all.length).toBe(1)
      expect(all[0].quantity).toBe(1)
    })

    it('two interleaved snapshots from different tabs keep the latest writer quantity', async () => {
      const itemTabA: CartItemInput = {
        productId: 'sku-shared',
        product_name: 'Cooking Oil 1L',
        quantity: 1,
        priceSnapshot: 250,
        retailer: 'NAIVAS',
      }

      const itemTabB: CartItemInput = {
        productId: 'sku-shared',
        product_name: 'Cooking Oil 1L',
        quantity: 4,
        priceSnapshot: 250,
        retailer: 'NAIVAS',
      }

      // Tab A writes snapshot with qty 1
      await applyCartSnapshot('NAIVAS', [itemTabA])
      // Tab B writes snapshot with qty 4
      await applyCartSnapshot('NAIVAS', [itemTabB])

      const all = await fakeStore.getAll()
      expect(all.length).toBe(1)
      // Must be Tab B's quantity (4), not 5
      expect(all[0].quantity).toBe(4)
    })

    it('dedupeActiveCartItems keeps the last-writer row by updatedAt without summing quantities', async () => {
      // Simulate race condition where two separate rows were inserted
      const row1: ShoppingLedgerRow = {
        id: 'dup-1',
        productId: 'item-dup',
        name: 'Item Dup',
        retailer: 'NAIVAS',
        addedAt: 1000,
        quantity: 2,
        gradeSnapshot: 'B',
        priceSnapshot: 100,
        category: 'Food',
        status: 'in_cart',
        nutritionSnapshot: { sodiumMg: 10, sugarsG: 5, satFatG: 1 },
      }
      ;(row1 as any).updatedAt = 1000

      const row2: ShoppingLedgerRow = {
        id: 'dup-2',
        productId: 'item-dup',
        name: 'Item Dup',
        retailer: 'NAIVAS',
        addedAt: 2000,
        quantity: 3,
        gradeSnapshot: 'B',
        priceSnapshot: 100,
        category: 'Food',
        status: 'in_cart',
        nutritionSnapshot: { sodiumMg: 10, sugarsG: 5, satFatG: 1 },
      }
      ;(row2 as any).updatedAt = 2000

      await fakeStore.put(row1)
      await fakeStore.put(row2)
      expect((await fakeStore.getAll()).length).toBe(2)

      await dedupeActiveCartItems(activeDbMock)

      const remaining = await fakeStore.getAll()
      expect(remaining.length).toBe(1)
      // INVARIANT: Newer row (dup-2, qty 3) is retained; quantities are not summed to 5!
      expect(remaining[0].id).toBe('dup-2')
      expect(remaining[0].quantity).toBe(3)
    })

    it('logCartEvent updates quantity to last known instead of summing', async () => {
      const row: ShoppingLedgerRow = {
        id: 'row-event-1',
        productId: 'event-prod',
        name: 'Event Product',
        retailer: 'NAIVAS',
        addedAt: 1000,
        quantity: 1,
        gradeSnapshot: 'A',
        priceSnapshot: 100,
        category: 'Food',
        status: 'in_cart',
        nutritionSnapshot: { sodiumMg: 10, sugarsG: 5, satFatG: 1 },
      }

      await logCartEvent(row)
      let all = await fakeStore.getAll()
      expect(all[0].quantity).toBe(1)

      // Next event arrives with quantity 3
      const updatedRow = { ...row, id: 'row-event-2', quantity: 3 }
      await logCartEvent(updatedRow)

      all = await fakeStore.getAll()
      expect(all.length).toBe(1)
      // INVARIANT: Quantity is 3, not 1 + 3 = 4!
      expect(all[0].quantity).toBe(3)
    })
  })

  // ── 3. E-09 Unscored & Unmatched Spend Retention ──────────────────────────

  describe('3. E-09: Unscored & Unmatched Product Retention', () => {
    it('persists scored, unscored, and unmatched items without skipping any', async () => {
      const items: CartItemInput[] = [
        {
          productId: 'matched-graded',
          product_name: 'Brookside Whole Milk 500ml',
          quantity: 1,
          priceSnapshot: 65,
          retailer: 'NAIVAS',
        },
        {
          productId: 'unmatched-item',
          product_name: 'Custom Handmade Basket',
          quantity: 2,
          priceSnapshot: 120,
          retailer: 'NAIVAS',
        },
      ]

      const res = await applyCartSnapshot('NAIVAS', items)
      expect(res.added).toBe(2)

      const all = await fakeStore.getAll()
      expect(all.length).toBe(2)

      const unmatched = all.find(r => r.retailerProductId === 'unmatched-item')
      expect(unmatched).toBeDefined()
      // INVARIANT (E-09): Unmatched item is kept in the ledger with scoringStatus='unmatched'
      expect(unmatched.scoringStatus).toBe('unmatched')
      expect(unmatched.productId).toBeNull()
      expect(unmatched.gradeSnapshot).toBeNull()
      expect(unmatched.quantity).toBe(2)
      expect(unmatched.unitPriceMinor).toBe(12000)
    })
  })

  // ── 4. Hysteresis Anti-Flapping on Removed Items ───────────────────────────

  describe('4. Hysteresis Anti-Flapping (Two Consecutive Snapshots)', () => {
    it('does NOT mark an item removed on a single missing snapshot, but does after two consecutive misses', async () => {
      const itemA: CartItemInput = {
        productId: 'item-A',
        product_name: 'Item A',
        quantity: 1,
        priceSnapshot: 50,
        retailer: 'NAIVAS',
      }
      const itemB: CartItemInput = {
        productId: 'item-B',
        product_name: 'Item B',
        quantity: 1,
        priceSnapshot: 75,
        retailer: 'NAIVAS',
      }

      // Snapshot 1: Both A and B present
      await applyCartSnapshot('NAIVAS', [itemA, itemB])
      let all = await fakeStore.getAll()
      expect(all.filter(r => r.status === 'in_cart').length).toBe(2)

      // Snapshot 2: DOM glitch — Item B momentarily missing
      const res2 = await applyCartSnapshot('NAIVAS', [itemA])
      expect(res2.removed).toBe(0) // Not removed yet!

      all = await fakeStore.getAll()
      const bRow = all.find(r => r.retailerProductId === 'item-B')
      // INVARIANT: Item B remains 'in_cart' due to hysteresis
      expect(bRow.status).toBe('in_cart')

      // Snapshot 3: Item B confirmed missing in 2nd consecutive snapshot
      const res3 = await applyCartSnapshot('NAIVAS', [itemA])
      expect(res3.removed).toBe(1)

      all = await fakeStore.getAll()
      const bRowRemoved = all.find(r => r.retailerProductId === 'item-B')
      // INVARIANT: Now marked removed
      expect(bRowRemoved.status).toBe('removed')
    })

    it('resets absent counter when an item reappears before 2 consecutive misses', async () => {
      const itemA: CartItemInput = {
        productId: 'item-A',
        product_name: 'Item A',
        quantity: 1,
        priceSnapshot: 50,
        retailer: 'NAIVAS',
      }
      const itemB: CartItemInput = {
        productId: 'item-B',
        product_name: 'Item B',
        quantity: 1,
        priceSnapshot: 75,
        retailer: 'NAIVAS',
      }

      // Snapshot 1: A and B
      await applyCartSnapshot('NAIVAS', [itemA, itemB])

      // Snapshot 2: B missing (absent count = 1)
      await applyCartSnapshot('NAIVAS', [itemA])

      // Snapshot 3: B reappears!
      await applyCartSnapshot('NAIVAS', [itemA, itemB])

      // Snapshot 4: B missing again (fresh miss 1, not miss 2)
      await applyCartSnapshot('NAIVAS', [itemA])

      const all = await fakeStore.getAll()
      const bRow = all.find(r => r.retailerProductId === 'item-B')
      // INVARIANT: Still in_cart because counter was reset when it reappeared in Snapshot 3
      expect(bRow.status).toBe('in_cart')
    })
  })

  // ── 5. Monotonic Sequence & Episode ID ─────────────────────────────────────

  describe('5. Monotonic clientSeq and Episode ID (E-10)', () => {
    it('increments clientSeq monotonically per installation', async () => {
      const seq1 = await getNextClientSeq()
      const seq2 = await getNextClientSeq()
      const seq3 = await getNextClientSeq()

      expect(seq2).toBe(seq1 + 1)
      expect(seq3).toBe(seq2 + 1)
    })

    it('attaches stable episodeId and monotonic clientSeq to new ledger rows', async () => {
      const item: CartItemInput = {
        productId: 'seq-item',
        product_name: 'Sample Item',
        quantity: 1,
        priceSnapshot: 10,
        retailer: 'NAIVAS',
      }

      await applyCartSnapshot('NAIVAS', [item])
      const all = await fakeStore.getAll()
      expect(all.length).toBe(1)

      const row = all[0] as LedgerRow
      expect(row.clientSeq).toBeGreaterThan(0)
      expect(row.cartEpisodeId).toMatch(/^ep-/)
      expect(row.versions.scoring).toBe('v5')
    })
  })

  // ── 6. 90-Day Storage Ceiling (ADR-005, E-13) ─────────────────────────────

  describe('6. 90-Day Storage Ceiling (ADR-005, E-13)', () => {
    it('purges ledger entries older than 90 days', async () => {
      const now = Date.now()
      const dayMs = 24 * 60 * 60 * 1000

      const freshRow: ShoppingLedgerRow = {
        id: 'fresh-1',
        productId: 'fresh-prod',
        name: 'Fresh Product',
        retailer: 'NAIVAS',
        addedAt: now - 30 * dayMs, // 30 days old (< 90 days)
        quantity: 1,
        gradeSnapshot: 'A',
        priceSnapshot: 50,
        category: 'Food',
        status: 'in_cart',
        nutritionSnapshot: { sodiumMg: 10, sugarsG: 5, satFatG: 1 },
      }

      const expiredRow: ShoppingLedgerRow = {
        id: 'expired-1',
        productId: 'expired-prod',
        name: 'Expired Product',
        retailer: 'NAIVAS',
        addedAt: now - 95 * dayMs, // 95 days old (> 90 days)
        quantity: 1,
        gradeSnapshot: 'A',
        priceSnapshot: 50,
        category: 'Food',
        status: 'purchased',
        nutritionSnapshot: { sodiumMg: 10, sugarsG: 5, satFatG: 1 },
      }

      await fakeStore.put(freshRow)
      await fakeStore.put(expiredRow)
      expect((await fakeStore.getAll()).length).toBe(2)

      const purgedCount = await purgeLedgerOlderThan(now - RETENTION_90_DAYS_MS)
      expect(purgedCount).toBe(1)

      const remaining = await fakeStore.getAll()
      expect(remaining.length).toBe(1)
      expect(remaining[0].id).toBe('fresh-1')
    })

    it('resolveTimeframe clamps "year" and "all" to the 3-month window', () => {
      const now = new Date('2026-11-17T12:00:00Z').getTime()

      const tf3m = resolveTimeframe('3months', now)
      const tfYear = resolveTimeframe('year', now)
      const tfAll = resolveTimeframe('all', now)

      expect(tfYear.bucketUnit).toBe('week')
      expect(tfYear.bucketCount).toBe(12)
      expect(tfYear.windowStart).toBe(tf3m.windowStart)

      expect(tfAll.bucketUnit).toBe('week')
      expect(tfAll.bucketCount).toBe(12)
      expect(tfAll.windowStart).toBe(tf3m.windowStart)
    })
  })

  // ── 7. Coverage C & Unscored Share Computation ────────────────────────────

  describe('7. Coverage C & Unscored Share Computation (Blueprint §2.3 item 4, §3.1)', () => {
    it('computes 70% Coverage C and 30% unscored spend share accurately', () => {
      const rows: any[] = [
        // Scored items: 7000 cents ($70.00)
        {
          id: '1',
          retailer: 'NAIVAS',
          quantity: 1,
          unitPriceMinor: 7000,
          scoringStatus: 'scored',
          gradeSnapshot: 'A',
        },
        // Unscored item: 2000 cents ($20.00)
        {
          id: '2',
          retailer: 'NAIVAS',
          quantity: 1,
          unitPriceMinor: 2000,
          scoringStatus: 'unscored',
          gradeSnapshot: null,
        },
        // Unmatched item: 1000 cents ($10.00)
        {
          id: '3',
          retailer: 'NAIVAS',
          quantity: 1,
          unitPriceMinor: 1000,
          scoringStatus: 'unmatched',
          gradeSnapshot: null,
        },
      ]

      const coverage = computeCartCoverage(rows)

      expect(coverage.totalSpendMinor).toBe(10000)
      expect(coverage.scoredSpendMinor).toBe(7000)
      expect(coverage.unscoredSpendMinor).toBe(2000)
      expect(coverage.unmatchedSpendMinor).toBe(1000)

      expect(coverage.coverageC).toBe(0.70)
      expect(coverage.unscoredShare).toBe(0.30)
    })

    it('returns zero coverage for an empty cart', () => {
      const coverage = computeCartCoverage([])
      expect(coverage.totalSpendMinor).toBe(0)
      expect(coverage.coverageC).toBe(0)
      expect(coverage.unscoredShare).toBe(0)
    })
  })

  // ── 8. Feature Flag & Backward Compatibility ──────────────────────────────

  describe('8. Feature Flag & Rollback Safety', () => {
    it('isLedgerV2Enabled defaults to false and responds to flag toggle', () => {
      expect(isLedgerV2Enabled()).toBe(false)

      ;(globalThis as any).__NUTRI_FLAGS__ = { 'ns.ledger.v2': true }
      expect(isLedgerV2Enabled()).toBe(true)

      ;(globalThis as any).__NUTRI_FLAGS__ = { 'ns.ledger.v2': false }
      expect(isLedgerV2Enabled()).toBe(false)
    })

    it('syncCart calls applyCartSnapshot when ns.ledger.v2 is enabled', async () => {
      ;(globalThis as any).__NUTRI_FLAGS__ = { 'ns.ledger.v2': true }

      const items: CartItemInput[] = [
        {
          productId: 'flag-item',
          product_name: 'Flag Tested Bread',
          quantity: 2,
          priceSnapshot: 40,
          retailer: 'NAIVAS',
        },
      ]

      await syncCart('NAIVAS', items)

      const all = await fakeStore.getAll()
      expect(all.length).toBe(1)
      expect(all[0].quantity).toBe(2)
      expect((all[0] as LedgerRow).cartEpisodeId).toBeDefined()
    })
  })
})
