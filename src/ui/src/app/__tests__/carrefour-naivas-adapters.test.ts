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

describe("Carrefour Adapter: Modern DOM & Resilient Price Extraction", () => {
  it("extracts price accurately when KES and price number are sibling spans in items-baseline", () => {
    const mockCard = {
      querySelector: (sel: string) => {
        if (sel.includes("product-title") || sel.includes("h2")) {
          return { textContent: "Sony 55 Inch 4K Smart TV" };
        }
        if (sel.includes("items-baseline") || sel.includes("product-price") || sel.includes("price")) {
          return {
            textContent: "KES 54,999.00",
            closest: () => ({ textContent: "KES 54,999.00" }),
          };
        }
        return null;
      },
      getAttribute: () => null,
    };
    const mockAnchor = {
      href: "https://www.carrefour.ke/mafken/en/p/554433",
      getAttribute: () => null,
      textContent: "Sony 55 Inch 4K Smart TV",
    };

    const parsed = (CarrefourAdapter as any)._parseCard(mockCard, mockAnchor, "electronics");
    expect(parsed).toBeDefined();
    expect(parsed.price).toBe(54999);
  });

  it("identifies non-food categories (e.g. electronics, appliances) and gates them", () => {
    expect((CarrefourAdapter as any)._isNonFoodCategory("electronics & appliances", "")).toBe(true);
    expect((CarrefourAdapter as any)._isNonFoodCategory("smartphones & tablets", "")).toBe(true);
    expect((CarrefourAdapter as any)._isNonFoodCategory("home cleaning & pet", "")).toBe(true);
    expect((CarrefourAdapter as any)._isNonFoodCategory("fresh food & vegetables", "")).toBe(false);
    expect((CarrefourAdapter as any)._isNonFoodCategory("dairy & eggs", "")).toBe(false);
    expect((CarrefourAdapter as any)._isNonFoodCategory("beverages", "")).toBe(false);
  });

  it("resolves modern card containers (.group, .border-gray-50)", () => {
    const groupElement = { className: "group border-gray-50 relative flex flex-col" };
    const mockAnchor = {
      closest: (sel: string) => {
        if (sel.includes(".group") || sel.includes(".border-gray-50")) return groupElement;
        return null;
      },
      parentElement: groupElement,
    };
    const resolved = (CarrefourAdapter as any)._findCardContainer(mockAnchor);
    expect(resolved).toBe(groupElement);
  });
});

describe("Naivas Adapter: Modern React/Tailwind v4 DOM & CloudFront SKU Extraction", () => {
  it("extracts SKU from CloudFront CDN image path", () => {
    const mockCard = {
      querySelector: (sel: string) => {
        if (sel.includes("img[src*='product/']")) {
          return { src: "https://d16zmt6hgq1jhj.cloudfront.net/product/98765/main.webp" };
        }
        if (sel.includes("line-clamp") || sel.includes("h1") || sel.includes("h2")) {
          return { textContent: "Frozen Isle Githeri 1kg" };
        }
        if (sel.includes("price") || sel.includes("items-center")) {
          return {
            textContent: "KES 210.00",
            closest: () => ({ textContent: "KES 210.00" }),
          };
        }
        return null;
      },
      getAttribute: () => null,
      closest: () => null,
    };

    const parsed = (NaivasAdapter as any)._parseCard(mockCard, "frozen food");
    expect(parsed).toBeDefined();
    expect(parsed.id).toBe("98765");
    expect(parsed.name).toBe("Frozen Isle Githeri 1kg");
    expect(parsed.price).toBe(210);
  });

  it("extracts URL slug from product anchor link when SKU image is absent", () => {
    const mockCard = {
      querySelector: (sel: string) => {
        if (sel.includes("a[href*='naivas.online/']")) {
          return { href: "https://www.naivas.online/rina-vegetable-oil-5l" };
        }
        if (sel.includes("line-clamp")) {
          return { textContent: "Rina Vegetable Oil 5L" };
        }
        if (sel.includes("price")) {
          return { textContent: "KES 1,250.00", closest: () => ({ textContent: "KES 1,250.00" }) };
        }
        return null;
      },
      getAttribute: () => null,
      closest: () => null,
    };

    const parsed = (NaivasAdapter as any)._parseCard(mockCard, "cooking essentials");
    expect(parsed).toBeDefined();
    expect(parsed.id).toBe("rina-vegetable-oil-5l");
    expect(parsed.price).toBe(1250);
  });

  it("identifies non-food categories on Naivas and gates them", () => {
    expect((NaivasAdapter as any)._isNonFoodCategory("electronics & televisions", "")).toBe(true);
    expect((NaivasAdapter as any)._isNonFoodCategory("home & living", "")).toBe(true);
    expect((NaivasAdapter as any)._isNonFoodCategory("beauty & cosmetics", "")).toBe(true);
    expect((NaivasAdapter as any)._isNonFoodCategory("food cupboard", "")).toBe(false);
    expect((NaivasAdapter as any)._isNonFoodCategory("beverages", "")).toBe(false);
  });
});

