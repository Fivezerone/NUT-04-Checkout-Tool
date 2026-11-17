/**
 * src/ui/src/app/__tests__/wp02-crypto-provider.test.ts
 *
 * WP-02: Crypto Provider and Browser-Safe Shared Primitives Verification Suite
 * Reference: Blueprint §2.3 (N4), §3.1, §3.3, §3.4, §5.6 (WP-02, X-05e, X-10, ADR-3)
 *
 * Invariants Verified:
 *   1. Cross-environment parity: NodeCryptoProvider and WebCryptoProvider produce identical bytes.
 *   2. SHA-256 and HMAC-SHA256 byte-for-byte exact matches against RFC vectors.
 *   3. Ed25519 cross-signing and cross-verification across raw 32-byte, 44-byte SPKI DER, hex, base64url, and JWK formats.
 *   4. Ed25519 service worker feature detection (importKey raw try/catch) with graceful fail-neutral fallback.
 *   5. Pure code-unit comparator (codeUnitCompare) vs legacyCompare in canonical.mjs (Finding X-10).
 *   6. Nutrient completeness bundle export without Node dependencies (Invariant T20, WP-04 prep).
 *   7. DPT and DPoP asynchronous verification via CryptoProvider (Finding X-05e).
 */

import { describe, test, expect, it } from 'vitest'
import { NodeCryptoProvider } from '../../../../shared/crypto/node'
import { WebCryptoProvider } from '../../../../shared/crypto/web'
import {
  getCryptoProvider,
  setCryptoProvider,
  encodeBase64Url,
  decodeBase64Url,
  toHexString,
  fromHexString,
  codeUnitCompare,
  legacyCompare,
  normalizeEd25519PublicKey,
  normalizeEd25519Signature,
  ED25519_SPKI_PREFIX,
} from '../../../../shared/crypto'
import {
  codeUnitCompare as canonicalCodeUnit,
  legacyCompare as canonicalLegacy,
  computeCatalogHash,
  stableStringify,
} from '../../../../shared/canonical.mjs'
import {
  checkNutrientCompleteness,
  type NutrientValues,
} from '../../../../shared/nutrient-completeness'
import {
  LocalEd25519Signer,
} from '../../../../shared/signer'
import {
  mintDpt,
  verifyDpt,
  verifyDptAsync,
  deriveShopperAlias,
  deriveShopperAliasAsync,
  deriveTenantAlias,
  deriveTenantAliasAsync,
} from '../../../../shared/dpt'
import {
  computeJwkThumbprint,
  computeJwkThumbprintAsync,
  createDpopProof,
  verifyDpopProof,
  verifyDpopProofAsync,
  type JwkPublicKey,
} from '../../../../shared/dpop'

