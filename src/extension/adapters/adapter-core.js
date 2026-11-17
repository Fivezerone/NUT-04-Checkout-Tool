/**
 * src/extension/adapters/adapter-core.js
 *
 * Core Declarative Retailer Adapter Engine (Blueprint §2.5, A-08, A-09, G-08)
 *
 * Invariants & Directives:
 * 1. Unified RetailerAdapter contract with pure DOM observation and zero network/storage dependencies.
 * 2. URL routing matches parsed URL (hostname suffix + path allowlist/exclusion), fixing A-09 string-match flaws.
 * 3. Safe regex compilation (A-09): max 200 chars, checks against nested quantifiers / ReDoS, try/catch fail-soft.
 * 4. Multi-tier field extraction with provenance tracking:
 *    Tier 1: JSON-LD and Microdata
 *    Tier 2: data-* attributes
 *    Tier 3: visible text (ranked CSS selectors)
 * 5. Page values are untrusted: price_quarantined flag when pagePrice > 5 * catalogPrice (Directive 5).
 * 6. Kill-switch & feature flag support (ns.adapter.core.<retailer>).
 */

const MAX_REGEX_LENGTH = 200

// Safe-regex pattern check: disallow nested quantifiers like (a+)+, (.*)*, (x+)*
const DANGEROUS_NESTED_QUANTIFIERS = /\([^)]*(\+|\*|\{[0-9]+,?[0-9]*\})[^)]*\)(\+|\*|\{[0-9]+,?[0-9]*\})/

/**
 * Compiles a regex safely with length limits and ReDoS heuristic guards (A-09).
 * Returns RegExp instance or null if rejected.
 */
export function compileSafeRegex(pattern) {
  if (!pattern || typeof pattern !== 'string') return null
  if (pattern.length > MAX_REGEX_LENGTH) {
    console.warn('[AdapterCore] Regex pattern rejected: exceeds 200 characters limit')
    return null
  }
  if (DANGEROUS_NESTED_QUANTIFIERS.test(pattern)) {
    console.warn('[AdapterCore] Regex pattern rejected: potential ReDoS nested quantifier detected')
    return null
  }
  try {
    return new RegExp(pattern)
  } catch (err) {
    console.warn('[AdapterCore] Regex compilation failed:', err)
    return null
  }
}

/**
 * Checks whether a URL matches the declarative adapter spec.
 * Strict host suffix matching and pathname allow/exclude validation (Directive 3).
 */
export function matchesUrl(urlString, spec) {
  if (!urlString || !spec) return false
  try {
    const u = typeof urlString === 'string' ? new URL(urlString) : urlString
    const host = u.hostname.toLowerCase()

    const hostOk = (spec.hostSuffixes || []).some((s) => {
      const lower = s.toLowerCase()
      return host === lower || host.endsWith('.' + lower)
    })
    if (!hostOk) return false

    // Check path exclusions
    const pathname = u.pathname || '/'
    if ((spec.excludePaths || []).some((p) => pathname.startsWith(p))) {
      return false
    }

    // Check path allowlist
    const allowList = spec.allowPaths || ['/']
    return allowList.some((p) => pathname.startsWith(p))
  } catch {
    return false
  }
}

/**
 * Parses numeric price from arbitrary text.
 */
export function parsePriceText(text) {
  if (!text) return null
  const cleaned = String(text).replace(/[^0-9.,]/g, '').trim()
  if (!cleaned) return null

  // Handle Kenyan currency formats (e.g. 1,250.00 or 1250)
  const norm = cleaned.replace(/,/g, '')
  const val = parseFloat(norm)
  return Number.isFinite(val) && val >= 0 ? val : null
}

/**
 * Extract JSON-LD script metadata from document or container
 */
export function extractJsonLdProducts(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return []
  const scripts = root.querySelectorAll('script[type="application/ld+json"]')
  const products = []

  for (const s of scripts) {
    try {
      const json = JSON.parse(s.textContent || '{}')
      const items = Array.isArray(json) ? json : json['@graph'] ? json['@graph'] : [json]
      for (const item of items) {
        if (item && (item['@type'] === 'Product' || item.type === 'Product')) {
          products.push({
            name: item.name || null,
            sku: item.sku || null,
            gtin: item.gtin || item.gtin13 || item.gtin8 || item.gtin14 || null,
            price: item.offers?.price ? parseFloat(item.offers.price) : null,
            currency: item.offers?.priceCurrency || 'KES',
            source: 'json-ld',
          })
        }
      }
    } catch {
      // Ignore invalid JSON-LD blocks
    }
  }
  return products
}

/**
 * Unified Retailer Adapter Engine
 */
export class RetailerAdapter {
  constructor(spec) {
    if (!spec || !spec.retailer) {
      throw new Error('RetailerAdapter: spec with retailer code is required')
    }
    this.spec = spec
    this.retailer = spec.retailer
    this.specVersion = spec.specVersion || '1.0.0'
    this.minExtVersion = spec.minExtVersion || '0.0.1'

    // Compile regexes in spec safely at load time
    this.compiledIdRules = (spec.id || []).map((rule) => ({
      ...rule,
      regex: rule.hrefRegex ? compileSafeRegex(rule.hrefRegex) : null,
    }))
  }

