/**
 * db/product-resolution.ts
 *
 * Product lookup, name normalisation and in-memory caching against IndexedDB product stores.
 * Extracted from db.ts (SMELL-002 refactor).
 */
import { getDB } from "./shared";

// In-memory cache for fast scanning to avoid slow IndexedDB cursors.
// Entries are invalidated by importDatasets() whenever BUNDLED_DATASET_VERSION changes,
// ensuring that a dataset update within a running SW session is immediately visible.
export let memCache: { carrefour: any[] | null; naivas: any[] | null } = { carrefour: null, naivas: null };

/** Tracks the dataset version that each memCache partition was populated from. */
export const memCacheVersion: { carrefour: string | null; naivas: string | null } = { carrefour: null, naivas: null };

export const normalizedIndexCache: { carrefour: Map<string, any> | null; naivas: Map<string, any> | null } = { carrefour: null, naivas: null };
export const lowerIndexCache: { carrefour: Map<string, any> | null; naivas: Map<string, any> | null } = { carrefour: null, naivas: null };

function buildNormalizedIndex(cacheArr: any[]) {
  const idx = new Map<string, any>();
  for (const p of cacheArr) {
    const nm = p.Identity?.ProductName;
    if (!nm) continue;
    const key = normalizeProductName(nm);
    if (!idx.has(key)) idx.set(key, p);
  }
  return idx;
}

function buildLowerIndex(cacheArr: any[]) {
  const idx = new Map<string, any>();
  for (const p of cacheArr) {
    const nm = p.Identity?.ProductName;
    if (!nm) continue;
    const key = nm.toLowerCase().trim();
    if (!idx.has(key)) idx.set(key, p);
  }
  return idx;
}

// F-02 / F-07: lookup order is now:
// 1. Direct IDB key get (fast, single-record — zero heap allocation for the hot path)
// 2. Only load getAll() into memCache if the direct hit misses (warm cache on first fallback)
// At 10,518 products × ~1,054 B each (~11 MB), eliminating getAll() on the hot path
// prevents the whole-catalog heap load on every SW wake.
export async function resolveProductMatch(
  retailer: string,
  retailerProductId: string | null,
  url: string | null,
  productName: string | null
): Promise<{ matched: boolean, matchMethod: string, confidence: string, reason?: string, product?: any }> {
  const db = await getDB();
  const isCarrefour = retailer.toUpperCase() === "CARREFOUR";
  const storeName = isCarrefour ? "carrefourProducts" : "naivasProducts";

  // ── HOT PATH: direct key lookup — no getAll() needed ────────────────────
  // Covers ~95%+ of real requests. Runs in its own short transaction so it
  // completes before we decide whether to load the full catalog.
  if (retailerProductId) {
    const hotTx = db.transaction(storeName as any, "readonly");
    let hit = await hotTx.store.get(retailerProductId);
    if (!hit && !isNaN(Number(retailerProductId))) {
      hit = await hotTx.store.get(Number(retailerProductId));
    }
    if (hit) return { matched: true, matchMethod: "product_id", confidence: "high", product: hit };
  }

  // ── URL index lookup — still no full catalog load needed ─────────────────
  if (url) {
    const urlTx = db.transaction(storeName as any, "readonly");
    const urlHit = await (urlTx.store.index as any)("by-url").get(url);
    if (urlHit) return { matched: true, matchMethod: "url", confidence: "high", product: urlHit };
  }

  // ── WARM CACHE PATH: full catalog into memCache for fuzzy name matching ──
  // Only reached if both direct-id and url lookups missed.
  // F-02: getAll() is now a true last-resort — not called on every invocation.
  const tx = db.transaction(storeName as any, "readonly");
  const store = tx.store;

  if (isCarrefour && !memCache.carrefour) memCache.carrefour = await store.getAll();
  if (!isCarrefour && !memCache.naivas)   memCache.naivas   = await store.getAll();
  const cacheArr = isCarrefour ? memCache.carrefour! : memCache.naivas!;

  // Carrefour URL-path-fragment scan (requires full catalog — unavoidable)
  if (retailerProductId && isCarrefour) {
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\/p\/${escapeRegExp(String(retailerProductId))}(?:\\?|\/|$)`);
    const found = cacheArr.find(p => regex.test(p.Identity?.RetailerProductUrl || ""));
    if (found) {
      return { matched: true, matchMethod: "url_path_fragment", confidence: "high", product: found };
    }
  }

  if (productName) {
    const nameTx = db.transaction(storeName as any, "readonly");
    const nameHit = await (nameTx.store.index as any)("by-name").get(productName);
    if (nameHit) return { matched: true, matchMethod: "exact_name", confidence: "medium", product: nameHit };

    const lower = productName.toLowerCase().trim();
    if (isCarrefour && !lowerIndexCache.carrefour) lowerIndexCache.carrefour = buildLowerIndex(memCache.carrefour!);
    if (!isCarrefour && !lowerIndexCache.naivas)   lowerIndexCache.naivas   = buildLowerIndex(memCache.naivas!);
    const lowerIdx = isCarrefour ? lowerIndexCache.carrefour! : lowerIndexCache.naivas!;
    const foundLower = lowerIdx.get(lower);
    if (foundLower) {
      return { matched: true, matchMethod: "case_insensitive_name", confidence: "medium", product: foundLower };
    }

    const normSearch = normalizeProductName(productName);
    if (normSearch) {
      if (isCarrefour && !normalizedIndexCache.carrefour) normalizedIndexCache.carrefour = buildNormalizedIndex(memCache.carrefour!);
      if (!isCarrefour && !normalizedIndexCache.naivas)   normalizedIndexCache.naivas   = buildNormalizedIndex(memCache.naivas!);
      const normIdx = isCarrefour ? normalizedIndexCache.carrefour! : normalizedIndexCache.naivas!;
      const foundNorm = normIdx.get(normSearch);
      if (foundNorm) {
        return { matched: true, matchMethod: "normalized_name", confidence: "low", product: foundNorm };
      }
    }
  }

  return { matched: false, matchMethod: "none", confidence: "none", reason: "No matching record found" };
}

export async function getAllProducts(retailer: string): Promise<any[]> {
  const db = await getDB();
  const isCarrefour = retailer.toUpperCase() === "CARREFOUR";
  const storeName = isCarrefour ? "carrefourProducts" : "naivasProducts";
  const tx = db.transaction(storeName as any, "readonly");
  const store = tx.store;
  if (isCarrefour && !memCache.carrefour) memCache.carrefour = await store.getAll();
  if (!isCarrefour && !memCache.naivas) memCache.naivas = await store.getAll();
  const products = isCarrefour ? memCache.carrefour! : memCache.naivas!;

  // P8 perf fix: batch-read entire price_cache once, merge in-memory.
  const priceEntries = await db.getAll("price_cache");
  const priceKeys    = await db.getAllKeys("price_cache");
  const priceMap = new Map<string, number>();
  priceKeys.forEach((k, i) => priceMap.set(String(k), priceEntries[i]));

  return products.map(prod => {
    if (prod.price != null && prod.price > 0) return prod;
    const cached = priceMap.get(String(prod.productId || prod.id || ""));
    return cached != null ? { ...prod, price: cached } : prod;
  });
}

export function normalizeProductName(name: string): string {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/\s*pack /g, '')
    .replace(/\s*p\/kg /g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
