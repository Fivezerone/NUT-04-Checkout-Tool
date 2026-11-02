// src/ui/src/app/__tests__/cad-blueprint-phase7.test.ts
// NutriScore CAD Blueprint Phase 7 Tests
// DPoP proof generation & verification, DPT minting & verification,
// scrubbing/banding, cohort gate, shopper alias derivation, and Signer outage.

import { describe, it, expect, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'

import { LocalEd25519Signer } from '../../../../shared/signer'
import {
  computeJwkThumbprint,
  createDpopProof,
  verifyDpopProof,
  normalizeDpopHtu,
  type JwkPublicKey,
} from '../../../../shared/dpop'
import {
  ALLOWLISTED_KEYS,
  DEVICE_ONLY_KEYS,
  BANDS,
  GENERIC_HEALTHY_EATING_PROFILE,
  bandValue,
  scrubAndBandConstraints,
  computeConstraintFingerprint,
  applyCohortGate,
  deriveShopperAlias,
  deriveTenantAlias,
  mintDpt,
  verifyDpt,
} from '../../../../shared/dpt'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSigner() {
  return new LocalEd25519Signer()
}

function makeKeyPair() {
  return generateKeyPairSync('ed25519')
}

// ---------------------------------------------------------------------------
// 1. DPoP Proof Generation & RFC 7638 Thumbprint
// ---------------------------------------------------------------------------
describe('CAD Blueprint Phase 7: DPoP', () => {
  let signer: LocalEd25519Signer
  let publicJwk: JwkPublicKey

  beforeEach(() => {
    signer = makeSigner()
    publicJwk = signer.getPublicKeyJwk() as JwkPublicKey
  })

  describe('RFC 7638 JWK Thumbprint (cnf.jkt)', () => {
    it('computes a stable SHA-256 base64url thumbprint for OKP key', () => {
      const jkt1 = computeJwkThumbprint(publicJwk)
      const jkt2 = computeJwkThumbprint(publicJwk)
      expect(jkt1).toBe(jkt2)
      expect(jkt1.length).toBeGreaterThan(20)
      // Base64url — no +, /, = chars
      expect(jkt1).not.toMatch(/[+/=]/)
    })

    it('produces different thumbprints for different keys', () => {
      const signer2 = makeSigner()
      const publicJwk2 = signer2.getPublicKeyJwk() as JwkPublicKey
      const jkt1 = computeJwkThumbprint(publicJwk)
      const jkt2 = computeJwkThumbprint(publicJwk2)
      expect(jkt1).not.toBe(jkt2)
    })

    it('throws on unsupported key type', () => {
      expect(() =>
        computeJwkThumbprint({ kty: 'UNSUPPORTED' } as JwkPublicKey),
      ).toThrow('Unsupported JWK key type')
    })

    it('includes only canonical members for OKP: crv, kty, x', () => {
      // Thumbprint must match even when extra fields are present
      const jktFull = computeJwkThumbprint({ ...publicJwk, extra: 'ignored' })
      const jktClean = computeJwkThumbprint(publicJwk)
      expect(jktFull).toBe(jktClean)
    })
  })

  describe('DPoP Proof Generation', () => {
    it('creates a 3-part JWT with correct typ header', () => {
      const { privateKey } = makeKeyPair()
      const proof = createDpopProof(privateKey, publicJwk, 'POST', 'https://api.example.com/token')
      const parts = proof.split('.')
      expect(parts).toHaveLength(3)
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
      expect(header.typ).toBe('dpop+jwt')
      expect(header.alg).toBe('EdDSA')
      expect(header.jwk).toBeDefined()
    })

    it('embeds htm, htu, iat, jti in payload', () => {
      const { privateKey } = makeKeyPair()
      const proof = createDpopProof(privateKey, publicJwk, 'GET', 'https://api.example.com/resource')
      const parts = proof.split('.')
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      expect(payload.htm).toBe('GET')
      expect(payload.htu).toBe('https://api.example.com/resource')
      expect(typeof payload.iat).toBe('number')
      expect(typeof payload.jti).toBe('string')
      expect(payload.jti.length).toBeGreaterThan(0)
    })

    it('normalises htu: strips query string and fragment', () => {
      const norm = normalizeDpopHtu('https://api.example.com/path?foo=bar#anchor')
      expect(norm).toBe('https://api.example.com/path')
    })

    it('computes ath when accessToken is provided', () => {
      const { privateKey } = makeKeyPair()
      const proof = createDpopProof(
        privateKey,
        publicJwk,
        'POST',
        'https://api.example.com/resource',
        { accessToken: 'my-access-token' },
      )
      const parts = proof.split('.')
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      expect(payload.ath).toBeDefined()
    })
  })

  describe('DPoP Proof Verification', () => {
    it('verifies a freshly generated proof (valid path)', () => {
      const proof = createDpopProof(signer.getPrivateKey(), publicJwk, 'POST', 'https://api.example.com/token')
      const result = verifyDpopProof(proof, 'POST', 'https://api.example.com/token')
      expect(result.valid).toBe(true)
      expect(result.jkt).toBeDefined()
      expect(result.error).toBeUndefined()
    })

    it('rejects a replayed DPoP proof (same jti)', () => {
      const replayCache = new Set<string>()
      const proof = createDpopProof(
        signer.getPrivateKey(),
        publicJwk,
        'POST',
        'https://api.example.com/token',
        { jti: 'fixed-jti-for-replay-test' },
      )
      const first = verifyDpopProof(proof, 'POST', 'https://api.example.com/token', replayCache)
      expect(first.valid).toBe(true)

      // Second call with same proof must be rejected
      const second = verifyDpopProof(proof, 'POST', 'https://api.example.com/token', replayCache)
      expect(second.valid).toBe(false)
      expect(second.error).toMatch(/replay/i)
    })

    it('accepts a proof within 60s of iat', () => {
      const now = Math.floor(Date.now() / 1000)
      const proof = createDpopProof(
        signer.getPrivateKey(),
        publicJwk,
        'POST',
        'https://api.example.com/token',
        { iat: now - 30 }, // 30s ago — within window
      )
      const result = verifyDpopProof(proof, 'POST', 'https://api.example.com/token')
      expect(result.valid).toBe(true)
    })

    it('rejects a proof older than 60s (freshness window expired)', () => {
      const { privateKey } = makeKeyPair()
      const now = Math.floor(Date.now() / 1000)
      const proof = createDpopProof(
        privateKey,
        publicJwk,
        'POST',
        'https://api.example.com/token',
        { iat: now - 120 }, // 120s ago — stale
      )
      const result = verifyDpopProof(proof, 'POST', 'https://api.example.com/token')
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/expired|drifted/i)
    })

    it('rejects a proof with wrong HTTP method', () => {
      const { privateKey } = makeKeyPair()
      const proof = createDpopProof(privateKey, publicJwk, 'GET', 'https://api.example.com/token')
      const result = verifyDpopProof(proof, 'POST', 'https://api.example.com/token')
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/method mismatch/i)
    })

    it('rejects a proof with wrong URI', () => {
      const { privateKey } = makeKeyPair()
      const proof = createDpopProof(
        privateKey,
        publicJwk,
        'POST',
        'https://api.example.com/other',
      )
      const result = verifyDpopProof(proof, 'POST', 'https://api.example.com/token')
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/uri mismatch/i)
    })

    it('rejects a malformed JWT (2 parts)', () => {
      const result = verifyDpopProof('header.payload', 'POST', 'https://api.example.com/token')
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/malformed/i)
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Scrubbing, Banding & Cohort Gate
// ---------------------------------------------------------------------------
describe('CAD Blueprint Phase 7: Scrub, Band & Cohort Gate', () => {
  describe('bandValue', () => {
    it('rounds sugar up to the next standard tier', () => {
      // Tiers: [5, 10, 15, 22.5, 30]
      expect(bandValue('sugars_g_100g_max', 4)).toBe(5)
      expect(bandValue('sugars_g_100g_max', 5)).toBe(5)
      expect(bandValue('sugars_g_100g_max', 6)).toBe(10)
      expect(bandValue('sugars_g_100g_max', 11)).toBe(15)
      expect(bandValue('sugars_g_100g_max', 31)).toBe(30) // capped at max tier
    })

    it('rounds sodium up to the next tier', () => {
      // Tiers: [120, 300, 600, 900, 1500]
      expect(bandValue('sodium_mg_100g_max', 100)).toBe(120)
      expect(bandValue('sodium_mg_100g_max', 301)).toBe(600)
    })

    it('rounds fibre (min) DOWN to the nearest tier', () => {
      // Tiers: [3, 6, 10]
      expect(bandValue('fibre_g_100g_min', 9)).toBe(6)
      expect(bandValue('fibre_g_100g_min', 3)).toBe(3)
      expect(bandValue('fibre_g_100g_min', 1)).toBe(3) // below all tiers → lowest tier
    })

    it('returns the value as-is for an unknown key', () => {
      expect(bandValue('unknown_key', 99)).toBe(99)
    })
  })

  describe('scrubAndBandConstraints', () => {
    it('bands all allowlisted keys and returns correct output', () => {
      const raw = {
        sugars_g_100g_max: 7,
        carbs_g_100g_max: 25,
        sodium_mg_100g_max: 200,
        satfat_g_100g_max: 3,
        energy_kcal_100g_max: 180,
        fibre_g_100g_min: 5,
      }
      const { banded, droppedDeviceOnly } = scrubAndBandConstraints(raw)
      expect(droppedDeviceOnly).toHaveLength(0)
      expect(banded.sugars_g_100g_max).toBe(10) // 7 → 10
      expect(banded.carbs_g_100g_max).toBe(30)  // 25 → 30
      expect(banded.sodium_mg_100g_max).toBe(300) // 200 → 300
      expect(banded.satfat_g_100g_max).toBe(5)   // 3 → 5
      expect(banded.energy_kcal_100g_max).toBe(200) // 180 → 200
      expect(banded.fibre_g_100g_min).toBe(3)    // 5 → rounds down to 3
    })

    it('silently drops device-only dimensions (protein, potassium, phosphorus)', () => {
      const raw = {
        sugars_g_100g_max: 5,
        protein_g_100g_max: 20,
        potassium_mg_100g_max: 500,
        phosphorus_mg_100g_max: 400,
      }
      const { banded, droppedDeviceOnly } = scrubAndBandConstraints(raw)
      expect(droppedDeviceOnly).toContain('protein_g_100g_max')
      expect(droppedDeviceOnly).toContain('potassium_mg_100g_max')
      expect(droppedDeviceOnly).toContain('phosphorus_mg_100g_max')
      expect(banded).not.toHaveProperty('protein_g_100g_max')
      expect(banded).not.toHaveProperty('potassium_mg_100g_max')
      expect(banded).not.toHaveProperty('phosphorus_mg_100g_max')
      expect(banded.sugars_g_100g_max).toBe(5)
    })

    it('throws on a condition-named key (D5 ban)', () => {
      expect(() =>
        scrubAndBandConstraints({ diabetic_friendly: 1 }),
      ).toThrow(/condition-named/i)
      expect(() =>
        scrubAndBandConstraints({ renal_safe_score: 1 }),
      ).toThrow(/condition-named/i)
    })

    it('throws on a condition-named string value (D5 ban)', () => {
      expect(() =>
        scrubAndBandConstraints({ label: 'renal_safe' }),
      ).toThrow(/condition-named/i)
    })

    it('throws on an unknown key outside allowlist and device-only', () => {
      expect(() =>
        scrubAndBandConstraints({ super_nutrient_score: 10 }),
      ).toThrow(/unknown constraint key/i)
    })

    it('throws if an allowlisted key has a non-numeric value', () => {
      expect(() =>
        scrubAndBandConstraints({ sugars_g_100g_max: 'low' as any }),
      ).toThrow(/must be a valid number/i)
    })
  })

  describe('applyCohortGate', () => {
    const banded = { sugars_g_100g_max: 10, sodium_mg_100g_max: 300 }

    it('keeps original constraints when cohort count >= 5', () => {
      const result = applyCohortGate(banded, 5)
      expect(result.generalised).toBe(false)
      expect(result.constraints).toEqual(banded)
    })

    it('generalises to generic healthy profile when cohort count < 5', () => {
      const result = applyCohortGate(banded, 4)
      expect(result.generalised).toBe(true)
      expect(result.constraints).toEqual(GENERIC_HEALTHY_EATING_PROFILE)
    })

    it('generalises when cohort count is 1 (rare profile)', () => {
      const result = applyCohortGate(banded, 1)
      expect(result.generalised).toBe(true)
    })

    it('keeps constraints when cohort count is exactly at the threshold (k=5)', () => {
      const result = applyCohortGate(banded, 5, 5)
      expect(result.generalised).toBe(false)
    })

    it('honours a custom k parameter', () => {
      const result = applyCohortGate(banded, 10, 20)
      expect(result.generalised).toBe(true) // 10 < 20 → generalised
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Shopper Alias & Tenant Alias Derivation
// ---------------------------------------------------------------------------
describe('CAD Blueprint Phase 7: Alias Derivation', () => {
  describe('deriveShopperAlias — browse mode (CSPRNG)', () => {
    it('returns a non-empty base64url string', () => {
      const alias = deriveShopperAlias('browse', 'patient-1')
      expect(typeof alias).toBe('string')
      expect(alias.length).toBeGreaterThan(0)
      expect(alias).not.toMatch(/[+/=]/)
    })

    it('returns a different alias on each call (ephemeral CSPRNG)', () => {
      const a1 = deriveShopperAlias('browse', 'patient-1')
      const a2 = deriveShopperAlias('browse', 'patient-1')
      expect(a1).not.toBe(a2)
    })
  })

  describe('deriveShopperAlias — order mode (HMAC, pairwise per epoch)', () => {
    it('returns the same alias for the same patient + epoch', () => {
      const epochKey = new Uint8Array(32).fill(0x42)
      const a1 = deriveShopperAlias('order', 'patient-1', epochKey, '2026-Q1')
      const a2 = deriveShopperAlias('order', 'patient-1', epochKey, '2026-Q1')
      expect(a1).toBe(a2)
    })

    it('returns a different alias for a different epoch', () => {
      const epochKey = new Uint8Array(32).fill(0x42)
      const a1 = deriveShopperAlias('order', 'patient-1', epochKey, '2026-Q1')
      const a2 = deriveShopperAlias('order', 'patient-1', epochKey, '2026-Q2')
      expect(a1).not.toBe(a2)
    })

    it('returns a different alias for a different patient in the same epoch', () => {
      const epochKey = new Uint8Array(32).fill(0x42)
      const a1 = deriveShopperAlias('order', 'patient-1', epochKey, '2026-Q1')
      const a2 = deriveShopperAlias('order', 'patient-2', epochKey, '2026-Q1')
      expect(a1).not.toBe(a2)
    })

    it('throws if epochKey or epoch is missing in order mode', () => {
      expect(() => deriveShopperAlias('order', 'patient-1')).toThrow(/epochKey.*epoch/i)
    })
  })

  describe('deriveTenantAlias', () => {
    it('returns a stable t_-prefixed alias for the same tenantId', () => {
      const a1 = deriveTenantAlias('tenant-abc')
      const a2 = deriveTenantAlias('tenant-abc')
      expect(a1).toBe(a2)
      expect(a1).toMatch(/^t_/)
    })

    it('returns different aliases for different tenants', () => {
      const a1 = deriveTenantAlias('tenant-abc')
      const a2 = deriveTenantAlias('tenant-xyz')
      expect(a1).not.toBe(a2)
    })

    it('is opaque: does not contain the raw tenantId', () => {
      const alias = deriveTenantAlias('tenant-abc')
      expect(alias).not.toContain('tenant-abc')
    })
  })
})

// ---------------------------------------------------------------------------
// 4. DPT Minting & Verification
// ---------------------------------------------------------------------------
describe('CAD Blueprint Phase 7: DPT Mint & Verify', () => {
  let signer: LocalEd25519Signer
  let dpopJkt: string
  let publicKeyObj: ReturnType<typeof generateKeyPairSync>['publicKey']

  beforeEach(() => {
    signer = makeSigner()
    const publicJwk = signer.getPublicKeyJwk() as JwkPublicKey
    dpopJkt = computeJwkThumbprint(publicJwk)
    publicKeyObj = signer.getPublicKey()
  })

  const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const PATIENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const constraints = { sugars_g_100g_max: 10, sodium_mg_100g_max: 300 }

  describe('mintDpt', () => {
    it('mints a valid 3-part JWT with correct issuer and audience', () => {
      const { token, payload } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints,
        dpopJkt,
      })
      expect(token.split('.')).toHaveLength(3)
      expect(payload.iss).toBe('https://exchange.nutriscore.co.ke')
      expect(payload.aud).toBe('ns-commercial')
    })

    it('sets exp = iat + 900 (15-minute default lifetime)', () => {
      const now = Math.floor(Date.now() / 1000)
      const { payload } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints,
        dpopJkt,
        iat: now,
      })
      expect(payload.exp).toBe(now + 900)
    })

    it('honours a custom ttlSeconds', () => {
      const now = Math.floor(Date.now() / 1000)
      const { payload } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints,
        dpopJkt,
        iat: now,
        ttlSeconds: 3600,
      })
      expect(payload.exp).toBe(now + 3600)
    })

    it('embeds cnf.jkt matching the provided dpopJkt', () => {
      const { payload } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints,
        dpopJkt,
      })
      expect(payload.cnf.jkt).toBe(dpopJkt)
    })

    it('embeds an opaque tnt alias (does not contain raw tenantId)', () => {
      const { payload } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints,
        dpopJkt,
      })
      expect(payload.tnt).toMatch(/^t_/)
      expect(payload.tnt).not.toContain(TENANT)
    })

    it('embeds an opaque shp alias (does not contain raw patientId)', () => {
      const { payload } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints,
        dpopJkt,
      })
      expect(payload.shp).toBeDefined()
      expect(payload.shp).not.toContain(PATIENT)
    })

    it('throws when Signer is marked unavailable', () => {
      const unavailableSigner = makeSigner()
      unavailableSigner.setAvailable(false)
      expect(() =>
        mintDpt(unavailableSigner, {
          tenantId: TENANT,
          patientId: PATIENT,
          constraints,
          dpopJkt,
        }),
      ).toThrow(/signer is unavailable/i)
    })
  })

  describe('verifyDpt', () => {
    it('verifies a freshly minted DPT (happy path)', () => {
      const { token } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints,
        dpopJkt,
      })
      const result = verifyDpt(token, publicKeyObj, dpopJkt)
      expect(result.valid).toBe(true)
      expect(result.payload).toBeDefined()
      expect(result.error).toBeUndefined()
    })

    it('rejects an expired DPT', () => {
      const pastIat = Math.floor(Date.now() / 1000) - 1800
      const { token } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints,
        dpopJkt,
        iat: pastIat,
        ttlSeconds: 900, // exp = pastIat + 900 < now
      })
      const result = verifyDpt(token, publicKeyObj, dpopJkt)
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/expired/i)
    })

    it('rejects a revoked jti', () => {
      const { token, jti } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints,
        dpopJkt,
      })
      const revokedJtis = new Set([jti])
      const result = verifyDpt(token, publicKeyObj, dpopJkt, revokedJtis)
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/revoked/i)
    })

    it('rejects a DPoP jkt mismatch', () => {
      const { token } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints,
        dpopJkt,
      })
      const result = verifyDpt(token, publicKeyObj, 'wrong-jkt-value')
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/jkt mismatch/i)
    })

    it('rejects algorithm "none" (alg downgrade attack)', () => {
      const { token } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints,
        dpopJkt,
      })
      const parts = token.split('.')
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
      header.alg = 'none'
      const tamperedParts = [
        Buffer.from(JSON.stringify(header)).toString('base64url'),
        parts[1],
        parts[2],
      ]
      const result = verifyDpt(tamperedParts.join('.'), publicKeyObj, dpopJkt)
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/none.*rejected/i)
    })

    it('rejects a DPT containing a forbidden constraint key', () => {
      // Manually build a token with a non-allowlisted key in cs
      const { token } = mintDpt(signer, {
        tenantId: TENANT,
        patientId: PATIENT,
        constraints: { sugars_g_100g_max: 10 },
        dpopJkt,
      })
      const parts = token.split('.')
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      payload.cs['forbidden_key'] = 1
      // Re-sign with signer
      const headerB64 = parts[0]
      const newPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
      const signingInput = `${headerB64}.${newPayloadB64}`
      const sig = signer.sign(signingInput)
      const tamperedToken = `${signingInput}.${Buffer.from(sig).toString('base64url')}`
      const result = verifyDpt(tamperedToken, publicKeyObj, dpopJkt)
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/forbidden.*key/i)
    })

    it('rejects a malformed token (2 parts)', () => {
      const result = verifyDpt('header.payload', publicKeyObj, dpopJkt)
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/malformed/i)
    })
  })
})

