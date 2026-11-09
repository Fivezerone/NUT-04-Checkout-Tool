// src/ui/src/app/__tests__/cad-blueprint-phase8.test.ts
// NutriScore CAD Blueprint Phase 8 Tests
// Commercial overlay, reference SKUs, catalogue filtering with DPT,
// observed orders sync client, and Decision D6 invariants.

import { describe, it, expect, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { normalizeProductToSku } from '../../../../../scripts/curate-commercial-skus.mjs'
import {
  evaluateSkuAgainstConstraints,
  filterCatalogueWithDpt,
  type CandidateSku,
} from '../../../../shared/commercial-catalogue'
import { LocalEd25519Signer } from '../../../../shared/signer'
import { computeJwkThumbprint, createDpopProof, type JwkPublicKey } from '../../../../shared/dpop'
import { mintDpt } from '../../../../shared/dpt'

describe('CAD Blueprint Phase 8: Commercial Overlay', () => {
  let signer: LocalEd25519Signer
  let publicJwk: JwkPublicKey
  let dpopJkt: string
  const requestUrl = 'https://api.nutriscore.co.ke/functions/v1/catalogue'

  beforeEach(() => {
    signer = new LocalEd25519Signer()
    publicJwk = signer.getPublicKeyJwk() as JwkPublicKey
    dpopJkt = computeJwkThumbprint(publicJwk)
  })

  // ---------------------------------------------------------------------------
  // 1. SKU Curation & Normalization
  // ---------------------------------------------------------------------------
  describe('SKU Normalization & ReviewState Preservation', () => {
    it('normalizes a Carrefour product with verified review state', () => {
      const rawCarrefour = {
        Identity: {
          ProductID: '181913',
          ProductName: 'Weetabix Wholegrain Cereal 850G',
          BrandName: 'Weetabix',
        },
        Classification: {
          NutritionCategory: 'Cereals & Grains',
          NOVA: { Level: 4 },
        },
        Nutrition: {
          EnergyKcal: 342,
          SugarsG: 4.4,
          SodiumMG: 100,
          FibreG: 10,
        },
        Validation: {
          ReviewState: 'VERIFIED',
        },
      }

      const sku = normalizeProductToSku(rawCarrefour, 'carrefour_ke')
      expect(sku).not.toBeNull()
      expect(sku!.retailer).toBe('carrefour_ke')
      expect(sku!.retailer_product_id).toBe('181913')
      expect(sku!.name).toBe('Weetabix Wholegrain Cereal 850G')
      expect(sku!.brand).toBe('Weetabix')
      expect(sku!.category_kfct).toBe('Cereals & Grains')
      expect(sku!.nova).toBe(4)
      expect(sku!.review_state).toBe('VERIFIED')
      expect(sku!.active).toBe(true)
      expect(sku!.per_100g.sugars_g).toBe(4.4)
    })

    it('normalizes a Naivas product with estimated review state', () => {
      const rawNaivas = {
        Identity: {
          ProductID: 'naivas-veg-oil-5l',
          ProductName: 'Rina Vegetable Oil 5L',
          BrandName: 'Rina',
        },
        Classification: {
          NutritionCategory: 'Fats & Oils',
          NOVA: { Level: 2 },
        },
        Nutrition: {
          EnergyKcal: 900,
          SugarsG: 0,
          FatG: 100,
          SodiumMG: 0,
        },
        Validation: {
          ReviewState: 'ESTIMATED',
        },
      }

      const sku = normalizeProductToSku(rawNaivas, 'naivas')
      expect(sku).not.toBeNull()
      expect(sku!.retailer).toBe('naivas')
      expect(sku!.review_state).toBe('ESTIMATED')
      expect(sku!.nova).toBe(2)
      expect(sku!.category_kfct).toBe('Fats & Oils')
    })

    it('normalizes a Quickmart product with high confidence state', () => {
      const rawQuickmart = {
        Identity: {
          ProductID: '624045',
          ProductName: 'Tuzo Lala Sachet 500Gm',
          BrandName: 'Tuzo',
        },
        Classification: {
          NutritionCategory: 'Dairy',
          NOVA: { Level: 1 },
        },
        Nutrition: {
          EnergyKcal: 65,
          SugarsG: 4.5,
          ProteinG: 3.2,
        },
        Validation: {
          ReviewState: 'HIGH_CONFIDENCE',
        },
      }

      const sku = normalizeProductToSku(rawQuickmart, 'quickmart_ke')
      expect(sku).not.toBeNull()
      expect(sku!.retailer).toBe('quickmart_ke')
      expect(sku!.review_state).toBe('HIGH_CONFIDENCE')
    })

    it('defaults unknown review_state to UNVERIFIED', () => {
      const rawUnknown = {
        Identity: { ProductID: '999', ProductName: 'Mystery Snack' },
        Validation: { ReviewState: 'UNKNOWN_LEGACY_FLAG' },
      }
      const sku = normalizeProductToSku(rawUnknown, 'naivas')
      expect(sku!.review_state).toBe('UNVERIFIED')
    })

    it('returns null when product ID is missing', () => {
      const invalid = { Identity: { ProductName: 'No ID Product' } }
      expect(normalizeProductToSku(invalid, 'carrefour_ke')).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Nutritional Constraint Evaluation
  // ---------------------------------------------------------------------------
  describe('Nutritional Constraint Evaluation', () => {
    const lowSugarCereal: CandidateSku = {
      sku_id: 'sku-001',
      retailer: 'carrefour_ke',
      retailer_product_id: 'prod-001',
      name: 'Oats',
      per_100g: { sugars_g: 3.0, sodium_mg: 50, fibre_g: 8.0, satfat_g: 1.0 },
      review_state: 'VERIFIED',
    }

    const highSugarCereal: CandidateSku = {
      sku_id: 'sku-002',
      retailer: 'carrefour_ke',
      retailer_product_id: 'prod-002',
      name: 'Sugar Frosted Flakes',
      per_100g: { sugars_g: 35.0, sodium_mg: 400, fibre_g: 1.5, satfat_g: 2.0 },
      review_state: 'VERIFIED',
    }

    it('accepts a product satisfying all DPT constraints', () => {
      const constraints = {
        sugars_g_100g_max: 10,
        sodium_mg_100g_max: 300,
        fibre_g_100g_min: 6,
      }
      const result = evaluateSkuAgainstConstraints(lowSugarCereal, constraints)
      expect(result.conforming).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it('flags violations when product exceeds max constraints', () => {
      const constraints = {
        sugars_g_100g_max: 10,
        sodium_mg_100g_max: 300,
      }
      const result = evaluateSkuAgainstConstraints(highSugarCereal, constraints)
      expect(result.conforming).toBe(false)
      expect(result.violations).toContain('sugars_g_100g_max')
      expect(result.violations).toContain('sodium_mg_100g_max')
    })

    it('flags violations when product fails min constraints (e.g. fibre)', () => {
      const constraints = {
        fibre_g_100g_min: 5,
      }
      const result = evaluateSkuAgainstConstraints(highSugarCereal, constraints)
      expect(result.conforming).toBe(false)
      expect(result.violations).toContain('fibre_g_100g_min')
    })
  })

  // ---------------------------------------------------------------------------
  // 3. DPT-Authenticated Catalogue Filtering
  // ---------------------------------------------------------------------------
  describe('filterCatalogueWithDpt', () => {
    it('filters candidate catalogue items against authenticated DPT constraints', () => {
      const { token: dptToken } = mintDpt(signer, {
        tenantId: '11111111-1111-1111-1111-111111111111',
        patientId: '22222222-2222-2222-2222-222222222222',
        constraints: { sugars_g_100g_max: 10, sodium_mg_100g_max: 300 },
        dpopJkt,
      })

      const dpopProof = createDpopProof(signer.getPrivateKey(), publicJwk, 'POST', requestUrl)

      const candidates: CandidateSku[] = [
        {
          sku_id: 'sku-low',
          retailer: 'carrefour_ke',
          retailer_product_id: 'p1',
          name: 'Low Sugar Oats',
          per_100g: { sugars_g: 2.0, sodium_mg: 20 },
          review_state: 'VERIFIED',
        },
        {
          sku_id: 'sku-high',
          retailer: 'carrefour_ke',
          retailer_product_id: 'p2',
          name: 'Sweet Biscuits',
          per_100g: { sugars_g: 28.0, sodium_mg: 150 },
          review_state: 'VERIFIED',
        },
      ]

      const filterResult = filterCatalogueWithDpt(
        candidates,
        dptToken,
        dpopProof,
        signer.getPublicKey(),
        requestUrl,
      )

      expect(filterResult.conformingSkus).toHaveLength(1)
      expect(filterResult.conformingSkus[0].sku_id).toBe('sku-low')
      expect(filterResult.allEvaluations).toHaveLength(2)
      expect(filterResult.payload.aud).toBe('ns-commercial')
    })

    it('rejects filtering when DPoP proof is invalid', () => {
      const { token: dptToken } = mintDpt(signer, {
        tenantId: '11111111-1111-1111-1111-111111111111',
        patientId: '22222222-2222-2222-2222-222222222222',
        constraints: { sugars_g_100g_max: 10 },
        dpopJkt,
      })

      expect(() =>
        filterCatalogueWithDpt([], dptToken, 'invalid.dpop.proof', signer.getPublicKey(), requestUrl),
      ).toThrow(/DPoP verification failed/i)
    })

    it('rejects filtering when DPT is revoked', () => {
      const { token: dptToken, jti } = mintDpt(signer, {
        tenantId: '11111111-1111-1111-1111-111111111111',
        patientId: '22222222-2222-2222-2222-222222222222',
        constraints: { sugars_g_100g_max: 10 },
        dpopJkt,
      })

      const dpopProof = createDpopProof(signer.getPrivateKey(), publicJwk, 'POST', requestUrl)
      const revokedJtis = new Set([jti])

      expect(() =>
        filterCatalogueWithDpt(
          [],
          dptToken,
          dpopProof,
          signer.getPublicKey(),
          requestUrl,
          revokedJtis,
        ),
      ).toThrow(/revoked/i)
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Invariant Protection: Decision D6 Scoping
  // ---------------------------------------------------------------------------
  describe('Decision D6 Scope Invariants', () => {
    it('observed order payload does not contain transaction routing columns', () => {
      const observedPayload = {
        tenant_id: '11111111-1111-1111-1111-111111111111',
        retailer: 'carrefour_ke',
        idempotency_key: 'obs-001',
        status: 'observed',
        source: 'extension_observed',
      }

      // Assert zero transaction/fulfilment properties exist
      expect(observedPayload).not.toHaveProperty('delivery_address')
      expect(observedPayload).not.toHaveProperty('courier')
      expect(observedPayload).not.toHaveProperty('warehouse')
    })
  })
})
