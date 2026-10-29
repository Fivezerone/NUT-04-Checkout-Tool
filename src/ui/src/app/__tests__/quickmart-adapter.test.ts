/**
 * Quickmart Adapter Unit Tests
 * Verifies schema conformance, defensive extraction, adapter contract, and factory routing.
 */
// Provide NutriSharedUI stub before importing adapter
if (typeof (globalThis as any).NutriSharedUI === "undefined") {
  (globalThis as any).NutriSharedUI = {
    parsePrice: (text: string) => {
      if (!text) return 0;
      const match = text.match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/);
      return match ? parseFloat(match[0].replace(/,/g, "")) : 0;
    },
    generateIdFromName: (name: string) => "synth_" + name.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 32),
    escapeHTML: (str: string) => str,
    injectBadge: () => {},
    fetchWithRetry: async () => ({ ok: false }),
  };
}

import { describe, it, expect, beforeEach } from "vitest";
import "../../../../extension/adapters/quickmart.js";
import { defaultAdapterFactory, AdapterFactory } from "../../../../extension/adapters/adapter-factory.js";

const {
  QuickmartAdapter,
  extractPackSizeUnit,
  parseCleanPrice,
  mapToCanonicalSchema,
} = globalThis as any;
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, "");
const csSrc = readFileSync(join(ROOT, "src/extension/catalog-sync.js"), "utf8");
const manifestSrc = readFileSync(join(ROOT, "src/extension/manifest.json"), "utf8");

describe("Quickmart Adapter: Regex and Utility Parsing", () => {
  it("extracts pack size units across various formats", () => {
    expect(extractPackSizeUnit("Brookside Fresh Milk 500ml")).toBe("ML");
    expect(extractPackSizeUnit("Pembe Maize Meal 2kg")).toBe("KG");
    expect(extractPackSizeUnit("Coca Cola 2L")).toBe("L");
    expect(extractPackSizeUnit("Broadways White Bread 400g")).toBe("G");
    expect(extractPackSizeUnit("Kabras Sugar 1KG")).toBe("KG");
    expect(extractPackSizeUnit("Eggs 6 Pcs")).toBe("PCS");
    expect(extractPackSizeUnit("Sunflower Oil 3 Litres")).toBe("L");
    expect(extractPackSizeUnit("Salt 500 gm")).toBe("G");
    expect(extractPackSizeUnit("Product Without Size")).toBeNull();
    expect(extractPackSizeUnit("")).toBeNull();
    expect(extractPackSizeUnit(null as any)).toBeNull();
  });

  it("parseCleanPrice strips currency prefixes and commas into finite numbers", () => {
    expect(parseCleanPrice("Ksh 1,250.00")).toBe(1250);
    expect(parseCleanPrice("KES 95.50")).toBe(95.5);
    expect(parseCleanPrice("KSh. 450")).toBe(450);
    expect(parseCleanPrice(320)).toBe(320);
    expect(parseCleanPrice("")).toBe(0);
    expect(parseCleanPrice(null)).toBe(0);
    expect(parseCleanPrice(undefined)).toBe(0);
    expect(parseCleanPrice("Invalid Price")).toBe(0);
  });
});

describe("Quickmart Adapter: Standardized JSON Schema Mapping", () => {
  it("maps valid tile attributes to the exact canonical schema", () => {
    const rawTile = {
      id: "10492",
      name: "Brookside Fresh Milk 500ml",
      price: "Ksh 65.00",
      url: "https://www.quickmart.co.ke/products/view/10492",
      brand: "Brookside",
      scrapedCategory: "dairy & eggs",
    };

    const mapped = mapToCanonicalSchema(rawTile);

    expect(mapped.Identity.ProductID).toBe("10492");
    expect(mapped.Identity.ProductName).toBe("Brookside Fresh Milk 500ml");
    expect(mapped.Identity.Retailer).toBe("QUICKMART");
    expect(mapped.Identity.NormalizedName).toBe("brookside fresh milk 500ml");
    expect(mapped.Identity.RetailerProductUrl).toBe("https://www.quickmart.co.ke/products/view/10492");
    expect(mapped.Identity.BrandName).toBe("Brookside");

    expect(mapped.Packaging.PackSizeUnit).toBe("ML");
    expect(mapped.Price.CurrentPriceKES).toBe(65);

    // Nutrition block must be strictly null fallbacks
    expect(mapped.Nutrition).toEqual({
      EnergyKcal: null,
      EnergyKJ: null,
      FatG: null,
      SaturatedFatG: null,
      CarbohydratesG: null,
      SugarsG: null,
      ProteinG: null,
      SodiumMG: null,
      SaltG: null,
      FibreG: null,
      PotassiumMG: null,
    });
  });

  it("handles null / missing tile attributes safely without throwing", () => {
    const mapped = mapToCanonicalSchema(null);
    expect(mapped.Identity.Retailer).toBe("QUICKMART");
    expect(mapped.Identity.ProductID).toBe("");
    expect(mapped.Packaging.PackSizeUnit).toBeNull();
    expect(mapped.Price.CurrentPriceKES).toBe(0);
  });
});