// ---------------------------------------------------------------------------
// 5. Signer Availability (outage fallback)
// ---------------------------------------------------------------------------
describe('CAD Blueprint Phase 7: Signer Availability', () => {
  it('LocalEd25519Signer.isAvailable() returns true by default', () => {
    const signer = makeSigner()
    expect(signer.isAvailable()).toBe(true)
  })

  it('LocalEd25519Signer.isAvailable() returns false when disabled', () => {
    const signer = makeSigner()
    signer.setAvailable(false)
    expect(signer.isAvailable()).toBe(false)
  })

  it('mintDpt throws (not silently succeeds) when signer is unavailable', () => {
    const signer = makeSigner()
    signer.setAvailable(false)
    const dpopJkt = computeJwkThumbprint(signer.getPublicKeyJwk() as JwkPublicKey)
    expect(() =>
      mintDpt(signer, {
        tenantId: 'any-tenant',
        patientId: 'any-patient',
        constraints: { sugars_g_100g_max: 10 },
        dpopJkt,
      }),
    ).toThrow(/signer is unavailable/i)
  })

  it('getKid returns a non-empty string', () => {
    const signer = makeSigner()
    expect(typeof signer.getKid()).toBe('string')
    expect(signer.getKid().length).toBeGreaterThan(0)
  })

  it('getPublicKeyJwk returns a valid OKP Ed25519 JWK', () => {
    const signer = makeSigner()
    const key = signer.getPublicKeyJwk() as JwkPublicKey
    expect(key.kty).toBe('OKP')
    expect(key.crv).toBe('Ed25519')
    expect(key.x).toBeDefined()
  })
})