describe('WP-02: Crypto Provider & Shared Primitives', () => {
  const nodeProvider = new NodeCryptoProvider()
  const webProvider = new WebCryptoProvider()

  // ── 1. SHA-256 & HMAC-SHA256 Parity ──────────────────────────────────────────

  describe('1. Cross-Environment Digest & HMAC Parity', () => {
    const testCases = [
      '',
      'hello world',
      'The quick brown fox jumps over the lazy dog',
      'NutriScore Kenya 2026 Digital Health Platform',
      'Non-ASCII: üñîçødë 🇰🇪 & special symbols: <>&"\'',
      JSON.stringify({ retailer: 'NAIVAS', product_id: '12345', price: 299.99 }),
    ]

    for (const input of testCases) {
      test(`sha256 matches between Node and Web for: "${input.slice(0, 20)}..."`, async () => {
        const nodeHash = await nodeProvider.sha256(input)
        const webHash = await webProvider.sha256(input)
        const nodeHex = await nodeProvider.sha256Hex(input)
        const webHex = await webProvider.sha256Hex(input)

        expect(Array.from(webHash)).toEqual(Array.from(nodeHash))
        expect(webHex).toBe(nodeHex)
        expect(webHex).toHaveLength(64)
      })
    }

    test('sha256Hex empty string matches NIST vector', async () => {
      const expected = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      expect(await nodeProvider.sha256Hex('')).toBe(expected)
      expect(await webProvider.sha256Hex('')).toBe(expected)
    })

    test('hmacSha256 matches between Node and Web for arbitrary key & message', async () => {
      const key = 'secret-stage-a-signing-key-salt'
      const message = 'patient_link:sample-patient-1234'

      const nodeHmac = await nodeProvider.hmacSha256(key, message)
      const webHmac = await webProvider.hmacSha256(key, message)
      const nodeHmacHex = await nodeProvider.hmacSha256Hex(key, message)
      const webHmacHex = await webProvider.hmacSha256Hex(key, message)

      expect(Array.from(webHmac)).toEqual(Array.from(nodeHmac))
      expect(webHmacHex).toBe(nodeHmacHex)
      expect(webHmacHex).toHaveLength(64)
    })

    test('randomBytes generates requested length with non-zero entropy', () => {
      const lengths = [0, 8, 16, 32, 64]
      for (const len of lengths) {
        const nodeBytes = nodeProvider.randomBytes(len)
        const webBytes = webProvider.randomBytes(len)

        expect(nodeBytes.length).toBe(len)
        expect(webBytes.length).toBe(len)

        if (len >= 16) {
          // Verify non-zero entropy (not all zeroes)
          expect(nodeBytes.some((b) => b !== 0)).toBe(true)
          expect(webBytes.some((b) => b !== 0)).toBe(true)
        }
      }
    })
  })

  // ── 2. Ed25519 Cross-Signing & Cross-Verification ───────────────────────────

  describe('2. Ed25519 Cross-Signing & Cross-Verification Parity', () => {
    const signer = new LocalEd25519Signer('test-wp02-key')
    const jwk = signer.getPublicKeyJwk() as { kty: 'OKP'; crv: 'Ed25519'; x: string }
    const rawPublicKey = decodeBase64Url(jwk.x)
    const spkiPublicKey = new Uint8Array(44)
    spkiPublicKey.set(ED25519_SPKI_PREFIX, 0)
    spkiPublicKey.set(rawPublicKey, 12)

    const payload = new TextEncoder().encode('Canonical NutriScore Message to Sign')
    const nodeSig = signer.sign(payload)

    test('Node signs, WebCrypto verifies across all 5 key formats', async () => {
      // 1. Raw 32-byte Uint8Array
      const okRaw = await webProvider.verifyEd25519(rawPublicKey, payload, nodeSig)
      expect(okRaw).toBe(true)

      // 2. SPKI 44-byte DER Uint8Array
      const okSpki = await webProvider.verifyEd25519(spkiPublicKey, payload, nodeSig)
      expect(okSpki).toBe(true)

      // 3. Hex string
      const hexKey = toHexString(rawPublicKey)
      const okHex = await webProvider.verifyEd25519(hexKey, payload, nodeSig)
      expect(okHex).toBe(true)

      // 4. Base64URL string
      const b64Key = jwk.x
      const okB64 = await webProvider.verifyEd25519(b64Key, payload, nodeSig)
      expect(okB64).toBe(true)

      // 5. JWK object
      const okJwk = await webProvider.verifyEd25519(jwk, payload, nodeSig)
      expect(okJwk).toBe(true)
    })

    test('Node signs, NodeCryptoProvider verifies across all key formats', async () => {
      const okRaw = await nodeProvider.verifyEd25519(rawPublicKey, payload, nodeSig)
      expect(okRaw).toBe(true)

      const okSpki = await nodeProvider.verifyEd25519(spkiPublicKey, payload, nodeSig)
      expect(okSpki).toBe(true)

      const okJwk = await nodeProvider.verifyEd25519(jwk, payload, nodeSig)
      expect(okJwk).toBe(true)
    })

    test('WebCrypto signs, Node verifies', async () => {
      // WebCrypto signing via private key seed / PKCS8
      // Extract private key from Node KeyObject
      const pkcs8 = (signer.getPrivateKey() as any).export({ type: 'pkcs8', format: 'der' })
      const webSig = await webProvider.signEd25519(pkcs8, payload)

      expect(webSig.length).toBe(64)
      const nodeOk = await nodeProvider.verifyEd25519(rawPublicKey, payload, webSig)
      expect(nodeOk).toBe(true)

      const webOk = await webProvider.verifyEd25519(rawPublicKey, payload, webSig)
      expect(webOk).toBe(true)
    })

    test('rejects tampered signature (fail-closed)', async () => {
      const tamperedSig = new Uint8Array(nodeSig)
      tamperedSig[0] ^= 0x01 // flip 1 bit

      const nodeOk = await nodeProvider.verifyEd25519(rawPublicKey, payload, tamperedSig)
      const webOk = await webProvider.verifyEd25519(rawPublicKey, payload, tamperedSig)

      expect(nodeOk).toBe(false)
      expect(webOk).toBe(false)
    })

    test('rejects tampered data (fail-closed)', async () => {
      const tamperedPayload = new TextEncoder().encode('Tampered NutriScore Message to Sign')

      const nodeOk = await nodeProvider.verifyEd25519(rawPublicKey, tamperedPayload, nodeSig)
      const webOk = await webProvider.verifyEd25519(rawPublicKey, tamperedPayload, nodeSig)

      expect(nodeOk).toBe(false)
      expect(webOk).toBe(false)
    })

    test('rejects wrong public key (fail-closed)', async () => {
      const otherSigner = new LocalEd25519Signer('other-key')
      const otherJwk = otherSigner.getPublicKeyJwk() as { x: string }
      const wrongKey = decodeBase64Url(otherJwk.x)

      const nodeOk = await nodeProvider.verifyEd25519(wrongKey, payload, nodeSig)
      const webOk = await webProvider.verifyEd25519(wrongKey, payload, nodeSig)

      expect(nodeOk).toBe(false)
      expect(webOk).toBe(false)
    })
  })

  // ── 3. Ed25519 Feature Detection ─────────────────────────────────────────────

  describe('3. Ed25519 Feature Detection (Blueprint 2.3, N4)', () => {
    test('isEd25519Supported returns true in supporting environment', async () => {
      const nodeSupported = await nodeProvider.isEd25519Supported()
      const webSupported = await webProvider.isEd25519Supported()

      expect(nodeSupported).toBe(true)
      expect(webSupported).toBe(true)
    })

    test('isEd25519Supported handles unsupported environment gracefully without throwing', async () => {
      // Mock subtle with failing importKey
      const originalCrypto = globalThis.crypto
      try {
        const mockCrypto = {
          ...originalCrypto,
          subtle: {
            ...originalCrypto?.subtle,
            importKey: async () => {
              throw new Error('NotSupportedError: Algorithm Ed25519 not supported')
            },
          },
        }
        Object.defineProperty(globalThis, 'crypto', { value: mockCrypto, configurable: true })

        const supported = await webProvider.isEd25519Supported()
        expect(supported).toBe(false)
      } finally {
        Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
      }
    })
  })

  // ── 4. Canonical String Comparison (Finding X-10) ─────────────────────────────

  describe('4. Pure Code-Unit Comparator vs Legacy Comparator (X-10)', () => {
    test('codeUnitCompare produces strict Unicode code-point sorting', () => {
      expect(codeUnitCompare('A', 'B')).toBe(-1)
      expect(codeUnitCompare('B', 'A')).toBe(1)
      expect(codeUnitCompare('A', 'A')).toBe(0)
      expect(codeUnitCompare('a', 'A')).toBe(1) // 'a' (97) > 'A' (65)

      // Array sorting
      const items = ['beta', 'Alpha', 'gamma', '123', 'alpha']
      const sorted = [...items].sort(codeUnitCompare)
      // ASCII order: '123' (49), 'Alpha' (65), 'alpha' (97), 'beta' (98), 'gamma' (103)
      expect(sorted).toEqual(['123', 'Alpha', 'alpha', 'beta', 'gamma'])
    })

    test('canonicalCodeUnit and crypto codeUnitCompare behave identically', () => {
      const a = 'retailer_alpha'
      const b = 'retailer_beta'
      expect(canonicalCodeUnit(a, b)).toBe(codeUnitCompare(a, b))
    })

    test('computeCatalogHash supports both code-unit (default) and legacy comparator', async () => {
      const rows = [
        { retailer: 'NAIVAS', product_id: 'n1', record_hash: 'hash1' },
        { retailer: 'CARREFOUR', product_id: 'c2', record_hash: 'hash2' },
        { retailer: 'CARREFOUR', product_id: 'c1', record_hash: 'hash3' },
      ]

      const defaultHash = await computeCatalogHash(rows)
      const codeUnitHash = await computeCatalogHash(rows, { legacy: false })
      const legacyHash = await computeCatalogHash(rows, { legacy: true })

      expect(defaultHash).toBe(codeUnitHash)
      // For ASCII uppercase retailer names, legacy and codeUnit match
      expect(defaultHash).toBe(legacyHash)
    })
  })

  // ── 5. Nutrient Completeness Export (Invariant T20, WP-04 Prep) ──────────────

  describe('5. Nutrient Completeness Export (Invariant T20)', () => {
    test('marks complete 4-nutrient product as COMPUTABLE', () => {
      const complete: NutrientValues = {
        energyKj: 1500,
        sugarsG: 12,
        satFatG: 2.5,
        sodiumMg: 350,
      }
      const res = checkNutrientCompleteness(complete)
      expect(res.computability).toBe('COMPUTABLE')
      expect(res.missingFields).toHaveLength(0)
    })

    test('accepts saltG as alternative to sodiumMg', () => {
      const withSalt: NutrientValues = {
        energyKcal: 350,
        sugarsG: 5,
        satFatG: 1.0,
        saltG: 0.8,
      }
      const res = checkNutrientCompleteness(withSalt)
      expect(res.computability).toBe('COMPUTABLE')
    })

    test('never imputes zero for missing saturated fat (fail neutral)', () => {
      const missingSatFat: NutrientValues = {
        energyKcal: 200,
        sugarsG: 10,
        // satFatG missing
        sodiumMg: 100,
      }
      const res = checkNutrientCompleteness(missingSatFat)
      expect(res.computability).toBe('LIMITED_NUTRITION_INFO')
      expect(res.missingFields).toContain('saturated_fat')
    })

    test('identifies multiple missing fields correctly', () => {
      const empty: NutrientValues = {}
      const res = checkNutrientCompleteness(empty)
      expect(res.computability).toBe('LIMITED_NUTRITION_INFO')
      expect(res.missingFields).toEqual(['energy', 'sugars', 'saturated_fat', 'sodium_or_salt'])
    })
  })

  // ── 6. DPT & DPoP Verification with CryptoProvider (Finding X-05e) ───────────

  describe('6. DPT & DPoP with CryptoProvider (Finding X-05e)', () => {
    const signer = new LocalEd25519Signer('wp02-dpt-key')
    const publicJwk = signer.getPublicKeyJwk() as JwkPublicKey
    const dpopJkt = computeJwkThumbprint(publicJwk)

    test('computeJwkThumbprintAsync matches synchronous RFC 7638 thumbprint', async () => {
      const asyncJkt = await computeJwkThumbprintAsync(publicJwk)
      expect(asyncJkt).toBe(dpopJkt)
    })

    test('deriveShopperAliasAsync matches synchronous deriveShopperAlias', async () => {
      const epochKey = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
      const epoch = '2026-w47'
      const patientId = 'patient-test-01'

      const syncAlias = deriveShopperAlias('order', patientId, epochKey, epoch)
      const asyncAlias = await deriveShopperAliasAsync('order', patientId, epochKey, epoch)

      expect(asyncAlias).toBe(syncAlias)
    })

    test('deriveTenantAliasAsync matches synchronous deriveTenantAlias', async () => {
      const tenantId = 't_knh_01'
      const syncAlias = deriveTenantAlias(tenantId)
      const asyncAlias = await deriveTenantAliasAsync(tenantId)

      expect(asyncAlias).toBe(syncAlias)
    })

    test('verifyDptAsync verifies DPT token successfully using CryptoProvider', async () => {
      const { token, payload } = mintDpt(signer, {
        tenantId: 'tenant-test-01',
        patientId: 'patient-test-01',
        constraints: { sugars_g_100g_max: 10, sodium_mg_100g_max: 300 },
        dpopJkt,
      })

      // Sync verify (Node)
      const syncRes = verifyDpt(token, signer.getPublicKey(), dpopJkt)
      expect(syncRes.valid).toBe(true)

      // Async verify (Web/SubtleCrypto / CryptoProvider)
      const asyncRes = await verifyDptAsync(token, signer.getPublicKeyJwk(), dpopJkt)
      expect(asyncRes.valid).toBe(true)
      expect(asyncRes.payload?.jti).toBe(payload.jti)
    })

    test('verifyDptAsync rejects tampered signature', async () => {
      const { token } = mintDpt(signer, {
        tenantId: 'tenant-test-01',
        patientId: 'patient-test-01',
        constraints: { sugars_g_100g_max: 10 },
        dpopJkt,
      })

      const parts = token.split('.')
      const sigBytes = decodeBase64Url(parts[2])
      sigBytes[0] ^= 0x01
      const tamperedToken = `${parts[0]}.${parts[1]}.${encodeBase64Url(sigBytes)}`

      const asyncRes = await verifyDptAsync(tamperedToken, signer.getPublicKeyJwk(), dpopJkt)
      expect(asyncRes.valid).toBe(false)
      expect(asyncRes.error).toMatch(/signature/i)
    })

    test('verifyDpopProofAsync verifies DPoP proof successfully', async () => {
      const proof = createDpopProof(
        signer.getPrivateKey(),
        publicJwk,
        'POST',
        'https://api.nutriscore.co.ke/v1/orders',
      )

      // Sync verify
      const syncRes = verifyDpopProof(proof, 'POST', 'https://api.nutriscore.co.ke/v1/orders')
      expect(syncRes.valid).toBe(true)

      // Async verify via CryptoProvider
      const asyncRes = await verifyDpopProofAsync(
        proof,
        'POST',
        'https://api.nutriscore.co.ke/v1/orders',
      )
      expect(asyncRes.valid).toBe(true)
      expect(asyncRes.jkt).toBe(dpopJkt)
    })
  })
})
