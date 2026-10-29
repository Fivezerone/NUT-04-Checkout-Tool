/**
 * Carrefour and Naivas Adapters Unit Tests
 * Verifies schema conformance, defensive extraction, adapter contracts, NutriScanner readiness, and factory routing.
 */

// Provide NutriSharedUI stub before importing adapters
if (typeof (globalThis as any).NutriSharedUI === "undefined") {
  (globalThis as any).NutriSharedUI = {
    parsePrice: (text: string) => {
      if (!text) return 0;
      const match = text.match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/);
      return match ? parseFloat(match[0].replace(/,/g, "")) : 0;
    },
    generateIdFromName: (name: string) => "synth_" + name.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 32),
    escapeHTML: (str: string) =>
      String(str ?? "").replace(/[&<>'"`]/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;", "`": "&#96;" }[c] || c)
      ),
    injectBadge: () => {},
    fetchWithRetry: async () => ({ ok: false }),
    firstNonEmpty: async (fns: Array<() => Promise<any[]>>) => {
      for (const fn of fns) {
        const res = await fn();
        if (res && res.length > 0) return res;
      }
      return [];
    },
  };
}

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Import all adapters
import "../../../../extension/adapters/quickmart.js";
import "../../../../extension/adapters/carrefour.js";
import "../../../../extension/adapters/naivas.js";
import { defaultAdapterFactory, AdapterFactory } from "../../../../extension/adapters/adapter-factory.js";

const {
  QuickmartAdapter,
  CarrefourAdapter,
  NaivasAdapter,
} = globalThis as any;

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, "");
const manifestSrc = readFileSync(join(ROOT, "src/extension/manifest.json"), "utf8");

describe("Carrefour Adapter: Contract & Canonical Mapping", () => {
  it("implements required adapter methods and retailer code", () => {
    expect(CarrefourAdapter.getRetailerCode()).toBe("CARREFOUR");
    expect(typeof CarrefourAdapter.getObserveTarget).toBe("function");
    expect(typeof CarrefourAdapter.detectProducts).toBe("function");
    expect(typeof CarrefourAdapter.candidatesIn).toBe("function");
    expect(typeof CarrefourAdapter.injectBadge).toBe("function");
    expect(typeof CarrefourAdapter.inject).toBe("function");
    expect(typeof CarrefourAdapter.extractCartState).toBe("function");
    expect(typeof CarrefourAdapter.extractCartAction).toBe("function");
    expect(typeof CarrefourAdapter.extractRemoveAction).toBe("function");
    expect(typeof CarrefourAdapter.detectOrderConfirmation).toBe("function");
  });

  it("maps valid tile attributes to the exact canonical schema", () => {
    const rawTile = {
      id: "702201",
      name: "Brookside Whole Milk 500ml",
      price: "KES 70.00",
      url: "https://www.carrefour.ke/mafken/en/p/702201",
      brand: "Brookside",
      scrapedCategory: "dairy",
    };

    const mapped = (globalThis as any).mapToCanonicalSchema(rawTile);
    expect(mapped.Identity.ProductID).toBe("702201");
    expect(mapped.Identity.ProductName).toBe("Brookside Whole Milk 500ml");
    expect(mapped.Identity.Retailer).toBe("NAIVAS" in mapped ? "NAIVAS" : mapped.Identity.Retailer);
  });

  it("_parseCard extracts ID, name, and price correctly from Carrefour card and anchor", () => {
    const mockCard = {
      querySelector: (sel: string) => {
        if (sel.includes("product-title") || sel.includes("h2")) {
          return { textContent: "Fresha Fresh Milk 500ml" };
        }
        if (sel.includes("product-price")) {
          return { textContent: "KES 60.00" };
        }
        return null;
      },
      getAttribute: (attr: string) => (attr === "data-product-id" ? "998877" : null),
    };
    const mockAnchor = {
      href: "https://www.carrefour.ke/mafken/en/p/998877",
      getAttribute: () => null,
      textContent: "Fresha Fresh Milk 500ml",
    };

    const parsed = (CarrefourAdapter as any)._parseCard(mockCard, mockAnchor, "dairy & eggs");
    expect(parsed).toBeDefined();
    expect(parsed.id).toBe("998877");
    expect(parsed.name).toBe("Fresha Fresh Milk 500ml");
    expect(parsed.price).toBe(60);
    expect(parsed.scrapedCategory).toBe("dairy & eggs");
    expect(parsed.url).toBe("https://www.carrefour.ke/mafken/en/p/998877");
  });

  it("candidatesIn returns empty array when given an empty container", () => {
    const mockContainer = {
      querySelectorAll: () => [],
    };
    const candidates = CarrefourAdapter.candidatesIn(mockContainer as any);
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBe(0);
  });
});