describe("Quickmart Adapter: IRetailerAdapter Contract", () => {
  it("implements required adapter methods and retailer code", () => {
    expect(QuickmartAdapter.getRetailerCode()).toBe("QUICKMART");
    expect(typeof QuickmartAdapter.getObserveTarget).toBe("function");
    expect(typeof QuickmartAdapter.detectProducts).toBe("function");
    expect(typeof QuickmartAdapter.candidatesIn).toBe("function");
    expect(typeof QuickmartAdapter.injectBadge).toBe("function");
    expect(typeof QuickmartAdapter.inject).toBe("function");
    expect(typeof QuickmartAdapter.extractCartState).toBe("function");
    expect(typeof QuickmartAdapter.extractCartAction).toBe("function");
    expect(typeof QuickmartAdapter.extractRemoveAction).toBe("function");
    expect(typeof QuickmartAdapter.detectOrderConfirmation).toBe("function");
  });

  it("candidatesIn returns empty array when given an empty container", () => {
    const mockContainer = {
      querySelectorAll: () => [],
    };
    const candidates = QuickmartAdapter.candidatesIn(mockContainer as any);
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBe(0);
  });

  it("escapeHTML escapes dangerous HTML special characters", () => {
    const malicious = '<script>alert("XSS & attack\'s `here`")</script>';
    const escaped = QuickmartAdapter.escapeHTML(malicious);
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).toContain("&amp;");
    expect(escaped).toContain("&quot;");
    expect(escaped).toContain("&#39;");
    expect(escaped).toContain("&#96;");
  });

  it("_parseCard extracts ID from selprod_id input or form ID", () => {
    const mockCard = {
      querySelector: (sel: string) => {
        if (sel === 'input[name="selprod_id"]') return { value: "624045" };
        if (sel.includes("href")) return { href: "https://www.quickmart.co.ke/tuzo-lala-500ml" };
        if (sel.includes("products-title")) return { textContent: "Tuzo Lala 500ml", getAttribute: () => null };
        if (sel.includes("products-price")) return { textContent: "Ksh 85" };
        return null;
      },
      getAttribute: () => null,
    };
    const parsed = (QuickmartAdapter as any)._parseCard(mockCard, "dairy");
    expect(parsed).toBeDefined();
    expect(parsed.id).toBe("624045");
    expect(parsed.name).toBe("Tuzo Lala 500ml");
    expect(parsed.price).toBe(85);
    expect(parsed.url).toBe("https://www.quickmart.co.ke/tuzo-lala-500ml");
  });
});

describe("Adapter Factory: Central Orchestrator & Registry", () => {
  it("resolves QuickmartAdapter when URL matches quickmart.co.ke", () => {
    const adapter = defaultAdapterFactory.getAdapterForUrl("https://www.quickmart.co.ke/categories/food-cupboard");
    expect(adapter).toBeDefined();
    expect(adapter?.getRetailerCode()).toBe("QUICKMART");
  });

  it("resolves QuickmartAdapter by retailer code QUICKMART", () => {
    const adapter = defaultAdapterFactory.getAdapterForRetailer("QUICKMART");
    expect(adapter).toBe(QuickmartAdapter);
  });

  it("lists QUICKMART among supported retailers", () => {
    const supported = defaultAdapterFactory.getSupportedRetailers();
    expect(supported).toContain("QUICKMART");
  });
});

describe("Full-System Wiring: Manifest and Catalog Sync", () => {
  it("manifest.json includes quickmart.co.ke in host_permissions", () => {
    const manifest = JSON.parse(manifestSrc);
    expect(manifest.host_permissions).toContain("https://*.quickmart.co.ke/*");
  });

  it("manifest.json registers quickmart content script bundle", () => {
    const manifest = JSON.parse(manifestSrc);
    const qScript = manifest.content_scripts.find((cs: any) =>
      cs.matches.includes("https://*.quickmart.co.ke/*")
    );
    expect(qScript).toBeDefined();
    expect(qScript.js).toContain("adapters/quickmart.js");
    expect(qScript.js).toContain("content.js");
  });

  it("catalog-sync.js includes QUICKMART in RETAILER_REGISTRY", () => {
    expect(csSrc).toContain('"QUICKMART"');
    expect(csSrc).toContain("quickmartProducts");
  });
});
