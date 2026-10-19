/**
 * adapter-factory.js — Central Adapter Factory & Orchestrator Registry
 *
 * Dynamically resolves, instantiates, and routes retailer adapters based on
 * current page URL, hostname, data stream metadata, or retailer codes.
 */

import { QuickmartAdapter } from "./quickmart.js";

// Lazy / conditional loader for browser content-script contexts or Node/test environments
let NaivasAdapter = null;
let CarrefourAdapter = null;

if (typeof window !== "undefined") {
  if (window.NaivasAdapter) NaivasAdapter = window.NaivasAdapter;
  if (window.CarrefourAdapter) CarrefourAdapter = window.CarrefourAdapter;
}

export class AdapterFactory {
  constructor() {
    this.registry = new Map();
    this.urlRules = [];

    // Register built-in retailer adapters
    this.register("QUICKMART", QuickmartAdapter, [
      /quickmart\.co\.ke/i,
      /quickmart/i,
    ]);

    if (CarrefourAdapter || (typeof window !== "undefined" && window.CarrefourAdapter)) {
      this.register("CARREFOUR", CarrefourAdapter || window.CarrefourAdapter, [
        /carrefour\.ke/i,
        /carrefourkenya\.com/i,
      ]);
    }

    if (NaivasAdapter || (typeof window !== "undefined" && window.NaivasAdapter)) {
      this.register("NAIVAS", NaivasAdapter || window.NaivasAdapter, [
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
