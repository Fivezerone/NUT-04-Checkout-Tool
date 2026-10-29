/**
 * adapter-factory.js — Central Adapter Factory & Orchestrator Registry
 *
 * Dynamically resolves, instantiates, and routes retailer adapters based on
 * current page URL, hostname, data stream metadata, or retailer codes.
 */

// Lazy / conditional loader for browser content-script contexts or Node/test environments
let QuickmartAdapter = null;
let NaivasAdapter = null;
let CarrefourAdapter = null;

if (typeof window !== "undefined") {
  if (window.QuickmartAdapter) QuickmartAdapter = window.QuickmartAdapter;
  if (window.NaivasAdapter) NaivasAdapter = window.NaivasAdapter;
  if (window.CarrefourAdapter) CarrefourAdapter = window.CarrefourAdapter;
}
if (typeof globalThis !== "undefined") {
  if (!QuickmartAdapter && globalThis.QuickmartAdapter) QuickmartAdapter = globalThis.QuickmartAdapter;
  if (!NaivasAdapter && globalThis.NaivasAdapter) NaivasAdapter = globalThis.NaivasAdapter;
  if (!CarrefourAdapter && globalThis.CarrefourAdapter) CarrefourAdapter = globalThis.CarrefourAdapter;
}

export class AdapterFactory {
  constructor() {
    this.registry = new Map();
    this.urlRules = [];

    // Register built-in retailer adapters
    const qm = QuickmartAdapter || (typeof window !== "undefined" && window.QuickmartAdapter) || (typeof globalThis !== "undefined" && globalThis.QuickmartAdapter);
    if (qm) {
      this.register("QUICKMART", qm, [
        /quickmart\.co\.ke/i,
        /quickmart/i,
      ]);
    }

    const cf = CarrefourAdapter || (typeof window !== "undefined" && window.CarrefourAdapter) || (typeof globalThis !== "undefined" && globalThis.CarrefourAdapter);
    if (cf) {
      this.register("CARREFOUR", cf, [
        /carrefour\.ke/i,
        /carrefourkenya\.com/i,
      ]);
    }

    const nv = NaivasAdapter || (typeof window !== "undefined" && window.NaivasAdapter) || (typeof globalThis !== "undefined" && globalThis.NaivasAdapter);
    if (nv) {
      this.register("NAIVAS", nv, [
        /naivas\.online/i,
        /naivas\.co\.ke/i,
      ]);
    }
  }

  /**
   * Register a new retailer adapter with domain/URL regex patterns.
   * @param {string} retailerCode - Standardized uppercase code (e.g., 'QUICKMART')
   * @param {object} adapterInstance - Adapter implementing IRetailerAdapter
   * @param {RegExp[]} urlPatterns - Matching regex rules for URL routing
   */
  register(retailerCode, adapterInstance, urlPatterns = []) {
    const code = retailerCode.toUpperCase();
    this.registry.set(code, adapterInstance);
    for (const pattern of urlPatterns) {
      this.urlRules.push({ pattern, code, adapter: adapterInstance });
    }
  }

  /**
   * Resolve and spin up the appropriate adapter for a given URL or data stream.
   * @param {string} url - Current page URL or incoming data stream origin
   * @returns {object|null} Matching IRetailerAdapter or null
   */
  getAdapterForUrl(url) {
    if (!url || typeof url !== "string") return null;
    for (const rule of this.urlRules) {
      if (rule.pattern.test(url)) {
        return rule.adapter;
      }
    }
    return null;
  }

  /**
   * Resolve an adapter by standardized retailer code.
   * @param {string} retailerCode - e.g. "QUICKMART", "CARREFOUR", "NAIVAS"
   * @returns {object|null}
   */
  getAdapterForRetailer(retailerCode) {
    if (!retailerCode) return null;
    return this.registry.get(retailerCode.toUpperCase()) || null;
  }

  /**
   * Returns all registered retailer codes.
   * @returns {string[]}
   */
  getSupportedRetailers() {
    return Array.from(this.registry.keys());
  }
}

export const defaultAdapterFactory = new AdapterFactory();

if (typeof window !== "undefined") {
  window.NutriAdapterFactory = defaultAdapterFactory;
}

export default defaultAdapterFactory;
