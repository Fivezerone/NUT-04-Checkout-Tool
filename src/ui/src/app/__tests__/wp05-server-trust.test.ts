// src/ui/src/app/__tests__/wp05-server-trust.test.ts
// NutriScore Blueprint Wave 1 / WP-05: Server Trust Boundary Fixes
// Findings closed: X-01, X-03, X-04, X-08, X-09, X-11, ADR-4, Rule 12

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import {
  claimsFromVerifiedToken,
  unsafeDecodeClaimsForUi,
  canonicalizeClaims,
  parseAcrLevel,
  isVerifiedClaims,
  ClaimsVerificationError,
  type CanonicalClaims,
} from '../../../../shared/claims'
import {
  decide,
  createPdp,
  PERMISSIONS,
  STEP_UP,
  type Subject,
  type Resource,
  type DecisionAdapters,
} from '../../../../shared/authz'
import { requireRole } from '../../../../shared/rbac'
import {
  evaluatePatientVisibility,
  evaluateCohortSuppression,
  cryptoShredPatient,
  K_RETAILER_OUTPUT,
  K_CLINICAL_INTERNAL,
  PURPOSE_CATEGORY_MAP,
  type ConsentRecord,
} from '../../../../shared/consent'
import { LocalEd25519Signer } from '../../../../shared/signer'
import { LocalKeyWrapper } from '../../../../shared/key-wrapper'
import { encodeBase64Url } from '../../../../shared/crypto'

function base64UrlEncode(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return encodeBase64Url(bytes)
}

function makeJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: any,
): string {
  const hB64 = base64UrlEncode(JSON.stringify(header))
  const pB64 = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${hB64}.${pB64}`
  const sig = sign(null, Buffer.from(signingInput, 'utf8'), privateKey)
  const sB64 = base64UrlEncode(sig)
  return `${signingInput}.${sB64}`
}

describe('WP-05: Server Trust Boundary Fixes', () => {
  // ── 1. JWT Signature & Token Verification (X-01, ADR-4) ────────────────────
  describe('1. JWT Signature & Claim Verification (X-01)', () => {
    const keyPair = generateKeyPairSync('ed25519')
    const exportedJwk = keyPair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
    const jwk = {
      ...exportedJwk,
      kty: 'OKP',
      crv: 'Ed25519',
      kid: 'test-ed25519-key-1',
      use: 'sig',
      alg: 'EdDSA',
    }

    const validPayload = {
      sub: '11111111-1111-1111-1111-111111111111',
      sid: 'session-alpha-123',
      tenant_id: '22222222-2222-2222-2222-222222222222',
      app_role: 'writing_clinician',
      lic_ok: true,
      acr: 'loa2',
      iss: 'https://auth.nutriscore.test/realms/nutriscore',
      aud: 'cad-bff-service',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nbf: Math.floor(Date.now() / 1000) - 60,
      ver: 1,
    }

    it('verifies a valid EdDSA signed token and returns branded VerifiedClaims', async () => {
      const jwt = makeJwt({ alg: 'EdDSA', kid: 'test-ed25519-key-1' }, validPayload, keyPair.privateKey)
      const verified = await claimsFromVerifiedToken(jwt, jwk, {
        expectedIss: 'https://auth.nutriscore.test/realms/nutriscore',
        expectedAud: 'cad-bff-service',
      })

      expect(isVerifiedClaims(verified)).toBe(true)
      expect(verified.sub).toBe(validPayload.sub)
      expect(verified.sid).toBe(validPayload.sid)
      expect(verified.appRole).toBe('writing_clinician')
      expect(verified.acrLevel).toBe(2)
    })

    it('rejects a forged or tampered signature (fail-closed)', async () => {
      const otherKeyPair = generateKeyPairSync('ed25519')
      // Signed with other key but claims to be signed with jwk kid
      const forgedJwt = makeJwt({ alg: 'EdDSA', kid: 'test-ed25519-key-1' }, validPayload, otherKeyPair.privateKey)

      await expect(claimsFromVerifiedToken(forgedJwt, jwk)).rejects.toThrow(
        /Cryptographic signature verification failed/,
      )
    })

    it('rejects alg: "none" attacks without evaluating claims', async () => {
      const hB64 = base64UrlEncode(JSON.stringify({ alg: 'none' }))
      const pB64 = base64UrlEncode(JSON.stringify({ ...validPayload, app_role: 'super_admin' }))
      const noneJwt = `${hB64}.${pB64}.`

      await expect(claimsFromVerifiedToken(noneJwt, jwk)).rejects.toThrow(
        /algorithm "none" is prohibited/,
      )
    })

    it('rejects expired tokens (TOKEN_EXPIRED)', async () => {
      const expiredPayload = {
        ...validPayload,
        exp: Math.floor(Date.now() / 1000) - 100, // 100s in past
      }
      const jwt = makeJwt({ alg: 'EdDSA', kid: 'test-ed25519-key-1' }, expiredPayload, keyPair.privateKey)

      await expect(claimsFromVerifiedToken(jwt, jwk)).rejects.toThrow(/Token expired/)
    })

    it('rejects not-yet-valid tokens (TOKEN_NOT_YET_VALID)', async () => {
      const futurePayload = {
        ...validPayload,
        nbf: Math.floor(Date.now() / 1000) + 500, // 500s in future
      }
      const jwt = makeJwt({ alg: 'EdDSA', kid: 'test-ed25519-key-1' }, futurePayload, keyPair.privateKey)

      await expect(claimsFromVerifiedToken(jwt, jwk)).rejects.toThrow(/Token not valid before/)
    })

    it('rejects issuer mismatch (INVALID_ISSUER)', async () => {
      const jwt = makeJwt({ alg: 'EdDSA', kid: 'test-ed25519-key-1' }, validPayload, keyPair.privateKey)

      await expect(
        claimsFromVerifiedToken(jwt, jwk, { expectedIss: 'https://imposter.auth.test' }),
      ).rejects.toThrow(/Issuer mismatch/)
    })

    it('rejects audience mismatch (INVALID_AUDIENCE)', async () => {
      const jwt = makeJwt({ alg: 'EdDSA', kid: 'test-ed25519-key-1' }, validPayload, keyPair.privateKey)

      await expect(
        claimsFromVerifiedToken(jwt, jwk, { expectedAud: 'some-other-service' }),
      ).rejects.toThrow(/Audience mismatch/)
    })

    it('rejects unknown kid in JWKS', async () => {
      const jwt = makeJwt({ alg: 'EdDSA', kid: 'non-existent-kid' }, validPayload, keyPair.privateKey)

      await expect(claimsFromVerifiedToken(jwt, jwk)).rejects.toThrow(/not found in JWKS/)
    })

    it('unsafeDecodeClaimsForUi decodes cosmetically without branding as VerifiedClaims', () => {
      const jwt = makeJwt({ alg: 'EdDSA', kid: 'test-ed25519-key-1' }, validPayload, keyPair.privateKey)
      const claims = unsafeDecodeClaimsForUi(jwt)

      expect(claims).not.toBeNull()
      expect(claims?.sub).toBe(validPayload.sub)
      expect(isVerifiedClaims(claims)).toBe(false)
    })
  })

  // ── 2. PDP Policy Engine & Least Privilege Fixes (X-03, X-04) ──────────────
  describe('2. PDP Policy Engine & Least Privilege Fixes (X-03, X-04)', () => {
    const tenantA = '11111111-1111-1111-1111-111111111111'
    const validSubject: Subject = {
      sub: 'user-01',
      sid: 'sid-01',
      role: 'writing_clinician',
      tenantId: tenantA,
      licenceVerified: true,
      acr: 2,
    }

    const validAdapters: DecisionAdapters = {
      members: {
        status: () => 'active',
        licenceVerified: () => true,
      },
      denylist: {
        has: () => false,
      },
      relationships: {
        active: () => ({ canWrite: true }),
      },
    }

    it('createPdp throws if members adapter is missing (fail-closed at start-up)', () => {
      expect(() =>
        createPdp({ denylist: { has: () => false } } as any),
      ).toThrow(/members adapter is required/)
    })

    it('createPdp throws if denylist adapter is missing (fail-closed at start-up)', () => {
      expect(() =>
        createPdp({ members: { status: () => 'active', licenceVerified: () => true } } as any),
      ).toThrow(/denylist adapter is required/)
    })

    it('decide() throws if tenantId is missing for PHI resources (X-03b)', async () => {
      const badPhiResource: Resource = {
        type: 'clinical_records',
        class: 'PHI1',
        patientId: 'patient-1',
        // tenantId omitted!
      }

      await expect(decide(validSubject, 'read', badPhiResource, new Date(), validAdapters)).rejects.toThrow(
        /TENANT_REQUIRED: tenantId is mandatory for PHI resources/,
      )
    })

    it('enforces acrLevel enum mapping: "loa1" denies step-up, "loa2" allows step-up (X-03d)', async () => {
      const sensitiveResource: Resource = {
        type: 'target_bundles',
        class: 'PHI1',
        tenantId: tenantA,
        patientId: 'patient-1',
      }

      // loa1 subject (password only, acrLevel = 1 < 2)
      const loa1Subject: Subject = { ...validSubject, acr: 'loa1' }
      const dec1 = await decide(loa1Subject, 'create', sensitiveResource, new Date(), validAdapters)
      expect(dec1.allowed).toBe(false)
      expect(dec1.reason).toBe('STEP_UP_REQUIRED')

      // Non-numeric unrecognised acr string defaults to 0 and is denied
      const bogusSubject: Subject = { ...validSubject, acr: 'password' }
      const decBogus = await decide(bogusSubject, 'create', sensitiveResource, new Date(), validAdapters)
      expect(decBogus.allowed).toBe(false)
      expect(decBogus.reason).toBe('STEP_UP_REQUIRED')

      // loa2 subject (MFA verified, acrLevel = 2 >= 2)
      const loa2Subject: Subject = { ...validSubject, acr: 'loa2' }
      const dec2 = await decide(loa2Subject, 'create', sensitiveResource, new Date(), validAdapters)
      expect(dec2.allowed).toBe(true)
    })

    it('STEP_UP includes accounts:create, consent_register:update, clinical_records:update, tenants:* (X-03e)', () => {
      expect(STEP_UP.has('accounts:create')).toBe(true)
      expect(STEP_UP.has('consent_register:update')).toBe(true)
      expect(STEP_UP.has('clinical_records:update')).toBe(true)
      expect(STEP_UP.has('tenants:create')).toBe(true)
      expect(STEP_UP.has('tenants:read')).toBe(true)
      expect(STEP_UP.has('tenants:update')).toBe(true)
      expect(STEP_UP.has('tenants:delete')).toBe(true)
    })

    it('PERMISSIONS includes health_modes with least-privilege authoring (X-04)', () => {
      // tenant_admin can propose and read health_modes, but not approve
      expect(PERMISSIONS.tenant_admin.has('health_modes:propose')).toBe(true)
      expect(PERMISSIONS.tenant_admin.has('health_modes:read')).toBe(true)
      expect(PERMISSIONS.tenant_admin.has('health_modes:approve')).toBe(false)

      // writing_clinician can approve, update and read health_modes
      expect(PERMISSIONS.writing_clinician.has('health_modes:approve')).toBe(true)
      expect(PERMISSIONS.writing_clinician.has('health_modes:update')).toBe(true)
      expect(PERMISSIONS.writing_clinician.has('health_modes:read')).toBe(true)

      // viewing_dietician can only read
      expect(PERMISSIONS.viewing_dietician.has('health_modes:read')).toBe(true)
      expect(PERMISSIONS.viewing_dietician.has('health_modes:approve')).toBe(false)

      // super_admin has zero clinical writes and no health_modes write
      expect(PERMISSIONS.super_admin.has('health_modes:approve')).toBe(false)
      expect(PERMISSIONS.super_admin.has('health_modes:update')).toBe(false)
      expect(PERMISSIONS.super_admin.has('clinical_records:create')).toBe(false)
      expect(PERMISSIONS.super_admin.has('clinical_records:update')).toBe(false)
    })
  })

  // ── 3. Consent C1–C4 Mapping & Crypto-Shredding (X-08) ────────────────────
  describe('3. Consent Granularity & Cryptographic Shredding (X-08)', () => {
    it('maps consent purposes to C1-C4 statutory categories', () => {
      expect(PURPOSE_CATEGORY_MAP.clinician_link).toBe('C1')
      expect(PURPOSE_CATEGORY_MAP.purchase_timeline).toBe('C2')
      expect(PURPOSE_CATEGORY_MAP.diary).toBe('C3')
      expect(PURPOSE_CATEGORY_MAP.de_identified_aggregates).toBe('C4')
      expect(PURPOSE_CATEGORY_MAP.payer_analytics).toBe('C4')
    })

    it('evaluatePatientVisibility requires exact purpose match (clinician_link does not satisfy purchase_timeline)', () => {
      const clinicianLinkConsent: ConsentRecord = {
        id: 'c-01',
        tenantId: 't-1',
        patientRef: 'pat-01',
        purpose: 'clinician_link',
        status: 'active',
      }

      // clinician_link purpose does not allow purchase_timeline
      const accessTimeline = evaluatePatientVisibility(clinicianLinkConsent, 'purchase_timeline')
      expect(accessTimeline.allowed).toBe(false)
      expect(accessTimeline.reason).toContain("Consent granted for 'clinician_link', but required purpose is 'purchase_timeline'")

      // clinician_link purpose does allow clinician_link
      const accessLink = evaluatePatientVisibility(clinicianLinkConsent, 'clinician_link')
      expect(accessLink.allowed).toBe(true)
    })

    it('evaluateCohortSuppression defaults to k=20 for retailer/external outputs', () => {
      expect(K_RETAILER_OUTPUT).toBe(20)
      expect(K_CLINICAL_INTERNAL).toBe(5)

      // With default minK=20: 15 members is suppressed
      const checkRetailer = evaluateCohortSuppression(15)
      expect(checkRetailer.isSuppressed).toBe(true)
      expect(checkRetailer.displayCount).toBeNull()

      // 20 members passes
      const checkPass = evaluateCohortSuppression(20)
      expect(checkPass.isSuppressed).toBe(false)
      expect(checkPass.displayCount).toBe(20)
    })

    it('cryptoShredPatient generates irreversible HMAC pseudonym, zeroes DEK, and leaks zero patientRef characters', () => {
      const patientRef = 'PAT-CONFIDENTIAL-999'
      const dek = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])

      const result = cryptoShredPatient(patientRef, { dek, secret: 'TEST_SHRED_SECRET_1' })

      expect(result.anonymizedRef).toMatch(/^SHREDDED-[0-9a-f]{16}$/)
      expect(result.anonymizedRef).not.toContain('PAT-')
      expect(result.anonymizedRef).not.toContain('CONFIDENTIAL')
      expect(result.keyDestroyed).toBe(true)
      // Verify DEK buffer memory was zeroed in place
      expect(dek.every((byte) => byte === 0)).toBe(true)
    })
  })

  // ── 4. Stage A Crypto Production Guard (Rule 12, X-09) ─────────────────────
  describe('4. Stage A Crypto Production Guard (Rule 12, X-09)', () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = { ...originalEnv }
    })

    it('LocalEd25519Signer throws in production without explicit override', () => {
      process.env.NODE_ENV = 'production'
      delete process.env.ALLOW_STAGE_A_CRYPTO_IN_PROD
      delete process.env.ALLOW_STAGE_A_CRYPTO

      expect(() => new LocalEd25519Signer()).toThrow(
        /Stage A crypto provider \(LocalEd25519Signer\) is prohibited in production/,
      )
    })

    it('LocalKeyWrapper throws in production without explicit override', () => {
      process.env.NODE_ENV = 'production'
      delete process.env.ALLOW_STAGE_A_CRYPTO_IN_PROD
      delete process.env.ALLOW_STAGE_A_CRYPTO

      expect(() => new LocalKeyWrapper()).toThrow(
        /Stage A crypto provider \(LocalKeyWrapper\) is prohibited in production/,
      )
    })

    it('ALLOW_STAGE_A_CRYPTO_IN_PROD=true permits initialization in production', () => {
      process.env.NODE_ENV = 'production'
      process.env.ALLOW_STAGE_A_CRYPTO_IN_PROD = 'true'

      expect(() => new LocalEd25519Signer()).not.toThrow()
      expect(() => new LocalKeyWrapper()).not.toThrow()
    })
  })
})