  matches(url) {
    return matchesUrl(url, this.spec)
  }

  isKillSwitched() {
    return this.spec.killSwitch === true
  }

  /**
   * Pure DOM observation returning array of standardized product extractions.
   */
  observeProducts(root) {
    if (!root || this.isKillSwitched()) return []

    const scope = typeof root.querySelectorAll === 'function' ? root : null
    if (!scope) return []

    // 1. Find product card elements via ranked selectors
    const cardSelectors = this.spec.card || []
    let cards = []
    for (const sel of cardSelectors) {
      try {
        const found = scope.querySelectorAll(sel)
        if (found && found.length > 0) {
          cards = Array.from(found)
          break
        }
      } catch {
        // Skip invalid CSS selector
      }
    }

    if (cards.length === 0) return []

    const observations = []

    for (const card of cards) {
      const obs = this.extractProductFromCard(card)
      if (obs && obs.id) {
        observations.push(obs)
      }
    }

    return observations
  }

  /**
   * Multi-tier extraction for a single product card
   */
  extractProductFromCard(card) {
    if (!card || this.isKillSwitched()) return null

    let id = null
    let idSource = null
    let name = null
    let nameSource = null
    let price = null
    let priceSource = null
    let gtin = null
    let sku = null

    // Tier 1: Microdata check (itemprop)
    const microName = card.querySelector?.('[itemprop="name"]')?.textContent?.trim()
    if (microName) {
      name = microName
      nameSource = 'microdata'
    }

    const microPrice = card.querySelector?.('[itemprop="price"]')?.getAttribute?.('content') ||
      card.querySelector?.('[itemprop="price"]')?.textContent
    if (microPrice) {
      const parsed = parsePriceText(microPrice)
      if (parsed !== null) {
        price = parsed
        priceSource = 'microdata'
      }
    }

    // Tier 2: data-* attributes & compiled ID rules
    for (const rule of this.compiledIdRules) {
      if (rule.attr) {
        const target = rule.selector ? card.querySelector?.(rule.selector) : card
        const val = target?.getAttribute?.(rule.attr)
        if (val) {
          if (rule.regex) {
            const match = String(val).match(rule.regex)
            if (match && match[1]) {
              id = String(match[1]).trim()
              idSource = 'data-attr-regex'
              break
            }
          } else {
            id = String(val).trim()
            idSource = 'data-attr'
            break
          }
        }
      }

      if (rule.regex) {
        const links = card.querySelectorAll ? card.querySelectorAll('a[href]') : []
        for (const a of links) {
          const href = a.getAttribute('href') || ''
          const match = href.match(rule.regex)
          if (match && match[1]) {
            id = String(match[1]).trim()
            idSource = 'href-regex'
            break
          }
        }
        if (id) break
      }
    }

    // Direct data attribute fallbacks for SKU and GTIN
    sku = card.getAttribute?.('data-sku') || card.querySelector?.('[data-sku]')?.getAttribute?.('data-sku') || null
    gtin = card.getAttribute?.('data-gtin') || card.querySelector?.('[data-gtin]')?.getAttribute?.('data-gtin') || null

    if (!id && sku) {
      id = sku
      idSource = 'data-sku'
    }

    // Tier 3: Ranked visible text selectors for Name
    if (!name && Array.isArray(this.spec.name)) {
      for (const sel of this.spec.name) {
        try {
          const el = card.querySelector?.(sel)
          if (el && el.textContent) {
            const trimmed = el.textContent.trim()
            if (trimmed) {
              name = trimmed
              nameSource = 'dom-selector'
              break
            }
          }
        } catch {
          // Continue to next selector
        }
      }
    }

    // Tier 3: Ranked visible text selectors for Price
    if (price === null && this.spec.price?.selector) {
      try {
        const el = card.querySelector?.(this.spec.price.selector)
        if (el && el.textContent) {
          const parsed = parsePriceText(el.textContent)
          if (parsed !== null) {
            price = parsed
            priceSource = 'dom-selector'
          }
        }
      } catch {
        // Fall through
      }
    }

    if (!id && !name) {
      return null
    }

    return {
      retailer: this.retailer,
      id: id || `synth_${(name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)}`,
      name: name || '',
      price: price ?? null,
      gtin: gtin || null,
      sku: sku || null,
      card,
      sources: {
        id: idSource || 'unknown',
        name: nameSource || 'unknown',
        price: priceSource || 'unknown',
      },
    }
  }

  /**
   * Price quarantine check (Directive 5):
   * Page price > 5x catalogue price is quarantined to prevent spend spoofing.
   */
  checkPriceQuarantine(pagePrice, catalogPrice) {
    if (pagePrice === null || catalogPrice === null || catalogPrice <= 0) {
      return false
    }
    return pagePrice > 5 * catalogPrice
  }

  injectBadge(el, _evaluation) {
    if (!el) return
    let root = el.querySelector?.('.nutriscore-isolated-root')
    if (!root) {
      root = document.createElement('div')
      root.className = 'nutriscore-isolated-root'
      el.appendChild(root)
    }
  }

  injectNeutral(el) {
    this.injectBadge(el, null)
  }

  observeCart() {
    return null // Implemented or overridden by retailer subclass
  }

  detectCheckoutCompleted() {
    return null // Implemented or overridden by retailer subclass
  }
}