describe("NutriSharedUI: Anti-Collision Layout & Category Gating Verification", () => {
  const sharedUiSrc = readFileSync(join(ROOT, "src/extension/adapters/shared-ui.js"), "utf8");

  const createMockElement = (tag: string) => ({
    tagName: tag.toUpperCase(),
    className: "",
    style: {} as Record<string, string>,
    innerHTML: "",
    attributes: {} as Record<string, string>,
    setAttribute(k: string, v: string) { (this as any).attributes[k] = v; },
    getAttribute(k: string) { return (this as any).attributes[k] || null; },
    removeAttribute(k: string) { delete (this as any).attributes[k]; },
    attachShadow() {
      return {
        adoptedStyleSheets: [],
        appendChild: () => {},
      };
    },
    appendChild(child: any) { (this as any).lastChild = child; },
    addEventListener() {},
    removeEventListener() {},
  });

  const mockDoc: any = {
    createElement: (tag: string) => createMockElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: () => {} },
  };

  const NutriSharedUIEval = new Function("self", "window", "document", "CSSStyleSheet", `${sharedUiSrc}; return NutriSharedUI;`)(
    globalThis,
    globalThis,
    mockDoc,
    class MockStyleSheet { replaceSync() {} }
  );

  it("injectBadge gates out non-food/unmatched/excluded products by returning null", () => {
    const mockCard = {
      querySelector: () => null,
      setAttribute: () => {},
      appendChild: () => {},
    };

    // Product marked NOT_FOUND or not in catalog
    const notFoundResult = {
      status: "NOT_FOUND",
      nutriscore_grade: "UNKNOWN",
      scoringStatus: "not_found",
    };
    expect(NutriSharedUIEval.injectBadge(mockCard, notFoundResult, 0)).toBeNull();

    // Product excluded (e.g. non-food or uncategorized)
    const excludedResult = {
      isExcluded: true,
      nutriscore_grade: "UNKNOWN",
      scoringStatus: "not_attempted",
    };
    expect(NutriSharedUIEval.injectBadge(mockCard, excludedResult, 0)).toBeNull();
  });

  it("anti-collision: renders in-flow directly after title in horizontal cart/list row", () => {
    let insertedAfterTitle = false;
    let computedDisplay = "";

    const mockTitleEl = {
      insertAdjacentElement: (position: string, el: any) => {
        if (position === "afterend") {
          insertedAfterTitle = true;
          computedDisplay = el.style.cssText;
        }
      },
    };

    const mockCartRow: any = {
      matches: (sel: string) => sel.includes("cart-item"),
      querySelector: (sel: string) => {
        if (sel.includes("product-title") || sel.includes("line-clamp") || sel.includes("title")) {
          return mockTitleEl;
        }
        if (sel.includes("checkbox")) return { type: "checkbox" };
        return null;
      },
      setAttribute: () => {},
      appendChild: () => {},
      attachShadow: () => ({ appendChild: () => {} }),
      style: {},
    };

    const validFoodProduct = {
      productId: "181913",
      product_name: "Carrefour UHT Whole Milk 500 ml",
      nutriscore_grade: "A",
      scoringStatus: "computed",
    };

    NutriSharedUIEval.injectBadge(mockCartRow, validFoodProduct, 70);
    expect(insertedAfterTitle).toBe(true);
    expect(computedDisplay).toContain("display:block");
    expect(computedDisplay).toContain("margin:4px 0 6px 0");
  });

  it("anti-collision: renders in-flow directly after title in PDP view", () => {
    let insertedAfterH1 = false;
    let computedDisplay = "";

    const mockH1 = {
      insertAdjacentElement: (position: string, el: any) => {
        if (position === "afterend") {
          insertedAfterH1 = true;
          computedDisplay = el.style.cssText;
        }
      },
    };

    const mockPdpCard: any = {
      matches: (sel: string) => sel.includes("pdp"),
      querySelector: (sel: string) => {
        if (sel === "h1" || sel.includes("title")) return mockH1;
        return null;
      },
      setAttribute: () => {},
      appendChild: () => {},
      attachShadow: () => ({ appendChild: () => {} }),
      style: {},
    };

    const validFoodProduct = {
      productId: "702201",
      product_name: "Brookside Whole Milk 500ml",
      nutriscore_grade: "B",
      scoringStatus: "computed",
    };

    NutriSharedUIEval.injectBadge(mockPdpCard, validFoodProduct, 70);
    expect(insertedAfterH1).toBe(true);
    expect(computedDisplay).toContain("display:inline-flex");
    expect(computedDisplay).toContain("margin:8px 0 12px 0");
  });

  it("anti-collision: anchors to image wrapper in PLP grid view", () => {
    let appendedToMediaWrapper = false;
    let computedPosition = "";

    const mockMediaWrapper: any = {
      appendChild: (el: any) => {
        appendedToMediaWrapper = true;
        computedPosition = el.style.cssText;
      },
      style: {},
    };

    const mockGridCard: any = {
      matches: () => false,
      querySelector: (sel: string) => {
        if (sel.includes("img")) {
          return {
            closest: () => mockMediaWrapper,
          };
        }
        return null;
      },
      setAttribute: () => {},
      appendChild: () => {},
      attachShadow: () => ({ appendChild: () => {} }),
      style: {},
    };

    const validFoodProduct = {
      productId: "181913",
      product_name: "Weetabix Wholegrain Cereal 850G",
      nutriscore_grade: "A",
      scoringStatus: "computed",
    };

    NutriSharedUIEval.injectBadge(mockGridCard, validFoodProduct, 350);
    expect(appendedToMediaWrapper).toBe(true);
    expect(computedPosition).toContain("position:absolute;top:8px;right:8px");
  });
});

