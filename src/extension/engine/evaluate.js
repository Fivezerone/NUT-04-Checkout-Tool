/**
 * @license SPDX-License-Identifier: Apache-2.0
 * src/extension/engine/evaluate.js — Unified Evaluation Entry Point.
 * Reference: Blueprint §2.1 (E-01..E-07, ADR-8, ADR-10)
 *
 * Responsibilities:
 *   - Unified product evaluation combining kernel, FSA-NPS 2023, and policy engine.
 *   - Deterministic 5-state evaluation state machine:
 *       NOT_ATTEMPTED -> UNRESOLVED -> INSUFFICIENT_DATA -> COMPUTED_PROVISIONAL -> COMPUTED_CONFIRMED
 *   - LRU cache (512 entries) in SW memory for sub-millisecond repeated evaluation.
 *   - Zero-throw guarantee: catches any internal exception, increments 'eval_error', returns NOT_ATTEMPTED.
 *   - Pure function, zero I/O.
 */

;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const kernel = require('./kernel.js')
    const fsaNps = require('./fsa-nps.js')
    const policy = require('./policy.js')
    module.exports = factory(kernel, fsaNps, policy)
  } else {
    const kernel = root.NutriKernel || (typeof self !== 'undefined' && self.NutriKernel)
    const fsaNps = root.NutriFsaNps || (typeof self !== 'undefined' && self.NutriFsaNps)
    const policy = root.NutriPolicy || (typeof self !== 'undefined' && self.NutriPolicy)
    const exports = factory(kernel, fsaNps, policy)
    root.NutriEvaluate = exports
    if (typeof self !== 'undefined') self.NutriEvaluate = exports
    if (typeof window !== 'undefined') window.NutriEvaluate = exports
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (kernelMod, fsaNpsMod, policyMod) {
    'use strict'

    // Simple Map-based bounded LRU cache (512 entries per Blueprint §2.1)
    const CACHE_CAPACITY = 512
    const lruCache = new Map()

    function getCached(key) {
      if (!lruCache.has(key)) return undefined
      const value = lruCache.get(key)
      lruCache.delete(key)
      lruCache.set(key, value)
      return value
    }

    function setCached(key, value) {
      if (lruCache.has(key)) {
        lruCache.delete(key)
      } else if (lruCache.size >= CACHE_CAPACITY) {
        // Evict oldest (first key in iteration)
        const oldestKey = lruCache.keys().next().value
        lruCache.delete(oldestKey)
      }
      lruCache.set(key, value)
    }

    function clearCache() {
      lruCache.clear()
    }

    function resolveTier(record) {
      const state = record?.Validation?.ReviewState || record?.review_state || ''
      const upper = String(state).trim().toUpperCase()
      switch (upper) {
        case 'HIGH_CONFIDENCE':
          return 'high_confidence'
        case 'VERIFIED':
          return 'confirmed'
        case 'ESTIMATED':
          return 'estimated'
        case 'UNVERIFIED':
        case 'REJECTED':
        default:
          return 'not_rated'
      }
    }

    function resolveDisplayCategory(record) {
      if (!record || !record.Classification) return 'Uncategorized'
      const { NutritionCategory, CanonicalFoodClass, FSACategoryCode } = record.Classification
      if (NutritionCategory && NutritionCategory !== 'Uncategorized') return NutritionCategory
      if (CanonicalFoodClass && CanonicalFoodClass !== 'Uncategorized') return CanonicalFoodClass
      if (FSACategoryCode) return FSACategoryCode
      return 'Uncategorized'
    }

    /**
     * Evaluates a single product record against an optional clinical policy.
     *
     * @param {Object} record - Catalog product record
     * @param {Object|null} [policy] - Dietary Profile Token policy
     * @param {Object} [options] - Additional parameters e.g. { catalogueVersion, bypassCache }
     * @returns {Object} ItemEvaluation
     */
    function evaluateItem(record, policy = null, options = {}) {
      try {
        const kernel =
          kernelMod ||
          (typeof globalThis !== 'undefined' && globalThis.NutriKernel) ||
          (typeof self !== 'undefined' && self.NutriKernel)
        const fsaNps =
          fsaNpsMod ||
          (typeof globalThis !== 'undefined' && globalThis.NutriFsaNps) ||
          (typeof self !== 'undefined' && self.NutriFsaNps)
        const policyEngine =
          policyMod ||
          (typeof globalThis !== 'undefined' && globalThis.NutriPolicy) ||
          (typeof self !== 'undefined' && self.NutriPolicy)

        if (!kernel || !fsaNps || !policyEngine) {
          throw new Error('[evaluate] Scoring engine submodules not loaded')
        }

        const catVersion = options.catalogueVersion || 'catalog-v1'
        const profileVer = policy ? policy.profileVer ?? 1 : null
        const productId =
          record?.Identity?.ProductID ||
          record?.productId ||
          record?.GroceryProductID ||
          record?.sku ||
          null

        // Cache lookup
        if (productId && !options.bypassCache) {
          const cacheKey = `${productId}:${catVersion}:v5:${profileVer ?? 'none'}`
          const cached = getCached(cacheKey)
          if (cached) return cached
        }

        const versions = {
          scoring: 'v5',
          algorithm: 'fsa-nps-2023',
          catalogue: catVersion,
          profile: profileVer,
        }

        // 1. State: NOT_ATTEMPTED
        if (!record || (!record.Nutrition && !record.per_100g && !record.NutritionInformation)) {
          return {
            status: 'NOT_ATTEMPTED',
            grade: null,
            score: null,
            facts: [],
            missing: ['energy', 'sugars', 'saturated_fat', 'sodium_or_salt'],
            assumptions: [],
            tier: 'not_rated',
            decision: policyEngine.NONE_DECISION,
            versions,
          }
        }

        // 2. Canonicalise & Gate
        const vec = kernel.canonicalise(record)
        const gate = kernel.gate(record, vec)
        const tier = resolveTier(record)
        const fsaCat =
          record.Classification?.FSACategoryCode ||
          record.Classification?.NutritionCategory ||
          'GENERAL_FOOD'

        // 3. State: INSUFFICIENT_DATA
        if (!gate.g2 || tier === 'not_rated') {
          const evalResult = {
            status: 'INSUFFICIENT_DATA',
            grade: null,
            score: null,
            facts: gate.plausibleFields,
            missing: gate.missing,
            assumptions: [],
            tier,
            decision: policyEngine.NONE_DECISION,
            versions,
          }
          if (productId && !options.bypassCache) {
            const cacheKey = `${productId}:${catVersion}:v5:${profileVer ?? 'none'}`
            setCached(cacheKey, evalResult)
          }
          return evalResult
        }

        // 4. Compute FSA-NPS 2023 Score
        const scoreResult = fsaNps.fsaNps2023(vec, fsaCat, {
          isWater: fsaCat === 'BEVERAGE' && record.Classification?.NutritionCategory === 'Water',
        })

        // 5. State: COMPUTED_PROVISIONAL vs COMPUTED_CONFIRMED
        const status = tier === 'estimated' ? 'COMPUTED_PROVISIONAL' : 'COMPUTED_CONFIRMED'

        // 6. Evaluate Policy
        let decision = policyEngine.NONE_DECISION
        if (policy) {
          decision = policyEngine.evaluatePolicy(vec, gate, tier, policy)
        }

        const evalResult = {
          status,
          grade: scoreResult.grade,
          score: scoreResult.score,
          facts: gate.plausibleFields,
          missing: [],
          assumptions: scoreResult.assumptions,
          tier,
          decision,
          versions,
        }

        if (productId && !options.bypassCache) {
          const cacheKey = `${productId}:${catVersion}:v5:${profileVer ?? 'none'}`
          setCached(cacheKey, evalResult)
        }

        return evalResult
      } catch (err) {
        // Zero-throw guarantee: log error counter and fail neutral
        try {
          if (
            typeof self !== 'undefined' &&
            self.NutriObs &&
            typeof self.NutriObs.count === 'function'
          ) {
            self.NutriObs.count('eval_error', 1)
          } else if (
            typeof globalThis !== 'undefined' &&
            globalThis.NutriObs &&
            typeof globalThis.NutriObs.count === 'function'
          ) {
            globalThis.NutriObs.count('eval_error', 1)
          }
        } catch (_ignored) {
          console.debug('[Evaluate] Telemetry count error:', _ignored)
        }

        return {
          status: 'NOT_ATTEMPTED',
          grade: null,
          score: null,
          facts: [],
          missing: [],
          assumptions: [],
          tier: 'not_rated',
          decision: {
            action: 'none',
            reason_class: null,
            triggers: [],
            min_conf_ok: false,
          },
          error_code: err && err.message ? String(err.message) : 'UNKNOWN_ERROR',
          versions: {
            scoring: 'v5',
            algorithm: 'fsa-nps-2023',
            catalogue: options.catalogueVersion || 'catalog-v1',
            profile: null,
          },
        }
      }
    }

    return {
      evaluateItem,
      resolveTier,
      resolveDisplayCategory,
      clearCache,
    }
  },
)
