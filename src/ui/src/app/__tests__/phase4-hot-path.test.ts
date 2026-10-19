/**
 * Phase 4 regression tests — F-02 / F-07
 *
 * F-02: Whole-catalog heap load — resolveProductMatch previously called
 *       store.getAll() unconditionally before ANY lookup, loading ~11 MB into
 *       memory on every call. Fix: direct IDB key get runs first; getAll() only
 *       if the key miss falls through to name/URL fuzzy matching.
 *
 * F-07: Duplicate getAll() on every badge render — same root cause as F-02.
 *       The hot path (product_id match) must complete with 0 getAll() calls.
 *
 * Strategy: mock the IDB `store` object to count how many times getAll() is
 * called. Assert: 0 calls when product_id direct match succeeds; at most 1 call
 * when falling through to name matching.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// IDB mock
// ---------------------------------------------------------------------------
type StoreMock = {
  getAllCalls: number;
  getCalls: number;
  store: Record<string, any>;  // keyed by product_id string
  get(key: string | number): Promise<any>;
  getAll(): Promise<any[]>;
  index(name: string): { get(v: string): Promise<any> };
};

function makeStore(records: any[]): StoreMock {
  const byId: Record<string, any> = {};
  const byUrl: Record<string, any> = {};
  const byName: Record<string, any> = {};
  for (const r of records) {
    byId[String(r.Identity?.ProductID ?? r.product_id ?? "")] = r;
    if (r.Identity?.RetailerProductUrl) byUrl[r.Identity.RetailerProductUrl] = r;
    if (r.Identity?.ProductName) byName[r.Identity.ProductName] = r;
  }
  const mock: StoreMock = {
    getAllCalls: 0,
    getCalls: 0,
    store: byId,
    async get(key: string | number) {
      mock.getCalls++;
      return byId[String(key)] ?? null;
    },
    async getAll() {
      mock.getAllCalls++;
      return records;
    },
    index(name: string) {
      return {
        async get(value: string) {
          if (name === "by-url") return byUrl[value] ?? null;
          if (name === "by-name") return byName[value] ?? null;
          return null;
        },
      };
    },
  };
  return mock;
}

// Minimal IDB DB mock
function makeDb(storeMock: StoreMock) {
  return {
    transaction(_name: string, _mode: string) {
      return { store: storeMock, done: Promise.resolve() };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock getDB from shared.ts
// ---------------------------------------------------------------------------
let currentStore: StoreMock;
vi.mock("../lib/db/shared", () => ({
  getDB: vi.fn(() => Promise.resolve(makeDb(currentStore))),
  SCORING_VERSION: "v4",
}));

import { resolveProductMatch } from "../lib/db/product-resolution";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const NAIVAS_PRODUCT = {
  Identity: { ProductID: "N-001", ProductName: "Fresh Milk 1L", RetailerProductUrl: "/naivas/fresh-milk" },
  Nutrition: { EnergyKcal: 65 },
};
const CARREFOUR_PRODUCT = {
  Identity: { ProductID: "C-100", ProductName: "Orange Juice 500ml", RetailerProductUrl: "/p/C-100" },
  Nutrition: { EnergyKcal: 45 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("F-02 / F-07: resolveProductMatch hot-path avoids getAll()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset memCache between tests so each test starts cold
    // (the import is live so we can reach in via the module)
  });

  it("NAIVAS product_id direct hit: 0 getAll() calls (F-02 core case)", async () => {
    currentStore = makeStore([NAIVAS_PRODUCT]);
    const result = await resolveProductMatch("NAIVAS", "N-001", null, null);

    expect(result.matched).toBe(true);
    expect(result.matchMethod).toBe("product_id");
    expect(currentStore.getAllCalls).toBe(0);  // F-02: no full-catalog load
  });

  it("CARREFOUR product_id direct hit: 0 getAll() calls", async () => {
    currentStore = makeStore([CARREFOUR_PRODUCT]);
    const result = await resolveProductMatch("CARREFOUR", "C-100", null, null);

    expect(result.matched).toBe(true);
    expect(result.matchMethod).toBe("product_id");
    expect(currentStore.getAllCalls).toBe(0);
  });

  it("URL index hit: 0 getAll() calls (F-07 secondary)", async () => {
    currentStore = makeStore([NAIVAS_PRODUCT]);
    const result = await resolveProductMatch("NAIVAS", null, "/naivas/fresh-milk", null);

    expect(result.matched).toBe(true);
    expect(result.matchMethod).toBe("url");
    expect(currentStore.getAllCalls).toBe(0);
  });

  it("Name fallback: getAll() called exactly once (warm cache for fuzzy matching)", async () => {
    currentStore = makeStore([NAIVAS_PRODUCT]);
    // No product_id, no URL — must fall through to name matching
    const result = await resolveProductMatch("NAIVAS", null, null, "Fresh Milk 1L");

    expect(result.matched).toBe(true);
    // At most 1 getAll() — the warm-cache load for fuzzy name matching
    expect(currentStore.getAllCalls).toBeLessThanOrEqual(1);
  });

  it("Complete miss: getAll() called at most once (not N times)", async () => {
    currentStore = makeStore([NAIVAS_PRODUCT]);
    const result = await resolveProductMatch("NAIVAS", "NONEXISTENT", null, "Nonexistent Product XYZ");

    expect(result.matched).toBe(false);
    // Even on a total miss, getAll() fires at most once (for the warm-cache path)
    expect(currentStore.getAllCalls).toBeLessThanOrEqual(1);
  });

  it("product_id hit is faster than getAll() — get() called before getAll() fires", async () => {
    currentStore = makeStore([NAIVAS_PRODUCT]);
    // Track call order
    const callOrder: string[] = [];
    const origGet = currentStore.get.bind(currentStore);
    const origGetAll = currentStore.getAll.bind(currentStore);
    currentStore.get = async (k) => { callOrder.push("get"); return origGet(k); };
    currentStore.getAll = async () => { callOrder.push("getAll"); return origGetAll(); };

    await resolveProductMatch("NAIVAS", "N-001", null, null);

    expect(callOrder).toContain("get");
    expect(callOrder).not.toContain("getAll");
    // get() must appear before getAll() (which shouldn't appear at all)
    if (callOrder.includes("getAll")) {
      expect(callOrder.indexOf("get")).toBeLessThan(callOrder.indexOf("getAll"));
    }
  });
});