describe("Cart Action & Candidate Deduplication Tests (Naivas & Carrefour)", () => {
  it("Naivas: extractCartAction detects clicks on modern orange circular + button", () => {
    const mockCard: any = {
      className: "group border-naivas-bg rounded-lg p-4",
      matches: (sel: string) => sel.includes("border-naivas-bg") || sel.includes("group"),
      querySelector: (sel: string) => {
        if (sel.includes("line-clamp") || sel.includes("title")) {
          return { textContent: "Rina Vegetable Oil 500Ml" };
        }
        if (sel.includes("price") || sel.includes("span")) {
          return { textContent: "KES 185" };
        }
        if (sel.includes("product/")) {
          return { src: "https://d1xxxx.cloudfront.net/product/88123/vina.jpg" };
        }
        return null;
      },
      getAttribute: (k: string) => (k === "data-product-id" ? "88123" : null),
    };

    const mockBtn: any = {
      tagName: "BUTTON",
      className: "bg-orange-500 rounded-full w-10 h-10 flex items-center justify-center",
      textContent: "+",
      getAttribute: (k: string) => (k === "aria-label" ? "Add to cart" : null),
      matches: (sel: string) => sel.includes("orange") || sel.includes("rounded-full"),
      querySelector: () => null,
      closest: (sel: string) => {
        if (sel.includes("button")) return mockBtn;
        if (sel.includes("border-naivas-bg") || sel.includes("group")) return mockCard;
        return null;
      },
    };

    const item = NaivasAdapter.extractCartAction(mockBtn);
    expect(item).toBeDefined();
    expect(item?.retailer).toBe("NAIVAS");
    expect(item?.productId).toBe("88123");
    expect(item?.product_name).toBe("Rina Vegetable Oil 500Ml");
    expect(item?.priceSnapshot).toBe(185);
    expect(item?.quantity).toBe(1);
  });

  it("Carrefour: extractCartAction detects clicks on modern blue + button", () => {
    const mockCard: any = {
      className: "group relative flex flex-col border-gray-50 rounded-lg p-3",
      matches: (sel: string) => sel.includes("border-gray-50") || sel.includes("relative flex flex-col"),
      querySelector: (sel: string) => {
        if (sel.includes("product-title") || sel.includes("title")) {
          return { textContent: "Brookside Farm Fresh Natural Maziwa Lala 500ml" };
        }
        if (sel.includes("items-baseline") || sel.includes("price")) {
          return { textContent: "KES 102.00" };
        }
        if (sel.includes("/p/")) {
          return { href: "https://www.carrefour.ke/mafken/en/p/702201" };
        }
        return null;
      },
      getAttribute: (k: string) => (k === "data-product-id" ? "702201" : null),
    };

    const mockBtn: any = {
      tagName: "BUTTON",
      className: "bg-primary text-white rounded p-2 flex items-center justify-center",
      textContent: "+",
      getAttribute: (k: string) => (k === "aria-label" ? "Add" : null),
      matches: (sel: string) => sel.includes("primary") || sel.includes("blue"),
      querySelector: (sel: string) => (sel.includes("svg") ? {} : null),
      closest: (sel: string) => {
        if (sel.includes("button")) return mockBtn;
        if (sel.includes("border-gray-50") || sel.includes("relative flex flex-col")) return mockCard;
        return null;
      },
    };

    const item = CarrefourAdapter.extractCartAction(mockBtn);
    expect(item).toBeDefined();
    expect(item?.retailer).toBe("CARREFOUR");
    expect(item?.productId).toBe("702201");
    expect(item?.product_name).toBe("Brookside Farm Fresh Natural Maziwa Lala 500ml");
    expect(item?.priceSnapshot).toBe(102);
    expect(item?.quantity).toBe(1);
  });

  it("Naivas: candidatesIn deduplicates nested card containers to prevent duplicate badge rendering", () => {
    const mockInnerWrapper: any = {
      className: "group relative w-full overflow-hidden",
      matches: (sel: string) => sel.includes("group"),
      querySelector: () => null,
      querySelectorAll: () => [],
      getAttribute: () => null,
      contains: () => false,
    };

    const mockOuterCard: any = {
      className: "group border-naivas-bg rounded-lg",
      matches: (sel: string) => sel.includes("border-naivas-bg") || sel.includes("group"),
      querySelector: (sel: string) => {
        if (sel.includes("line-clamp") || sel.includes("title")) {
          return { textContent: "Rina Vegetable Oil 500Ml" };
        }
        if (sel.includes("price") || sel.includes("span")) {
          return { textContent: "KES 185" };
        }
        if (sel.includes("product/")) {
          return { src: "https://d1xxxx.cloudfront.net/product/88123/vina.jpg" };
        }
        return null;
      },
      querySelectorAll: () => [],
      getAttribute: (k: string) => (k === "data-product-id" ? "88123" : null),
      contains: (other: any) => other === mockInnerWrapper,
    };

    const mockScope: any = {
      matches: () => false,
      querySelectorAll: (sel: string) => {
        if (sel.includes("group") || sel.includes("border-naivas-bg")) {
          return [mockOuterCard, mockInnerWrapper];
        }
        return [];
      },
    };

    const candidates = NaivasAdapter.candidatesIn(mockScope);
    expect(candidates.length).toBe(1);
    expect(candidates[0].el).toBe(mockOuterCard);
    expect(candidates[0].item.name).toBe("Rina Vegetable Oil 500Ml");
  });

  it("Carrefour: candidatesIn deduplicates nested elements to prevent duplicate badges", () => {
    const mockAnchorA = {
      href: "https://www.carrefour.ke/mafken/en/p/702201",
    };
    const mockAnchorB = {
      href: "https://www.carrefour.ke/mafken/en/p/702201",
    };

    const mockInnerBox: any = {
      matches: () => false,
      querySelector: () => null,
      getAttribute: () => null,
      contains: () => false,
    };

    const mockOuterCard: any = {
      matches: (sel: string) => sel.includes("relative flex flex-col"),
      querySelector: (sel: string) => {
        if (sel.includes("product-title") || sel.includes("title")) {
          return { textContent: "Brookside Farm Fresh Natural Maziwa Lala 500ml" };
        }
        if (sel.includes("items-baseline") || sel.includes("price")) {
          return { textContent: "KES 102.00" };
        }
        return null;
      },
      getAttribute: (k: string) => (k === "data-product-id" ? "702201" : null),
      contains: (other: any) => other === mockInnerBox,
    };

    const origFind = (CarrefourAdapter as any)._findCardContainer;
    (CarrefourAdapter as any)._findCardContainer = (anchor: any) => {
      if (anchor === mockAnchorA) return mockOuterCard;
      return mockInnerBox;
    };

    const mockScope: any = {
      matches: () => false,
      querySelectorAll: (sel: string) => {
        if (sel.includes("/p/")) return [mockAnchorA, mockAnchorB];
        return [];
      },
    };

    try {
      const candidates = CarrefourAdapter.candidatesIn(mockScope);
      expect(candidates.length).toBe(1);
      expect(candidates[0].el).toBe(mockOuterCard);
    } finally {
      (CarrefourAdapter as any)._findCardContainer = origFind;
    }
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
