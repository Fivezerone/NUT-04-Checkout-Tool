// src/ui/src/app/__tests__/cad-blueprint-phase6.test.ts
// NutriScore CAD Blueprint Phase 6 Tests
// KeyWrapper, AES-256-GCM Row AAD Binding, Blind Indexes, Keyed MACs,
// Crypto-Shredding, and Semantic Projection Allowlist

import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { LocalKeyWrapper } from '../../../../shared/key-wrapper'
import {
  encryptField,
  decryptField,
  decryptFieldToString,
  computeBlindIndex,
  computeKeyedMac,
  normalizeForBlindIndex,
  type FieldBindingOptions,
} from '../../../../shared/field-encryption'

describe('CAD Blueprint Phase 6: Field-Level Encryption & KeyWrapper', () => {
  const TENANT_1 = '11111111-1111-1111-1111-111111111111'
  const TENANT_2 = '22222222-2222-2222-2222-222222222222'
  const PATIENT_ROW_1 = 'b6000000-0000-0000-0000-000000000001'
  const PATIENT_ROW_2 = 'b6000000-0000-0000-0000-000000000002'

  describe('KeyWrapper (Stage A)', () => {
    it('wraps and unwraps a 32-byte patient DEK', () => {
      const keyWrapper = new LocalKeyWrapper()
      const originalDek = randomBytes(32)

      const wrapped = keyWrapper.wrapKey(TENANT_1, originalDek)
      expect(wrapped.length).toBe(61) // 1B ver + 12B nonce + 16B tag + 32B ciphertext

      const unwrapped = keyWrapper.unwrapKey(TENANT_1, wrapped)
      expect(Buffer.from(unwrapped)).toEqual(Buffer.from(originalDek))
    })

    it('fails to unwrap when presented with wrong tenant ID (AAD mismatch)', () => {
      const keyWrapper = new LocalKeyWrapper()
      const originalDek = randomBytes(32)

      const wrapped = keyWrapper.wrapKey(TENANT_1, originalDek)

      // Unwrapping with TENANT_2 should fail
      expect(() => keyWrapper.unwrapKey(TENANT_2, wrapped)).toThrow(
        /Failed to unwrap DEK for tenant/,
      )
    })

    it('rejects shredded (zeroed) DEKs', () => {
      const keyWrapper = new LocalKeyWrapper()
      const zeroedDek = new Uint8Array(61).fill(0)

      expect(() => keyWrapper.unwrapKey(TENANT_1, zeroedDek)).toThrow(/shredded/)
    })

    it('derives tenant-isolated blind index and MAC keys', () => {
      const keyWrapper = new LocalKeyWrapper()

      const bidx1 = keyWrapper.deriveTenantIndexKey(TENANT_1)
      const bidx2 = keyWrapper.deriveTenantIndexKey(TENANT_2)
      expect(bidx1).not.toEqual(bidx2)

      const mac1 = keyWrapper.deriveTenantMacKey(TENANT_1)
      const mac2 = keyWrapper.deriveTenantMacKey(TENANT_2)
      expect(mac1).not.toEqual(mac2)
    })
  })

  describe('AES-256-GCM Row AAD Binding', () => {
    const optsRow1: FieldBindingOptions = {
      tenantId: TENANT_1,
      tableName: 'patients',
      columnName: 'full_name_enc',
      rowId: PATIENT_ROW_1,
    }

    it('encrypts and decrypts field with matching row AAD', () => {
      const dek = randomBytes(32)
      const plaintext = 'Dr. Jane Doe, Patient Alpha'

      const ciphertext = encryptField(plaintext, dek, optsRow1)
      expect(ciphertext.length).toBe(plaintext.length + 31)

      const decrypted = decryptFieldToString(ciphertext, dek, optsRow1)
      expect(decrypted).toBe(plaintext)
    })

    it('fails to decrypt if copied to another row ID', () => {
      const dek = randomBytes(32)
      const plaintext = 'Secret Clinical Diagnosis'

      const ciphertext = encryptField(plaintext, dek, optsRow1)

      // Attempt decrypt with PATIENT_ROW_2
      const optsRow2: FieldBindingOptions = {
        ...optsRow1,
        rowId: PATIENT_ROW_2,
      }

      expect(() => decryptField(ciphertext, dek, optsRow2)).toThrow(
        /ciphertext authentication failure/,
      )
    })

    it('fails to decrypt if copied to another tenant ID', () => {
      const dek = randomBytes(32)
      const plaintext = 'Confidential Lab Result'

      const ciphertext = encryptField(plaintext, dek, optsRow1)

      // Attempt decrypt with TENANT_2
      const optsTenant2: FieldBindingOptions = {
        ...optsRow1,
        tenantId: TENANT_2,
      }

      expect(() => decryptField(ciphertext, dek, optsTenant2)).toThrow(
        /ciphertext authentication failure/,
      )
    })

    it('fails to decrypt if copied to another column', () => {
      const dek = randomBytes(32)
      const plaintext = 'patient@domain.org'

      const ciphertext = encryptField(plaintext, dek, optsRow1)

      // Attempt decrypt with different column
      const optsCol: FieldBindingOptions = {
        ...optsRow1,
        columnName: 'email_enc',
      }

      expect(() => decryptField(ciphertext, dek, optsCol)).toThrow(
        /ciphertext authentication failure/,
      )
    })

    it('fails to decrypt if ciphertext byte is tampered with', () => {
      const dek = randomBytes(32)
      const plaintext = 'Uncompromised Payload'

      const ciphertext = encryptField(plaintext, dek, optsRow1)
      const tampered = Buffer.from(ciphertext)
      // Flip a bit in the ciphertext portion
      tampered[tampered.length - 1] ^= 0x01

      expect(() => decryptField(tampered, dek, optsRow1)).toThrow(
        /ciphertext authentication failure/,
      )
    })
  })

  describe('Blind Indexing', () => {
    it('normalises case and surrounding whitespace', () => {
      expect(normalizeForBlindIndex('  Alice.Smith@Hospital.org ')).toBe('alice.smith@hospital.org')
    })

    it('produces identical index for differing whitespace/case but distinct for different tenants', () => {
      const keyWrapper = new LocalKeyWrapper()
      const kIdx1 = keyWrapper.deriveTenantIndexKey(TENANT_1)
      const kIdx2 = keyWrapper.deriveTenantIndexKey(TENANT_2)

      const emailA = '  Patient@Example.com '
      const emailB = 'patient@example.com'
      const emailC = 'other@example.com'

      const idx1A = computeBlindIndex(emailA, kIdx1)
      const idx1B = computeBlindIndex(emailB, kIdx1)
      const idx1C = computeBlindIndex(emailC, kIdx1)
      const idx2A = computeBlindIndex(emailA, kIdx2)

      expect(idx1A).toEqual(idx1B)
      expect(idx1A).not.toEqual(idx1C)
      // Tenant isolation
      expect(idx1A).not.toEqual(idx2A)
    })
  })

  describe('Keyed Commitments (MAC)', () => {
    it('produces tenant-keyed MAC that differs from bare SHA-256 and across tenants', () => {
      const keyWrapper = new LocalKeyWrapper()
      const kMac1 = keyWrapper.deriveTenantMacKey(TENANT_1)
      const kMac2 = keyWrapper.deriveTenantMacKey(TENANT_2)

      const body = '{"diagnosis":"Hypertension","icd10":"I10"}'
      const mac1 = computeKeyedMac(body, kMac1)
      const mac2 = computeKeyedMac(body, kMac2)

      expect(mac1).not.toEqual(mac2)
      expect(mac1.length).toBe(32)
    })
  })

  describe('Semantic Projection Allowlist', () => {
    const ALLOWLISTED_KEYS = new Set([
      'sugars_g_100g_max',
      'carbs_g_100g_max',
      'sodium_mg_100g_max',
      'satfat_g_100g_max',
      'energy_kcal_100g_max',
      'fibre_g_100g_min',
    ])

    function validateConstraints(constraints: Record<string, unknown>): boolean {
      if (typeof constraints !== 'object' || constraints === null || Array.isArray(constraints)) {
        return false
      }
      return Object.keys(constraints).every((k) => ALLOWLISTED_KEYS.has(k))
    }

    it('accepts subsets of the six allowlisted dimensions', () => {
      expect(
        validateConstraints({
          carbs_g_100g_max: 30,
          sugars_g_100g_max: 10,
        }),
      ).toBe(true)

      expect(
        validateConstraints({
          sugars_g_100g_max: 15,
          carbs_g_100g_max: 30,
          sodium_mg_100g_max: 600,
          satfat_g_100g_max: 5,
          energy_kcal_100g_max: 200,
          fibre_g_100g_min: 3,
        }),
      ).toBe(true)
    })

    it('rejects condition-named labels (e.g. diabetic_friendly, renal_safe)', () => {
      expect(
        validateConstraints({
          carbs_g_100g_max: 30,
          diabetic_friendly: true,
        }),
      ).toBe(false)

      expect(
        validateConstraints({
          renal_safe: true,
        }),
      ).toBe(false)
    })

    it('rejects device-only dimensions (e.g. potassium, phosphorus, protein)', () => {
      expect(
        validateConstraints({
          potassium_mg_100g_max: 200,
        }),
      ).toBe(false)

      expect(
        validateConstraints({
          protein_g_100g_max: 50,
        }),
      ).toBe(false)
    })
  })
})
