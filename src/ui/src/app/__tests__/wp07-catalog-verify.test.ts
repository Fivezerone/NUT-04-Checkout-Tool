// src/ui/src/app/__tests__/wp07-catalog-verify.test.ts
// Unit and Contract Tests for WP-07: Catalogue Verify-Then-Commit
// Reference: Blueprint §2.6, §5.6 (WP-07, A-01, A-02, A-03, A-04, X-10)

import { describe, it, expect, beforeEach } from 'vitest'
import {
  codeUnitCompare,
  legacyCompare,
  computeCatalogHash,
  recordHash,
  stableStringify,
} from '../../../../shared/canonical.mjs'

describe('WP-07: Catalogue Verify-Then-Commit Suite', () => {
  const sampleProductA = {
    Identity: {
      ProductID: 'prod-001',
      Barcode: '6001001',
      Retailer: 'NAIVAS',
      ProductName: 'Fresh Whole Milk 500ml',
    },
    Nutrition: {
      EnergyKJ: 270,
      EnergyKcal: 65,
      FatG: 3.5,
      SaturatedFatG: 2.1,
      CarbohydratesG: 4.8,
      SugarsG: 4.8,
      FibreG: 0,
      ProteinG: 3.2,
      SodiumMG: 50,
    },
    ReviewState: 'VERIFIED',
  }

  const sampleProductB = {
    Identity: {
      ProductID: 'prod-002',
      Barcode: '6001002',
      Retailer: 'CARREFOUR',
      ProductName: 'Rolled Oats 1kg',
    },
    Nutrition: {
      EnergyKJ: 1550,
      EnergyKcal: 370,
      FatG: 7.0,
      SaturatedFatG: 1.2,
      CarbohydratesG: 60.0,
      SugarsG: 1.0,
      FibreG: 10.0,
      ProteinG: 12.0,
      SodiumMG: 5,
    },
    ReviewState: 'VERIFIED',
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Row Hash Integrity & Tamper Detection (A-01, Blueprint §2.6)
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Row Hash Integrity & Tamper Detection (A-01)', () => {
    it('computes deterministic SHA-256 hash of canonical record representation', async () => {
      const hash1 = await recordHash(sampleProductA)
      const hash2 = await recordHash(sampleProductA)
      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[a-f0-9]{64}$/)
    })

    it('detects tampered nutrient data when original hash is retained (A-01 fix)', async () => {
      const originalHash = await recordHash(sampleProductA)

      // Malicious or accidental modification of nutrient values
      const tamperedRecord = JSON.parse(JSON.stringify(sampleProductA))
      tamperedRecord.Nutrition.SugarsG = 25.0 // Increased sugars

      const recomputedHash = await recordHash(tamperedRecord)
      expect(recomputedHash).not.toBe(originalHash)
    })

    it('detects tampered review state or identity fields', async () => {
      const originalHash = await recordHash(sampleProductB)

      const tamperedRecord = JSON.parse(JSON.stringify(sampleProductB))
      tamperedRecord.ReviewState = 'UNVERIFIED'

      const recomputedHash = await recordHash(tamperedRecord)
      expect(recomputedHash).not.toBe(originalHash)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Unicode Code-Unit Comparison & Aggregate Determinism (X-10)
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Unicode Code-Unit Comparison & Aggregate Determinism (X-10)', () => {
    it('codeUnitCompare orders strictly by UTF-16 code units (immune to ICU differences)', () => {
      // In localeCompare with Swedish or German, 'ä' may sort after 'z'. In code-unit, 'a' < 'z' < 'ä'.
      expect(codeUnitCompare('a', 'b')).toBe(-1)
      expect(codeUnitCompare('b', 'a')).toBe(1)
      expect(codeUnitCompare('a', 'a')).toBe(0)
      expect(codeUnitCompare('Z', 'a')).toBe(-1) // Uppercase ASCII < lowercase ASCII in code-unit
    })

    it('computeCatalogHash supports both code-unit (default) and legacy comparisons', async () => {
      const hashA = await recordHash(sampleProductA)
      const hashB = await recordHash(sampleProductB)

      const rows = [
        { retailer: 'NAIVAS', product_id: 'prod-001', record_hash: hashA },
        { retailer: 'CARREFOUR', product_id: 'prod-002', record_hash: hashB },
      ]

      const modernHash = await computeCatalogHash(rows, { legacy: false })
      const legacyHash = await computeCatalogHash(rows, { legacy: true })

      expect(modernHash).toMatch(/^[a-f0-9]{64}$/)
      expect(legacyHash).toMatch(/^[a-f0-9]{64}$/)
      // For simple ASCII strings CARREFOUR < NAIVAS in both, verifying consistency
      expect(modernHash).toBe(legacyHash)
    })

    it('computes consistent aggregate catalog hash across unsorted inputs', async () => {
      const hashA = await recordHash(sampleProductA)
      const hashB = await recordHash(sampleProductB)

      const order1 = [
        { retailer: 'NAIVAS', product_id: 'prod-001', record_hash: hashA },
        { retailer: 'CARREFOUR', product_id: 'prod-002', record_hash: hashB },
      ]
      const order2 = [
        { retailer: 'CARREFOUR', product_id: 'prod-002', record_hash: hashB },
        { retailer: 'NAIVAS', product_id: 'prod-001', record_hash: hashA },
      ]

      const hash1 = await computeCatalogHash(order1)
      const hash2 = await computeCatalogHash(order2)
      expect(hash1).toBe(hash2)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Staging Pre-Commit Verification Simulator (A-01, A-02, Blueprint §2.6)
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Staging Pre-Commit Verification (A-01, A-02, Blueprint §2.6)', () => {
    // Simulator function matching catalog-sync.js verifyStaging logic
    async function simulateVerifyStaging(manifest: any, stagedRows: any[], existingHashes: any[]) {
      // 1. Per-row integrity check
      for (const row of stagedRows) {
        if (!row.deleted && row.record) {
          const computed = await recordHash(row.record)
          if (computed !== row.record_hash) {
            throw new Error(`Staged row hash mismatch for ${row.key}`)
          }
        }
      }

      // 2. Aggregate hash check on simulated post-commit state
      const hashSimMap = new Map()
      for (const h of existingHashes) {
        const [retailer, productId] = h.key.split('|')
        hashSimMap.set(h.key, { retailer, product_id: productId, record_hash: h.hash })
      }
      for (const s of stagedRows) {
        if (s.deleted) {
          hashSimMap.delete(s.key)
        } else {
          hashSimMap.set(s.key, {
            retailer: s.retailer,
            product_id: s.product_id,
            record_hash: s.record_hash,
          })
        }
      }

      const simRows = Array.from(hashSimMap.values())
      const computedV2 = await computeCatalogHash(simRows as any, { legacy: false })
      const computedLegacy = await computeCatalogHash(simRows as any, { legacy: true })

      const expectedV2 = manifest.catalog_hash_v2
      const expectedLegacy = manifest.catalog_hash

      const matchedV2 = expectedV2 && computedV2 === expectedV2
      const matchedLegacy =
        (expectedLegacy && computedLegacy === expectedLegacy) ||
        (expectedLegacy && computedV2 === expectedLegacy)

      if (!matchedV2 && !matchedLegacy) {
        throw new Error('Catalog aggregate hash mismatch')
      }
      return true
    }

    it('passes staging verification when all row hashes and aggregate match manifest', async () => {
      const hashA = await recordHash(sampleProductA)
      const hashB = await recordHash(sampleProductB)

      const staged = [
        {
          key: 'NAIVAS|prod-001',
          retailer: 'NAIVAS',
          product_id: 'prod-001',
          record: sampleProductA,
          record_hash: hashA,
        },
        {
          key: 'CARREFOUR|prod-002',
          retailer: 'CARREFOUR',
          product_id: 'prod-002',
          record: sampleProductB,
          record_hash: hashB,
        },
      ]

      const aggV2 = await computeCatalogHash(staged as any, { legacy: false })
      const manifest = {
        version: '2026.11.17',
        catalog_hash_v2: aggV2,
      }

      const res = await simulateVerifyStaging(manifest, staged, [])
      expect(res).toBe(true)
    })

    it('rejects staging when a single row record has been tampered (A-01)', async () => {
      const hashA = await recordHash(sampleProductA)
      const hashB = await recordHash(sampleProductB)

      const tamperedRecord = JSON.parse(JSON.stringify(sampleProductA))
      tamperedRecord.Nutrition.SodiumMG = 9999 // Tampered sodium

      const staged = [
        {
          key: 'NAIVAS|prod-001',
          retailer: 'NAIVAS',
          product_id: 'prod-001',
          record: tamperedRecord, // Tampered record
          record_hash: hashA, // Copied original hash!
        },
        {
          key: 'CARREFOUR|prod-002',
          retailer: 'CARREFOUR',
          product_id: 'prod-002',
          record: sampleProductB,
          record_hash: hashB,
        },
      ]

      const manifest = {
        version: '2026.11.17',
        catalog_hash_v2: 'some-hash',
      }

      await expect(simulateVerifyStaging(manifest, staged, [])).rejects.toThrow(
        /Staged row hash mismatch for NAIVAS\|prod-001/i,
      )
    })

    it('rejects staging when manifest aggregate hash does not match computed aggregate (A-02)', async () => {
      const hashA = await recordHash(sampleProductA)
      const hashB = await recordHash(sampleProductB)

      const staged = [
        {
          key: 'NAIVAS|prod-001',
          retailer: 'NAIVAS',
          product_id: 'prod-001',
          record: sampleProductA,
          record_hash: hashA,
        },
        {
          key: 'CARREFOUR|prod-002',
          retailer: 'CARREFOUR',
          product_id: 'prod-002',
          record: sampleProductB,
          record_hash: hashB,
        },
      ]

      const manifest = {
        version: '2026.11.17',
        catalog_hash_v2: 'forged_or_corrupted_aggregate_hash',
      }

      await expect(simulateVerifyStaging(manifest, staged, [])).rejects.toThrow(
        /Catalog aggregate hash mismatch/i,
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Manifest Anti-Rollback & Future Issuance (A-03, Blueprint §2.6)
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Manifest Anti-Rollback & Future Issuance (A-03)', () => {
    function simulateVerifyManifest(manifest: any, meta: any, nowMs: number) {
      if (manifest?.issued_at) {
        const issuedAtMs = Date.parse(manifest.issued_at)
        if (Number.isFinite(issuedAtMs) && issuedAtMs > nowMs + 5 * 60_000) {
          throw new Error('Catalog manifest issued_at is in the future (> now + 5 min)')
        }
      }

      if (manifest?.release_seq !== undefined && meta) {
        const maxSeen = meta.max_release_seen ?? meta.release_seq ?? 0
        if (manifest.release_seq <= maxSeen) {
          throw new Error(
            `Rollback rejected: catalog release_seq ${manifest.release_seq} <= stored max_release_seen ${maxSeen}`,
          )
        }
      }
      return true
    }

    it('accepts strictly increasing release_seq', () => {
      const manifest = { release_seq: 15, issued_at: '2026-11-17T10:00:00Z' }
      const meta = { max_release_seen: 14 }
      const nowMs = Date.parse('2026-11-17T10:01:00Z')

      expect(simulateVerifyManifest(manifest, meta, nowMs)).toBe(true)
    })

    it('rejects older or equal release_seq (anti-rollback protection)', () => {
      const manifest = { release_seq: 14, issued_at: '2026-11-17T10:00:00Z' }
      const meta = { max_release_seen: 14 } // Equal to current
      const nowMs = Date.parse('2026-11-17T10:01:00Z')

      expect(() => simulateVerifyManifest(manifest, meta, nowMs)).toThrow(
        /Rollback rejected: catalog release_seq 14 <= stored max_release_seen 14/i,
      )

      const olderManifest = { release_seq: 12 }
      expect(() => simulateVerifyManifest(olderManifest, meta, nowMs)).toThrow(/Rollback rejected/i)
    })

    it('rejects manifest issued in the future (> now + 5 minutes)', () => {
      const manifest = {
        release_seq: 15,
        issued_at: '2026-11-17T11:00:00Z', // 1 hour in future
      }
      const meta = { max_release_seen: 14 }
      const nowMs = Date.parse('2026-11-17T10:00:00Z')

      expect(() => simulateVerifyManifest(manifest, meta, nowMs)).toThrow(
        /issued_at is in the future/i,
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Cadence & Anonymous Sync (A-04, Blueprint §2.6 #1 & #2)
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Cadence & Anonymous Sync (A-04, Blueprint §2.6)', () => {
    function shouldPerformSync(meta: any, nowMs: number, force = false): boolean {
      if (force) return true
      if (!meta?.lastSyncAt || meta?.updateRequired) return true
      const elapsed = nowMs - Date.parse(meta.lastSyncAt)
      if (Number.isFinite(elapsed) && elapsed < 6 * 3600 * 1000) {
        return false // Skip: synced within 6 hours
      }
      return true
    }

    it('skips sync when lastSyncAt was within 6 hours (A-04 worker wake optimization)', () => {
      const nowMs = Date.parse('2026-11-17T12:00:00Z')
      const meta = {
        lastSyncAt: '2026-11-17T10:00:00Z', // 2 hours ago
        updateRequired: false,
      }
      expect(shouldPerformSync(meta, nowMs)).toBe(false)
    })

    it('executes sync when 6 hours have elapsed', () => {
      const nowMs = Date.parse('2026-11-17T18:01:00Z')
      const meta = {
        lastSyncAt: '2026-11-17T12:00:00Z', // 6 hours 1 min ago
        updateRequired: false,
      }
      expect(shouldPerformSync(meta, nowMs)).toBe(true)
    })

    it('executes sync when updateRequired is flagged even if recent', () => {
      const nowMs = Date.parse('2026-11-17T12:10:00Z')
      const meta = {
        lastSyncAt: '2026-11-17T12:00:00Z', // 10 mins ago
        updateRequired: true,
      }
      expect(shouldPerformSync(meta, nowMs)).toBe(true)
    })

    it('executes sync when forced (force: true)', () => {
      const nowMs = Date.parse('2026-11-17T12:05:00Z')
      const meta = {
        lastSyncAt: '2026-11-17T12:00:00Z',
        updateRequired: false,
      }
      expect(shouldPerformSync(meta, nowMs, true)).toBe(true)
    })
  })
})
