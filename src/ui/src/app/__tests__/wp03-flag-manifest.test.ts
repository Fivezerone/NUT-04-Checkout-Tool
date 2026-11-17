/**
 * src/ui/src/app/__tests__/wp03-flag-manifest.test.ts
 *
 * WP-03: Signed Feature Flag Manifest Client Verification Suite
 * Reference: Blueprint §3.8, §5.1, §5.6 (WP-03, ADR-5)
 *
 * Invariants Tested:
 *   1. Pinned Ed25519 signature verification: valid manifests accepted, tampered signatures rejected.
 *   2. Monotonic sequence anti-rollback: seq <= currentSeq strictly rejected.
 *   3. Freshness window: future timestamps (> 5 min) rejected.
 *   4. Uniform & deterministic FNV-1a cohort bucketing across 10,000 synthetic install IDs (within 5% error margin).
 *   5. Explicit ID allowlist (allow_ids) overrides cohort percentage.
 *   6. Extension version gating (min_ext_ver) disables flag if extension is older.
 *   7. Kill-switches: ns.global.neutral and per-retailer kill-switches.
 *   8. Fail-static: network or verification failures preserve previously evaluated state without throwing.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mintFlagManifest } from '../../../../../scripts/publish-flags.mjs'
import flagsPkg from '../../../../extension/flags.js'
import { decodeBase64Url } from '../../../../shared/crypto'

const NutriFlags = flagsPkg.default || flagsPkg

describe('WP-03: Signed Feature Flag Manifest Client', () => {
  // Test Ed25519 keypair for signing test manifests
  const keyPair = generateKeyPairSync('ed25519')
  const spkiDer = keyPair.publicKey.export({ type: 'spki', format: 'der' })
  const rawPublicKey = spkiDer.subarray(12)

  beforeEach(() => {
    NutriFlags.resetForTest()
    NutriFlags.setPinnedPublicKeyForTest(rawPublicKey)
  })

  // ── 1. Signature Verification & Rejection ────────────────────────────────────

  describe('1. Pinned Signature Verification', () => {
    test('accepts validly signed manifest and updates evaluated flags', async () => {
      const manifest = mintFlagManifest({
        flags: {
          'ns.scoring.v5': { enabled: true, cohort_pct: 100 },
          'ns.obs.sdk': { enabled: true, cohort_pct: 100 },
        },
        seq: 1,
        privateKey: keyPair.privateKey,
      })

      const res = await NutriFlags.applyManifest(manifest)
      expect(res.valid).toBe(true)
      expect(res.seq).toBe(1)
      expect(NutriFlags.isEnabled('ns.scoring.v5')).toBe(true)
      expect(NutriFlags.isEnabled('ns.obs.sdk')).toBe(true)
    })

    test('rejects tampered signature (fail-closed)', async () => {
      const manifest = mintFlagManifest({
        flags: { 'ns.scoring.v5': { enabled: true, cohort_pct: 100 } },
        seq: 1,
        privateKey: keyPair.privateKey,
      })

      // Corrupt signature
      const sigBytes = decodeBase64Url(manifest.sig)
      sigBytes[0] ^= 0x01
      const tamperedSig = Buffer.from(sigBytes).toString('base64url')
      const tamperedManifest = { ...manifest, sig: tamperedSig }

      const res = await NutriFlags.applyManifest(tamperedManifest)
      expect(res.valid).toBe(false)
      expect(res.error).toMatch(/signature/i)
      expect(NutriFlags.isEnabled('ns.scoring.v5')).toBe(false)
    })

    test('rejects tampered flag payload (fail-closed)', async () => {
      const manifest = mintFlagManifest({
        flags: { 'ns.scoring.v5': { enabled: false, cohort_pct: 0 } },
        seq: 1,
        privateKey: keyPair.privateKey,
      })

      // Tamper payload after signing
      const tamperedManifest = {
        ...manifest,
        flags: { 'ns.scoring.v5': { enabled: true, cohort_pct: 100 } },
      }

      const res = await NutriFlags.applyManifest(tamperedManifest)
      expect(res.valid).toBe(false)
      expect(res.error).toMatch(/signature/i)
      expect(NutriFlags.isEnabled('ns.scoring.v5')).toBe(false)
    })
  })

  // ── 2. Sequence Anti-Rollback & Freshness ─────────────────────────────────────

  describe('2. Anti-Rollback (Strict Monotonic Seq) & Freshness', () => {
    test('strictly enforces monotonic seq: rejects seq <= currentSeq', async () => {
      const m1 = mintFlagManifest({
        flags: { 'ns.obs.sdk': { enabled: true, cohort_pct: 100 } },
        seq: 10,
        privateKey: keyPair.privateKey,
      })
      const res1 = await NutriFlags.applyManifest(m1)
      expect(res1.valid).toBe(true)
      expect(NutriFlags.isEnabled('ns.obs.sdk')).toBe(true)

      // Same seq: rejected
      const mSame = mintFlagManifest({
        flags: { 'ns.obs.sdk': { enabled: false, cohort_pct: 0 } },
        seq: 10,
        privateKey: keyPair.privateKey,
      })
      const resSame = await NutriFlags.applyManifest(mSame)
      expect(resSame.valid).toBe(false)
      expect(resSame.error).toMatch(/anti-rollback/i)
      expect(NutriFlags.isEnabled('ns.obs.sdk')).toBe(true) // still true (fail static)

      // Lower seq: rejected
      const mOlder = mintFlagManifest({
        flags: { 'ns.obs.sdk': { enabled: false, cohort_pct: 0 } },
        seq: 9,
        privateKey: keyPair.privateKey,
      })
      const resOlder = await NutriFlags.applyManifest(mOlder)
      expect(resOlder.valid).toBe(false)
      expect(resOlder.error).toMatch(/anti-rollback/i)
      expect(NutriFlags.isEnabled('ns.obs.sdk')).toBe(true)

      // Higher seq: accepted
      const mNewer = mintFlagManifest({
        flags: { 'ns.obs.sdk': { enabled: false, cohort_pct: 0 } },
        seq: 11,
        privateKey: keyPair.privateKey,
      })
      const resNewer = await NutriFlags.applyManifest(mNewer)
      expect(resNewer.valid).toBe(true)
      expect(NutriFlags.isEnabled('ns.obs.sdk')).toBe(false)
    })

    test('rejects timestamps in the future (> 5 min clock drift)', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000).toISOString()
      const manifest = mintFlagManifest({
        flags: { 'ns.obs.sdk': { enabled: true, cohort_pct: 100 } },
        seq: 1,
        issuedAt: futureDate,
        privateKey: keyPair.privateKey,
      })

      const res = await NutriFlags.applyManifest(manifest)
      expect(res.valid).toBe(false)
      expect(res.error).toMatch(/future/i)
    })
  })

  // ── 3. FNV-1a Cohort Distribution Uniformity ─────────────────────────────────

  describe('3. Cohort Distribution Uniformity & Determinism', () => {
    test('cohort bucketing is deterministic across repeated runs for same installId', () => {
      const id = 'user-install-uuid-1234'
      const flag = 'ns.scoring.v5'
      const b1 = NutriFlags.bucketForFlag(id, flag)
      const b2 = NutriFlags.bucketForFlag(id, flag)
      expect(b1).toBe(b2)
      expect(b1).toBeGreaterThanOrEqual(0)
      expect(b1).toBeLessThan(100)
    })

    test('cohort bucketing across 10,000 synthetic installs is uniform within 5% error margin', () => {
      const TOTAL_INSTALLS = 10000
      const TARGET_PERCENTAGE = 30 // 30% cohort
      let count = 0

      for (let i = 0; i < TOTAL_INSTALLS; i++) {
        const syntheticInstallId = `install-uuid-${i}`
        const bucket = NutriFlags.bucketForFlag(syntheticInstallId, 'ns.scoring.v5')
        if (bucket < TARGET_PERCENTAGE) {
          count++
        }
      }

      const observedPercentage = (count / TOTAL_INSTALLS) * 100
      // 30% ± 3% (observed percentage between 27% and 33%)
      expect(observedPercentage).toBeGreaterThanOrEqual(27.0)
      expect(observedPercentage).toBeLessThanOrEqual(33.0)
    })

    test('distinct flags produce independent cohorts for the same installId', () => {
      const id = 'fixed-install-id-999'
      const b1 = NutriFlags.bucketForFlag(id, 'ns.scoring.v5')
      const b2 = NutriFlags.bucketForFlag(id, 'ns.policy.v2')
      const b3 = NutriFlags.bucketForFlag(id, 'ns.ledger.v2')

      // At least 2 of 3 buckets differ
      const unique = new Set([b1, b2, b3])
      expect(unique.size).toBeGreaterThan(1)
    })
  })

  // ── 4. Allowlist & Version Gating ─────────────────────────────────────────────

  describe('4. Allowlist & Minimum Extension Version Gating', () => {
    test('allow_ids enables flag even if cohort_pct is 0', () => {
      const manifest = {
        typ: 'ns-flags+json',
        seq: 1,
        issued_at: new Date().toISOString(),
        flags: {
          'ns.scoring.v5': {
            enabled: true,
            cohort_pct: 0,
            allow_ids: ['alpha-tester-01', 'beta-tester-02'],
          },
        },
        kid: 'test',
        sig: 'mock',
      }

      // Alpha tester: enabled
      const eval1 = NutriFlags.evaluateManifest(manifest, 'alpha-tester-01', '1.0.0')
      expect(eval1['ns.scoring.v5']).toBe(true)

      // Random user: disabled
      const eval2 = NutriFlags.evaluateManifest(manifest, 'random-user-999', '1.0.0')
      expect(eval2['ns.scoring.v5']).toBe(false)
    })

    test('min_ext_ver disables flag if extension version is older', () => {
      const manifest = {
        typ: 'ns-flags+json',
        seq: 1,
        issued_at: new Date().toISOString(),
        flags: {
          'ns.token.v2': {
            enabled: true,
            cohort_pct: 100,
            min_ext_ver: '1.2.0',
          },
        },
        kid: 'test',
        sig: 'mock',
      }

      // Older version 1.1.9: disabled
      const evalOld = NutriFlags.evaluateManifest(manifest, 'install-01', '1.1.9')
      expect(evalOld['ns.token.v2']).toBe(false)

      // Target version 1.2.0: enabled
      const evalEqual = NutriFlags.evaluateManifest(manifest, 'install-01', '1.2.0')
      expect(evalEqual['ns.token.v2']).toBe(true)

      // Newer version 1.3.0: enabled
      const evalNewer = NutriFlags.evaluateManifest(manifest, 'install-01', '1.3.0')
      expect(evalNewer['ns.token.v2']).toBe(true)
    })
  })

  // ── 5. Kill Switches & Fail-Static Behavior ───────────────────────────────────

  describe('5. Kill-Switches & Fail-Static Resilience', () => {
    test('ns.global.neutral and per-retailer kill-switches can be evaluated', async () => {
      const manifest = mintFlagManifest({
        flags: {
          'ns.global.neutral': { enabled: true, cohort_pct: 100 },
          'ns.retailer.carrefour.enabled': { enabled: false, cohort_pct: 0 },
          'ns.retailer.naivas.enabled': { enabled: true, cohort_pct: 100 },
        },
        seq: 1,
        privateKey: keyPair.privateKey,
      })

      await NutriFlags.applyManifest(manifest)

      expect(NutriFlags.isEnabled('ns.global.neutral')).toBe(true)
      expect(NutriFlags.isEnabled('ns.retailer.carrefour.enabled')).toBe(false)
      expect(NutriFlags.isEnabled('ns.retailer.naivas.enabled')).toBe(true)
    })

    test('fail-static: network error leaves existing flag state intact', async () => {
      // Step 1: load valid manifest with seq 1
      const m1 = mintFlagManifest({
        flags: { 'ns.scoring.v5': { enabled: true, cohort_pct: 100 } },
        seq: 1,
        privateKey: keyPair.privateKey,
      })
      await NutriFlags.applyManifest(m1)
      expect(NutriFlags.isEnabled('ns.scoring.v5')).toBe(true)

      // Step 2: network error during refresh
      const mockFailingFetch = async () => {
        throw new Error('Network error (503 Service Unavailable)')
      }

      const refreshed = await NutriFlags.refreshFlags(
        'https://api.example.com/flags',
        mockFailingFetch as any,
      )
      expect(refreshed).toBe(false)

      // State is preserved (fail-static)
      expect(NutriFlags.isEnabled('ns.scoring.v5')).toBe(true)
    })

    test('bundle defaults apply when no manifest is loaded', async () => {
      NutriFlags.resetForTest()
      await NutriFlags.loadFlags()

      expect(NutriFlags.isEnabled('ns.scoring.v5')).toBe(false)
      expect(NutriFlags.isEnabled('ns.global.neutral')).toBe(false)
      expect(NutriFlags.isEnabled('ns.retailer.carrefour.enabled')).toBe(true)
      expect(NutriFlags.isEnabled('ns.retailer.naivas.enabled')).toBe(true)
      expect(NutriFlags.isEnabled('ns.retailer.quickmart.enabled')).toBe(true)
    })
  })
})