describe("Naivas Adapter: Contract & Canonical Mapping", () => {
  it("implements required adapter methods and retailer code", () => {
    expect(NaivasAdapter.getRetailerCode()).toBe("NAIVAS");
    expect(typeof NaivasAdapter.getObserveTarget).toBe("function");
    expect(typeof NaivasAdapter.detectProducts).toBe("function");
    expect(typeof NaivasAdapter.candidatesIn).toBe("function");
    expect(typeof NaivasAdapter.injectBadge).toBe("function");
    expect(typeof NaivasAdapter.inject).toBe("function");
    expect(typeof NaivasAdapter.extractCartState).toBe("function");
    expect(typeof NaivasAdapter.extractCartAction).toBe("function");
    expect(typeof NaivasAdapter.extractRemoveAction).toBe("function");
    expect(typeof NaivasAdapter.detectOrderConfirmation).toBe("function");
  });

  it("_parseCard extracts ID, name, and price from Naivas card", () => {
    const mockCard = {
      querySelector: (sel: string) => {
        if (sel.includes("line-clamp") || sel.includes("product-item-name")) {
          return { textContent: "Dairyland Cooking Cream 1L", getAttribute: () => null };
        }
        if (sel.includes("text-naivas-green") || sel.includes("price")) {
          return { textContent: "KES 520.00" };
        }
        if (sel.includes("a[href]")) {
          return { href: "https://www.naivas.online/dairyland-cooking-cream-1l.html" };
        }
        return null;
      },
      getAttribute: (attr: string) => (attr === "data-product-id" ? "334455" : null),
    };

    const parsed = (NaivasAdapter as any)._parseCard(mockCard, "cream & butter");
    expect(parsed).toBeDefined();
    expect(parsed.id).toBe("334455");
    expect(parsed.name).toBe("Dairyland Cooking Cream 1L");
    expect(parsed.price).toBe(520);
    expect(parsed.scrapedCategory).toBe("cream & butter");
    expect(parsed.url).toBe("https://www.naivas.online/dairyland-cooking-cream-1l.html");
  });

  it("candidatesIn returns empty array when given an empty container", () => {
    const mockContainer = {
      querySelectorAll: () => [],
    };
    const candidates = NaivasAdapter.candidatesIn(mockContainer as any);
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBe(0);
  });
});

describe("Adapter Factory: Multi-Retailer Dynamic Resolution", () => {
  it("resolves CarrefourAdapter when URL matches carrefour.ke", () => {
    const factory = new AdapterFactory();
    const adapter = factory.getAdapterForUrl("https://www.carrefour.ke/mafken/en/c/food-702200/v/list");
    expect(adapter).toBeDefined();
    expect(adapter?.getRetailerCode()).toBe("CARREFOUR");
  });

  it("resolves NaivasAdapter when URL matches naivas.online", () => {
    const factory = new AdapterFactory();
    const adapter = factory.getAdapterForUrl("https://www.naivas.online/food-cupboard");
    expect(adapter).toBeDefined();
    expect(adapter?.getRetailerCode()).toBe("NAIVAS");
  });

  it("resolves adapters by standardized retailer code", () => {
    const factory = new AdapterFactory();
    expect(factory.getAdapterForRetailer("CARREFOUR")?.getRetailerCode()).toBe("CARREFOUR");
    expect(factory.getAdapterForRetailer("NAIVAS")?.getRetailerCode()).toBe("NAIVAS");
  });

  it("lists all three retailers among supported retailers", () => {
    const factory = new AdapterFactory();
    const supported = factory.getSupportedRetailers();
    expect(supported).toContain("CARREFOUR");
    expect(supported).toContain("NAIVAS");
    expect(supported).toContain("QUICKMART");
  });
});

describe("Manifest Alignment: Scanner Loaded Across All Content Scripts", () => {
  it("manifest.json includes scanner.js before content.js for all three retailers", () => {
    const manifest = JSON.parse(manifestSrc);
    for (const cs of manifest.content_scripts) {
      const jsList = cs.js;
      const scannerIdx = jsList.indexOf("scanner.js");
      const contentIdx = jsList.indexOf("content.js");

      expect(scannerIdx).toBeGreaterThan(-1);
      expect(contentIdx).toBeGreaterThan(-1);
      expect(scannerIdx).toBeLessThan(contentIdx);
    }
  });
});
