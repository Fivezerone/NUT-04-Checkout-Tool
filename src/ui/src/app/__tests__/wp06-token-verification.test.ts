// src/ui/src/app/__tests__/wp06-token-verification.test.ts
// Unit and Contract Tests for WP-06: Token and Bundle Verification
// Reference: Blueprint §2.7, §3.1 (N1), §5.6 (WP-06, X-02, X-05, X-06, A-05, ADR-3)

import { describe, it, expect, beforeEach } from 'vitest'
import {
  verifyBundle,
  verifyBundleAsync,
  signBundleAsync,
  withoutSignature,
  type TargetBundle,
} from '../../../../shared/target-sync'
import {
  lintProfileToken,
  mintProfileToken,
  verifyProfileToken,
  CODEX_EU_ALLERGENS,
  type ProfileTokenClaims,
} from '../../../../shared/profile-token'
import {
  deriveTenantAlias,
  deriveTenantAliasAsync,
  mintDpt,
  mintDptAsync,
  verifyDpt,
  verifyDptAsync,
} from '../../../../shared/dpt'
import { BoundedReplayCache, createDpopProof } from '../../../../shared/dpop'
import { filterCatalogueWithDpt } from '../../../../shared/commercial-catalogue'
import { LocalEd25519Signer } from '../../../../shared/signer'
import { generateKeyPairSync } from 'node:crypto'

