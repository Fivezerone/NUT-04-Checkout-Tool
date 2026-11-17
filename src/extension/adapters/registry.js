/**
 * src/extension/adapters/registry.js
 *
 * Central Static Adapter Registry (Blueprint §2.5, Directive 2; A-08, A-09)
 *
 * Invariants:
 * - Statically binds retailer adapter instances with their declarative specs.
 * - Eliminates window.*Adapter global variable order dependency.
 * - Deterministic URL routing via matchesUrl() on parsed URL objects.
 */

import { RetailerAdapter } from './adapter-core.js'

import quickmartSpec from './specs/quickmart.json'
import naivasSpec from './specs/naivas.json'
import carrefourSpec from './specs/carrefour.json'

export class AdapterRegistry {
  constructor() {
    this.adapters = new Map()

    // Register primary built-in adapters with their declarative specs
    this.register('QUICKMART', new RetailerAdapter(quickmartSpec))
    this.register('NAIVAS', new RetailerAdapter(naivasSpec))
    this.register('CARREFOUR', new RetailerAdapter(carrefourSpec))
  }

  register(retailerCode, adapter) {
    if (!retailerCode || !adapter) return
    this.adapters.set(retailerCode.toUpperCase(), adapter)
  }

  getAdapter(retailerCode) {
    if (!retailerCode) return null
    return this.adapters.get(retailerCode.toUpperCase()) || null
  }

  getAll() {
    return Array.from(this.adapters.values())
  }

  /**
   * Resolves the matching adapter for a given URL string or URL object.
   * Tests hostname and path allowlist/exclusion strictly.
   * @param {string|URL} url
   * @returns {RetailerAdapter|null}
   */
  resolveAdapter(url) {
    if (!url) return null
    for (const adapter of this.adapters.values()) {
      if (adapter.matches(url)) {
        return adapter
      }
    }
    return null
  }
}

export const defaultRegistry = new AdapterRegistry()
