#!/usr/bin/env node
/**
 * scripts/verify-selector-canary.mjs
 *
 * Synthetic Retailer Selector Health Canary Runner.
 * References: Blueprint §3.4 (N4), §3.8 (N8, G-08).
 *
 * Responsibilities:
 *   1. Evaluates selector stability against simulated retailer page samples (search, category, product, cart).
 *   2. Verifies tile count parity, title/price/link extraction completeness, and price plausibility.
 *   3. Calculates selector failure ratio per retailer.
 *   4. Enforces the Blueprint §3.4 set point: failure rate <= 2% per retailer.
 *   5. Triggers automatic killSwitch recommendation and alert when threshold is breached.
 */

import { RetailerAdapter } from '../src/extension/adapters/adapter-core.js'
import quickmartSpec from '../src/extension/adapters/specs/quickmart.json' with { type: 'json' }
import naivasSpec from '../src/extension/adapters/specs/naivas.json' with { type: 'json' }
import carrefourSpec from '../src/extension/adapters/specs/carrefour.json' with { type: 'json' }

export const RETAILER_SPECS = Object.freeze({
  quickmart: quickmartSpec,
  naivas: naivasSpec,
  carrefour: carrefourSpec,
})

export const FAILURE_THRESHOLD = 0.02 // 2% (§3.4)

/**
 * Lightweight synthetic DOM element builder for selector verification in pure Node.
 */
export function createSyntheticCard({
  retailer,
  index,
  missingTitle = false,
  missingPrice = false,
  corruptPrice = false,
  missingLink = false,
}) {
  const cardId = `${retailer}-${index}`
  const title = missingTitle ? '' : `Fresh Dairy Milk 500ml #${index}`
  let priceText = `Ksh ${(index * 50 + 20).toFixed(2)}`
  if (missingPrice) priceText = ''
  if (corruptPrice) priceText = 'Out of Stock / Invalid Price'

  const attrs = { 'data-id': cardId, 'data-product-id': cardId }
  const children = []

  if (!missingTitle) {
    children.push({
      tagName: 'H3',
      className: 'product-title product-name',
      textContent: title,
      getAttribute: () => null,
    })
  }
  if (!missingPrice && !corruptPrice) {
    children.push({
      tagName: 'SPAN',
      className: 'price product-price',
      textContent: priceText,
      getAttribute: (k) => (k === 'data-testid' ? 'product-price' : null),
    })
  } else if (corruptPrice) {
    children.push({
      tagName: 'SPAN',
      className: 'price product-price',
      textContent: priceText,
      getAttribute: (k) => (k === 'data-testid' ? 'product-price' : null),
    })
  }
  if (!missingLink) {
    children.push({
      tagName: 'A',
      className: 'product-link',
      textContent: 'View',
      getAttribute: (k) => (k === 'href' ? `/products/view/${index}` : null),
    })
  }

  function matches(el, sel) {
    const s = sel.trim()
    if (s.startsWith('.')) return (el.className || '').split(/\s+/).includes(s.slice(1))
    if (s.startsWith('[') && s.endsWith(']')) {
      const inside = s.slice(1, -1)
      if (inside.includes('*=')) {
        const [k, vRaw] = inside.split('*=')
        const attrVal = k === 'class' ? el.className : el.getAttribute(k)
        const v = vRaw.replace(/['"]/g, '')
        return (attrVal || '').includes(v)
      }
      if (inside.includes('=')) {
        const [k, vRaw] = inside.split('=')
        const attrVal = k === 'class' ? el.className : el.getAttribute(k)
        const v = vRaw.replace(/['"]/g, '')
        return attrVal === v
      }
      return el.getAttribute(inside) !== null
    }
    if (s.toLowerCase() === 'a[href]') return el.tagName === 'A' && el.getAttribute('href') !== null
    return el.tagName?.toLowerCase() === s.toLowerCase()
  }

  return {
    tagName: 'DIV',
    className: 'product-card',
    children,
    getAttribute: (k) => attrs[k] ?? null,
    querySelector: (sel) => {
      const parts = sel.split(',').map((p) => p.trim())
      for (const p of parts) {
        for (const c of children) {
          if (matches(c, p)) return c
        }
      }
      return null
    },
    querySelectorAll: (sel) => {
      const parts = sel.split(',').map((p) => p.trim())
      const res = []
      for (const p of parts) {
        for (const c of children) {
          if (matches(c, p) && !res.includes(c)) res.push(c)
        }
      }
      return res
    },
  }
}

/**
 * Runs selector canary verification across supported retailers.
 *
 * @param {object} [options]
 * @param {number} [options.cardsPerRetailer=50]
 * @param {Record<string, number>} [options.simulatedErrors] retailer -> count of corrupt cards to simulate
 * @returns {object} canary test summary
 */
export function runSelectorCanary(options = {}) {
  const cardsCount = options.cardsPerRetailer || 50
  const simulatedErrors = options.simulatedErrors || {}
  const results = {}

  let totalBreaches = 0

  for (const [retailer, spec] of Object.entries(RETAILER_SPECS)) {
    const adapter = new RetailerAdapter(spec)
    const cards = []
    const errorCount = simulatedErrors[retailer] || 0

    for (let i = 1; i <= cardsCount; i++) {
      const isCorrupt = i <= errorCount
      cards.push(
        createSyntheticCard({
          retailer,
          index: i,
          missingTitle: isCorrupt,
          corruptPrice: isCorrupt,
        }),
      )
    }

    const container = {
      querySelectorAll: (sel) => {
        if (spec.card && spec.card.includes(sel)) return cards
        return []
      },
    }

    const observations = adapter.observeProducts(container)
    const validObservations = observations.filter(
      (o) => o.name && typeof o.price === 'number' && o.price > 0,
    )

    const expectedCount = cardsCount
    const failureCount = expectedCount - validObservations.length
    const failureRate = failureCount / expectedCount
    const breached = failureRate > FAILURE_THRESHOLD

    if (breached) {
      totalBreaches += 1
    }

    results[retailer] = {
      expected: expectedCount,
      extracted: observations.length,
      valid: validObservations.length,
      failed: failureCount,
      failureRate,
      threshold: FAILURE_THRESHOLD,
      breached,
      killSwitchRecommended: breached,
    }
  }

  return {
    timestamp: new Date().toISOString(),
    healthy: totalBreaches === 0,
    breachesCount: totalBreaches,
    retailers: results,
  }
}

// CLI Execution entrypoint
const isMain = process.argv[1] && process.argv[1].endsWith('verify-selector-canary.mjs')
if (isMain) {
  const report = runSelectorCanary()
  console.log('[Canary] Retailer Selector Verification Report:')
  console.log(JSON.stringify(report, null, 2))
  if (!report.healthy) {
    console.error(`[Canary ALERT] Selector health breach detected!`)
    process.exit(1)
  } else {
    console.log(`[Canary OK] All retailer selectors healthy (failure rate <= 2%).`)
    process.exit(0)
  }
}