describe('WP-06: Token and Bundle Verification Suite', () => {
  const signer = new LocalEd25519Signer('wp06-test-key-01')

  const sampleTargetBundle: TargetBundle = {
    tenantId: 'tenant-nairobi-01',
    subjectRef: 'shopper-test-ref-42',
    targets: [
      {
        targetId: 'tgt-sodium-01',
        nutrientCode: 'SodiumMG',
        unit: 'mg',
        basis: 'per_day',
        comparator: 'lte',
        value: 1500,
        severity: 'critical',
        validFrom: '2026-10-01T00:00:00Z',
        validTo: '2026-12-31T23:59:59Z',
        status: 'active',
      },
    ],
    platformRuleVersion: 1,
    issuedAt: '2026-10-01T00:00:00Z',
    validTo: '2026-12-31T23:59:59Z',
    bundleVersion: 10,
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Target Bundle Verification (X-02, Blueprint §2.7)
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Target Bundle Verification (X-02, Blueprint §2.7)', () => {
    it('accepts a valid target bundle with legacy signature bridge', () => {
      const res = verifyBundle(
        sampleTargetBundle,
        'sig_es256_legacy_bridge_valid',
        null,
        '2026-10-15T00:00:00Z',
      )
      expect(res.valid).toBe(true)
      expect(res.code).toBe('OK')
      expect(res.legacyOnly).toBe(true)
    })

    it('rejects target bundle with invalid NaN expiry timestamp', () => {
      const corruptedBundle = {
        ...sampleTargetBundle,
        validTo: 'invalid-date-not-finite',
      }
      const res = verifyBundle(
        corruptedBundle,
        'sig_es256_valid',
        null,
        '2026-10-15T00:00:00Z',
      )
      expect(res.valid).toBe(false)
      expect(res.code).toBe('INVALID_EXPIRY')
      expect(res.message).toMatch(/validTo timestamp is not a finite date/i)
    })

    it('rejects target bundle issued in the future (> now + 5 minutes)', () => {
      const futureBundle = {
        ...sampleTargetBundle,
        issuedAt: '2026-10-15T01:00:00Z', // 1 hour in future
      }
      const res = verifyBundle(
        futureBundle,
        'sig_es256_valid',
        null,
        '2026-10-15T00:00:00Z',
      )
      expect(res.valid).toBe(false)
      expect(res.code).toBe('ISSUED_IN_FUTURE')
      expect(res.message).toMatch(/issued_in_future|issuedAt is in the future/i)
    })

    it('rejects target bundle on tenantId binding mismatch with device context', () => {
      const res = verifyBundle(
        sampleTargetBundle,
        'sig_es256_valid',
        null,
        '2026-10-15T00:00:00Z',
        {
          ctx: {
            tenantId: 'tenant-mombasa-99', // Different tenant!
            subjectRef: 'shopper-test-ref-42',
          },
        },
      )
      expect(res.valid).toBe(false)
      expect(res.code).toBe('BINDING_MISMATCH')
      expect(res.message).toMatch(/tenantId.*does not match device context/i)
    })

    it('rejects target bundle on subjectRef binding mismatch with device context', () => {
      const res = verifyBundle(
        sampleTargetBundle,
        'sig_es256_valid',
        null,
        '2026-10-15T00:00:00Z',
        {
          ctx: {
            tenantId: 'tenant-nairobi-01',
            subjectRef: 'shopper-other-user', // Different subject!
          },
        },
      )
      expect(res.valid).toBe(false)
      expect(res.code).toBe('BINDING_MISMATCH')
      expect(res.message).toMatch(/subjectRef.*does not match device context/i)
    })

    it('accepts target bundle when tenantId and subjectRef match device context', () => {
      const res = verifyBundle(
        sampleTargetBundle,
        'sig_es256_valid',
        null,
        '2026-10-15T00:00:00Z',
        {
          ctx: {
            tenantId: 'tenant-nairobi-01',
            subjectRef: 'shopper-test-ref-42',
          },
        },
      )
      expect(res.valid).toBe(true)
      expect(res.code).toBe('OK')
    })

    it('rejects legacy signature bridge when strictCrypto is enabled', () => {
      const res = verifyBundle(
        sampleTargetBundle,
        'sig_es256_valid',
        null,
        '2026-10-15T00:00:00Z',
        { strictCrypto: true },
      )
      expect(res.valid).toBe(false)
      expect(res.code).toBe('INVALID_SIGNATURE')
      expect(res.message).toMatch(/Cryptographic Ed25519 signature required in strict mode/i)
    })

    it('signs and cryptographically verifies detached Ed25519 signature via verifyBundleAsync', async () => {
      const signedBundle = await signBundleAsync(sampleTargetBundle, signer)
      expect(signedBundle.sig).toBeDefined()
      expect(signedBundle.kid).toBe('wp06-test-key-01')

      // Verify with public key
      const publicKeyJwk = await signer.getPublicKeyJwk()
      const res = await verifyBundleAsync(
        signedBundle,
        null,
        '2026-10-15T00:00:00Z',
        {
          publicKey: publicKeyJwk,
          strictCrypto: true,
          ctx: {
            tenantId: 'tenant-nairobi-01',
            subjectRef: 'shopper-test-ref-42',
          },
        },
      )
      expect(res.valid).toBe(true)
      expect(res.code).toBe('OK')
    })

    it('rejects tampered bundle content under detached Ed25519 verification', async () => {
      const signedBundle = await signBundleAsync(sampleTargetBundle, signer)
      const tampered = {
        ...signedBundle,
        targets: [
          {
            ...signedBundle.targets[0],
            value: 9999, // Tampered limit!
          },
        ],
      }

      const publicKeyJwk = await signer.getPublicKeyJwk()
      const res = await verifyBundleAsync(
        tampered,
        null,
        '2026-10-15T00:00:00Z',
        {
          publicKey: publicKeyJwk,
          strictCrypto: true,
        },
      )
      expect(res.valid).toBe(false)
      expect(res.code).toBe('INVALID_SIGNATURE')
      expect(res.message).toMatch(/signature verification failed/i)
    })

    it('withoutSignature correctly strips sig and signature fields', () => {
      const withSig = {
        ...sampleTargetBundle,
        sig: 'mock-sig-base64',
        signature: 'sig_es256_mock',
      }
      const stripped = withoutSignature(withSig)
      expect(stripped.sig).toBeUndefined()
      expect(stripped.signature).toBeUndefined()
      expect(stripped.bundleVersion).toBe(10)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Profile Token Contract & Linting (X-05, Blueprint §3.1 N1)
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Profile Token Contract & Linting (X-05, Blueprint §3.1 N1)', () => {
    const validClaims: ProfileTokenClaims = {
      iss: 'https://exchange.nutriscore.co.ke',
      aud: 'ext:carrefour',
      sub: 'shopper-alias-anon-99',
      iat: 1760000000,
      nbf: 1760000000,
      exp: 1760000000 + 30 * 86400, // 30 days
      jti: 'jti-uuid-profile-01',
      profile_ver: 3,
      cnf: { jkt: 'test-dpop-jkt-thumbprint' },
      ctr: {
        per_100g_flags: [
          { n: 'sodium_mg_100g_max', gt: 600, action: 'warn' },
          { n: 'sugars_g_100g_max', gt: 15, action: 'confirm' },
        ],
        per_day: { sodium_mg_100g_max: 2000 },
        exclude: ['gluten', 'peanuts'],
        nova4_cap_pct: 20,
      },
      policy: {
        block_mode: 'warn_only',
        min_conf: 'verified',
        reason_classes: ['CLINICAL_SAFETY', 'NUTRITIONAL_POLICY'],
      },
      consent: {
        ref: 'receipt-cr-2026-001',
        purposes: ['C1', 'C2'],
      },
    }

    it('validates Codex + EU allergen vocabulary standard', () => {
      expect(CODEX_EU_ALLERGENS).toHaveLength(14)
      expect(CODEX_EU_ALLERGENS).toContain('gluten')
      expect(CODEX_EU_ALLERGENS).toContain('peanuts')
      expect(CODEX_EU_ALLERGENS).toContain('milk')
      expect(CODEX_EU_ALLERGENS).toContain('crustaceans')
    })

    it('accepts compliant numerical constraints with zero condition names', () => {
      const lint = lintProfileToken(validClaims)
      expect(lint.valid).toBe(true)
      expect(lint.errors).toHaveLength(0)
    })

    it('rejects condition-named labels in constraints (diabetic, renal, hypertension)', () => {
      const badClaims1 = JSON.parse(JSON.stringify(validClaims))
      badClaims1.ctr.per_100g_flags.push({
        n: 'diabetic_sugar_limit',
        gt: 10,
        action: 'warn',
      })
      const lint1 = lintProfileToken(badClaims1)
      expect(lint1.valid).toBe(false)
      expect(lint1.errors.some((e) => /diabetic/i.test(e))).toBe(true)

      const badClaims2 = JSON.parse(JSON.stringify(validClaims))
      badClaims2.policy.reason_classes.push('HYPERTENSION_CARE' as any)
      const lint2 = lintProfileToken(badClaims2)
      expect(lint2.valid).toBe(false)
      expect(lint2.errors.some((e) => /hypertension/i.test(e))).toBe(true)
    })

    it('rejects invalid audience not prefixed with ext:', () => {
      const badAud = { ...validClaims, aud: 'carrefour-direct' as any }
      const lint = lintProfileToken(badAud)
      expect(lint.valid).toBe(false)
      expect(lint.errors.some((e) => /prefixed with 'ext:'/i.test(e))).toBe(true)
    })

    it('rejects invalid profile_ver <= 0 or non-integer', () => {
      const badVer = { ...validClaims, profile_ver: 0 }
      const lint = lintProfileToken(badVer)
      expect(lint.valid).toBe(false)
      expect(lint.errors.some((e) => /profile_ver must be a positive integer/i.test(e))).toBe(true)
    })

    it('rejects consent with invalid statutory purpose codes', () => {
      const badConsent = {
        ...validClaims,
        consent: { ref: 'ref-1', purposes: ['C1', 'MARKETING_PROMO' as any] },
      }
      const lint = lintProfileToken(badConsent)
      expect(lint.valid).toBe(false)
      expect(lint.errors.some((e) => /Invalid consent purpose/i.test(e))).toBe(true)
    })

    it('rejects policy.min_conf other than verified (fail-closed safety)', () => {
      const badConf = {
        ...validClaims,
        policy: { ...validClaims.policy, min_conf: 'unverified' },
      }
      const lint = lintProfileToken(badConf)
      expect(lint.valid).toBe(false)
      expect(lint.errors.some((e) => /min_conf.*'verified'/i.test(e))).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Minting & Verification of Profile Tokens (Blueprint §2.7, §3.1)
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Minting & Verification of Profile Tokens (Blueprint §2.7, §3.1)', () => {
    const claims: ProfileTokenClaims = {
      iss: 'https://exchange.nutriscore.co.ke',
      aud: 'ext:naivas',
      sub: 'shopper-test-alias-01',
      iat: 1760000000,
      nbf: 1760000000,
      exp: 1760000000 + 3600,
      jti: 'jti-valid-001',
      profile_ver: 5,
      cnf: { jkt: 'device-dpop-thumbprint-xyz' },
      ctr: {
        per_100g_flags: [{ n: 'sodium_mg_100g_max', gt: 500, action: 'warn' }],
        exclude: ['tree_nuts'],
      },
      policy: {
        block_mode: 'confirm',
        min_conf: 'verified',
        reason_classes: ['CLINICAL_SAFETY'],
      },
      consent: {
        ref: 'receipt-001',
        purposes: ['C1', 'C3'],
      },
    }

    it('mints a valid profile token awaiting signer.sign() with EdDSA', async () => {
      const res = await mintProfileToken(signer, claims)
      expect(res.token).toBeDefined()
      expect(res.token.length).toBeLessThanOrEqual(4096)
      expect(res.jti).toBe('jti-valid-001')
      expect(res.expiresAt.getTime()).toBe((1760000000 + 3600) * 1000)

      const parts = res.token.split('.')
      expect(parts).toHaveLength(3)
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
      expect(header.alg).toBe('EdDSA')
      expect(header.typ).toBe('ns-profile+jwt')
      expect(header.kid).toBe('wp06-test-key-01')
    })

    it('rejects minting if claims contain condition-named strings', async () => {
      const badClaims = JSON.parse(JSON.stringify(claims))
      badClaims.ctr.per_100g_flags[0].n = 'renal_potassium_max'
      await expect(mintProfileToken(signer, badClaims)).rejects.toThrow(/Profile token lint failed/i)
    })

    it('cryptographically verifies profile token against public key JWK', async () => {
      const { token } = await mintProfileToken(signer, claims)
      const publicKeyJwk = await signer.getPublicKeyJwk()

      const verifyRes = await verifyProfileToken(token, {
        publicKey: publicKeyJwk,
        expectedAudience: 'ext:naivas',
        now: 1760000500, // within iat and exp
        storedProfileVer: 4, // 5 >= 4 passes
        deviceJkt: 'device-dpop-thumbprint-xyz',
      })

      expect(verifyRes.valid).toBe(true)
      expect(verifyRes.code).toBe('OK')
      expect(verifyRes.claims?.sub).toBe('shopper-test-alias-01')
      expect(verifyRes.claims?.profile_ver).toBe(5)
    })

    it('rejects token exceeding 4096-byte limit', async () => {
      const giantToken = 'a'.repeat(4097)
      const verifyRes = await verifyProfileToken(giantToken)
      expect(verifyRes.valid).toBe(false)
      expect(verifyRes.code).toBe('TOKEN_TOO_LARGE')
    })

    it('rejects token with algorithm other than EdDSA', async () => {
      const { token } = await mintProfileToken(signer, claims)
      const parts = token.split('.')
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
      header.alg = 'ES256'
      const tampered = [Buffer.from(JSON.stringify(header)).toString('base64url'), parts[1], parts[2]].join('.')

      const verifyRes = await verifyProfileToken(tampered)
      expect(verifyRes.valid).toBe(false)
      expect(verifyRes.code).toBe('INVALID_ALGORITHM')
    })

    it('verifies cryptographic signature BEFORE evaluating claims (fails on signature)', async () => {
      const { token } = await mintProfileToken(signer, claims)
      const parts = token.split('.')
      // Tamper signature bytes
      const tamperedSig = parts[2].slice(0, -4) + 'AAAA'
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`
      const publicKeyJwk = await signer.getPublicKeyJwk()

      const verifyRes = await verifyProfileToken(tamperedToken, {
        publicKey: publicKeyJwk,
      })
      expect(verifyRes.valid).toBe(false)
      expect(verifyRes.code).toBe('INVALID_SIGNATURE')
    })

    it('rejects expired profile token beyond clock skew', async () => {
      const { token } = await mintProfileToken(signer, claims)
      const publicKeyJwk = await signer.getPublicKeyJwk()

      const verifyRes = await verifyProfileToken(token, {
        publicKey: publicKeyJwk,
        now: 1760000000 + 3600 + 61, // 61s past exp (exceeds default 60s skew)
      })
      expect(verifyRes.valid).toBe(false)
      expect(verifyRes.code).toBe('TOKEN_EXPIRED')
    })

    it('rejects rollback when token profile_ver is less than stored profile_ver', async () => {
      const { token } = await mintProfileToken(signer, claims) // ver is 5
      const publicKeyJwk = await signer.getPublicKeyJwk()

      const verifyRes = await verifyProfileToken(token, {
        publicKey: publicKeyJwk,
        now: 1760000500,
        storedProfileVer: 6, // stored 6 > token 5: ROLLBACK!
      })
      expect(verifyRes.valid).toBe(false)
      expect(verifyRes.code).toBe('ROLLBACK_DETECTED')
      expect(verifyRes.error).toMatch(/Rollback rejected/i)
    })

    it('rejects revoked token when jti is present in revocation list', async () => {
      const { token } = await mintProfileToken(signer, claims)
      const publicKeyJwk = await signer.getPublicKeyJwk()

      const verifyRes = await verifyProfileToken(token, {
        publicKey: publicKeyJwk,
        now: 1760000500,
        revokedJtis: new Set(['jti-valid-001']),
      })
      expect(verifyRes.valid).toBe(false)
      expect(verifyRes.code).toBe('TOKEN_REVOKED')
      expect(verifyRes.error).toMatch(/has been revoked/i)
    })

    it('rejects DPoP binding mismatch when device key thumbprint differs', async () => {
      const { token } = await mintProfileToken(signer, claims)
      const publicKeyJwk = await signer.getPublicKeyJwk()

      const verifyRes = await verifyProfileToken(token, {
        publicKey: publicKeyJwk,
        now: 1760000500,
        deviceJkt: 'different-attacker-thumbprint',
      })
      expect(verifyRes.valid).toBe(false)
      expect(verifyRes.code).toBe('DPOP_BINDING_MISMATCH')
    })

    it('resolves key via JWKS array lookup matching header.kid', async () => {
      const { token } = await mintProfileToken(signer, claims)
      const jwk = await signer.getPublicKeyJwk()
      const jwks = [
        { kid: 'unrelated-key-99', kty: 'OKP', crv: 'Ed25519', x: 'dummy' },
        { ...jwk, kid: 'wp06-test-key-01' },
      ]

      const verifyRes = await verifyProfileToken(token, {
        jwks,
        now: 1760000500,
      })
      expect(verifyRes.valid).toBe(true)
      expect(verifyRes.code).toBe('OK')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 4. DPT Secret Guard & Verification Fixes (X-05, Blueprint §2.7)
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. DPT Secret Guard & Verification Fixes (X-05, Blueprint §2.7)', () => {
    it('deriveTenantAlias throws in production if secret is missing and override is unset', () => {
      const prevEnv = process.env.NODE_ENV
      const prevOverride = process.env.ALLOW_STAGE_A_CRYPTO_IN_PROD
      try {
        process.env.NODE_ENV = 'production'
        delete process.env.ALLOW_STAGE_A_CRYPTO_IN_PROD

        expect(() => deriveTenantAlias('tenant-101')).toThrow(
          /Tenant routing secret is required in production/i,
        )
      } finally {
        process.env.NODE_ENV = prevEnv
        if (prevOverride !== undefined) {
          process.env.ALLOW_STAGE_A_CRYPTO_IN_PROD = prevOverride
        }
      }
    })

    it('deriveTenantAlias succeeds in production with explicit secret', () => {
      const prevEnv = process.env.NODE_ENV
      try {
        process.env.NODE_ENV = 'production'
        const secret = new Uint8Array(32).fill(7)
        const alias = deriveTenantAlias('tenant-101', secret)
        expect(alias).toMatch(/^t_[A-Za-z0-9_-]{8}$/)
      } finally {
        process.env.NODE_ENV = prevEnv
      }
    })

    it('mintDptAsync supports async signers and awaits signer.sign()', async () => {
      const asyncSigner = {
        sign: async (data: string | Uint8Array) => signer.sign(data),
        getKid: () => 'async-key-01',
        isAvailable: () => true,
        getPublicKeyJwk: () => signer.getPublicKeyJwk(),
      }

      const res = await mintDptAsync(asyncSigner as any, {
        tenantId: 'tenant-nairobi',
        patientId: 'patient-42',
        constraints: { sugars_g_100g_max: 10 },
        dpopJkt: 'test-jkt',
      })
      expect(res.token).toBeDefined()
      expect(res.payload.cs.sugars_g_100g_max).toBe(10)
    })

    it('verifyDpt verifies cryptographic signature BEFORE evaluating claims', () => {
      const { token } = mintDpt(signer, {
        tenantId: 'tenant-100',
        patientId: 'patient-test',
        constraints: { sodium_mg_100g_max: 300 },
        dpopJkt: 'test-dpop-thumbprint',
      })
      const parts = token.split('.')
      // Invalidate signature
      const tamperedToken = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -6)}AAAAAA`
      const pubKey = (signer as any).keyPair.publicKey

      const res = verifyDpt(tamperedToken, pubKey, 'test-dpop-thumbprint')
      expect(res.valid).toBe(false)
      expect(res.error).toMatch(/Invalid token signature/i)
    })

    it('verifyDpt pins alg to EdDSA and rejects alg none', () => {
      const { token } = mintDpt(signer, {
        tenantId: 'tenant-100',
        patientId: 'patient-test',
        constraints: { sodium_mg_100g_max: 300 },
        dpopJkt: 'test-dpop-thumbprint',
      })
      const parts = token.split('.')
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
      header.alg = 'none'
      const tamperedParts = [
        Buffer.from(JSON.stringify(header)).toString('base64url'),
        parts[1],
        parts[2],
      ]
      const pubKey = (signer as any).keyPair.publicKey
      const res = verifyDpt(tamperedParts.join('.'), pubKey, 'test-dpop-thumbprint')
      expect(res.valid).toBe(false)
      expect(res.error).toMatch(/none.*rejected/i)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 5. DPoP Bounded Replay Cache (X-06, RFC 9449)
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. DPoP Bounded Replay Cache (X-06, RFC 9449)', () => {
    it('BoundedReplayCache detects replayed JTIs within TTL', () => {
      const cache = new BoundedReplayCache(100, 120)
      expect(cache.has('jti-alpha')).toBe(false)
      cache.add('jti-alpha')
      expect(cache.has('jti-alpha')).toBe(true)
    })

    it('BoundedReplayCache evicts entries when capacity is exceeded', () => {
      const cache = new BoundedReplayCache(50, 120)
      for (let i = 0; i < 60; i++) {
        cache.add(`jti-seq-${i}`)
      }
      expect(cache.size).toBeLessThanOrEqual(50)
      // Newest entry should still be in cache
      expect(cache.has('jti-seq-59')).toBe(true)
    })

    it('commercial-catalogue filterCatalogueWithDpt rejects replayed DPoP proofs', () => {
      const dpopKeyPair = generateKeyPairSync('ed25519')
      const publicJwk = dpopKeyPair.publicKey.export({ format: 'jwk' }) as any
      const requestUrl = 'https://api.nutriscore.co.ke/v1/catalogue/filter'

      const proof = createDpopProof(dpopKeyPair.privateKey, publicJwk, 'POST', requestUrl, {
        jti: 'jti-replay-test-01',
      })

      // We need jkt thumbprint from dpop
      const { token } = mintDpt(signer, {
        tenantId: 'tenant-100',
        patientId: 'patient-42',
        constraints: { sugars_g_100g_max: 15 },
        dpopJkt: 'placeholder',
      })

      // First run with mock cache
      const replayCache = new BoundedReplayCache(100, 120)
      replayCache.add('jti-replay-test-01')

      // Second attempt using same proof should throw replay error
      expect(() => {
        filterCatalogueWithDpt(
          [],
          token,
          proof,
          (signer as any).keyPair.publicKey,
          requestUrl,
          undefined,
          replayCache,
        )
      }).toThrow(/Replayed DPoP proof/i)
    })
  })
})
