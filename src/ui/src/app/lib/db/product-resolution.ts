/**
 * db/product-resolution.ts
 *
 * Product lookup, name normalisation, NME v2 batch resolution (M1–M5 cascade)
 * and index management against IndexedDB product stores.
 * Reference: Blueprint §2.2 (C4; E-11, E-12, ADR-9)
 * Flag: ns.nme.v2
 */
import { getDB } from "./shared";

export type RetailerCode = "CARREFOUR" | "NAIVAS" | "QUICKMART";

export interface Observation {
  retailer: RetailerCode | string;
  sku: string | null;
  gtin: string | null;
  url: string | null;
  name: string | null;
  sizeText?: string | null;
  price_minor?: number | null;
}

export interface Resolution {
  productId: string | null;
  method: "M1" | "M2" | "M3" | "M4" | "M5" | null;
  p: number;
  reason?: "no_candidate" | "ambiguous" | "below_threshold";
  product?: any;
}

// ── Bounded LRU Cache for Resolved Product Records (Capacity 256) ─────────────
export class BoundedLru<K, V> {
  private capacity: number;
  private map = new Map<K, V>();

  constructor(capacity = 256) {
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export const productRecordLru = new BoundedLru<string, any>(256);

// ── Legacy In-Memory Cache (Retained for ns.nme.v2 = false) ───────────────────
export const memCache: { carrefour: any[] | null; naivas: any[] | null; quickmart: any[] | null } = {
  carrefour: null,
  naivas: null,
  quickmart: null,
};

export const memCacheVersion: { carrefour: string | null; naivas: string | null; quickmart: string | null } = {
  carrefour: null,
  naivas: null,
  quickmart: null,
};

export const normalizedIndexCache: { carrefour: Map<string, any> | null; naivas: Map<string, any> | null; quickmart: Map<string, any> | null } = {
  carrefour: null,
  naivas: null,
  quickmart: null,
};

export const lowerIndexCache: { carrefour: Map<string, any> | null; naivas: Map<string, any> | null; quickmart: Map<string, any> | null } = {
  carrefour: null,
  naivas: null,
  quickmart: null,
};

// ── Feature Flag Evaluation ───────────────────────────────────────────────────
export function isNmeV2Enabled(): boolean {
  if (typeof self !== "undefined" && (self as any).NutriFlags?.isEnabled) {
    return Boolean((self as any).NutriFlags.isEnabled("ns.nme.v2"));
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).__NUTRI_FLAGS__?.["ns.nme.v2"] !== undefined) {
    return Boolean((globalThis as any).__NUTRI_FLAGS__["ns.nme.v2"]);
  }
  return false;
}

// ── Normalization & Feature Extraction Helpers ─────────────────────────────────

export function normalizeProductName(name: string): string {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/\s*p[/\s]*kg\b/g, " ")
    .replace(/\s*pack\b/g, " ")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extracts normalized numeric size in grams or milliliters */
export function extractSize(text: string | null | undefined): { value: number | null; unit: string | null } {
  if (!text) return { value: null, unit: null };
  const m = text.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|ltr|cl|gm|oz)\b/i);
  if (!m) return { value: null, unit: null };
  const num = parseFloat(m[1]);
  const rawUnit = m[2].toLowerCase();
  if (rawUnit === "kg") return { value: Math.round(num * 1000), unit: "g" };
  if (rawUnit === "g" || rawUnit === "gm") return { value: Math.round(num), unit: "g" };
  if (rawUnit === "l" || rawUnit === "ltr") return { value: Math.round(num * 1000), unit: "ml" };
  if (rawUnit === "cl") return { value: Math.round(num * 10), unit: "ml" };
  if (rawUnit === "ml") return { value: Math.round(num), unit: "ml" };
  return { value: Math.round(num), unit: rawUnit };
}

/** Discretizes package size into blocking buckets */
export function getSizeBucket(size: { value: number | null; unit: string | null }): string {
  if (!size.value) return "unknown";
  const val = size.value;
  if (val < 100) return "<100";
  if (val <= 250) return "100-250";
  if (val <= 500) return "250-500";
  if (val <= 1000) return "500-1000";
  return ">1000";
}

/** Extracts candidate brand from product name or explicit brand field */
export function extractBrand(name: string | null, explicitBrand?: string | null): string {
  if (explicitBrand && explicitBrand.trim()) {
    return explicitBrand.toLowerCase().trim();
  }
  if (!name) return "unknown";
  const tokens = name.trim().split(/\s+/);
  return tokens[0]?.toLowerCase() || "unknown";
}

/** Extracts safe URL slug without regular expressions or URL constructor loops */
export function extractUrlSlug(url: string | null): string | null {
  if (!url) return null;
  try {
    const clean = url.split("?")[0].split("#")[0];
    const pathSegments = clean.split("/").filter(Boolean);
    if (pathSegments.length === 0) return null;

    // Check for Carrefour /p/<id>
    const pIdx = pathSegments.indexOf("p");
    if (pIdx !== -1 && pathSegments[pIdx + 1]) {
      return pathSegments[pIdx + 1];
    }

    // Quickmart / Naivas slug: last segment stripped of trailing branch id (-3, -36)
    const last = pathSegments[pathSegments.length - 1];
    return last.replace(/-\d+$/, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Token set Jaccard similarity for M4 scoring */
export function computeTokenSetSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const setA = new Set(normalizeProductName(a).split(" ").filter(t => t.length > 1));
  const setB = new Set(normalizeProductName(b).split(" ").filter(t => t.length > 1));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function buildK3Key(retailer: string, brand: string, normName: string, size: { value: number | null; unit: string | null }): string {
  const sizeStr = size.value ? `${size.value}${size.unit || ""}` : "nosize";
  return `k3:${retailer.toUpperCase()}:${brand}:${normName}:${sizeStr}`;
}

export function buildBlkKey(retailer: string, brand: string, sizeBucket: string): string {
  return `blk:${retailer.toUpperCase()}:${brand}:${sizeBucket}`;
}

export function buildNmeIndexForProduct(retailer: string, p: any): Array<{ key: string; value: any }> {
  const entries: Array<{ key: string; value: any }> = [];
  const ret = retailer.toUpperCase();
  const identity = p.Identity || {};
  const prodId = identity.ProductID || p.productId || p.id;
  if (!prodId) return entries;

  // 1. SKU index
  const sku = identity.RetailerProductId || identity.ProductID;
  if (sku) {
    entries.push({ key: `sku:${ret}:${String(sku)}`, value: { product_id: String(prodId) } });
  }

  // 2. URL slug index
  const url = identity.RetailerProductUrl || p.url;
  const slug = extractUrlSlug(url);
  if (slug && slug !== String(sku)) {
    entries.push({ key: `sku:${ret}:${slug}`, value: { product_id: String(prodId) } });
  }

  // 3. GTIN / Barcode index
  const gtin = identity.Barcode || identity.GTIN || p.gtin || p.barcode;
  if (gtin) {
    entries.push({ key: `gtin:${String(gtin).trim()}`, value: { product_id: String(prodId) } });
  }

  // 4. Deterministic K3 index
  const rawName = identity.ProductName || p.name || "";
  const normName = normalizeProductName(rawName);
  const brand = extractBrand(rawName, identity.Brand || p.brand);
  const size = extractSize(identity.PackageSize || p.package_size || rawName);
  const k3 = buildK3Key(ret, brand, normName, size);
  entries.push({ key: k3, value: { product_id: String(prodId) } });

  // 5. Blocking BLK key
  const bucket = getSizeBucket(size);
  const blk = buildBlkKey(ret, brand, bucket);
  entries.push({ key: blk, value: { product_id: String(prodId), is_blk: true } });

  return entries;
}

// ── NME v2 Batch Resolution (M1–M5 Cascade) ───────────────────────────────────

export async function resolveBatch(
  retailer: RetailerCode | string,
  observations: Observation[]
): Promise<Resolution[]> {
  if (!observations || observations.length === 0) return [];

  const db = await getDB();
  const ret = (retailer || "NAIVAS").toUpperCase();
  const storeName = ret === "CARREFOUR" ? "carrefourProducts" : ret === "QUICKMART" ? "quickmartProducts" : "naivasProducts";

  const hasNmeIndex = db.objectStoreNames.contains("nme_index");

  // Single read-only transaction for the whole batch
  const storesToRead: any[] = hasNmeIndex ? ["nme_index", storeName] : [storeName];
  const tx = db.transaction(storesToRead, "readonly");
  const indexStore = hasNmeIndex ? tx.objectStore("nme_index" as any) : null;
  const productStore = tx.objectStore(storeName as any);

  const fetchProduct = async (id: string | number): Promise<any> => {
    const key = `${ret}:${id}`;
    const cached = productRecordLru.get(key);
    if (cached) return cached;
    let prod = await productStore.get(id);
    if (!prod && typeof id === "string" && !isNaN(Number(id))) {
      prod = await productStore.get(Number(id));
    }
    if (prod) productRecordLru.set(key, prod);
    return prod;
  };

  const resolutions: Resolution[] = [];

  for (const obs of observations) {
    let resolved: Resolution | null = null;

    // ── M1: GTIN exact (p = 0.99) ──
    if (obs.gtin && indexStore) {
      const gtinHit = await indexStore.get(`gtin:${obs.gtin.trim()}`);
      if (gtinHit?.product_id) {
        const prod = await fetchProduct(gtinHit.product_id);
        if (prod) {
          resolved = { productId: String(gtinHit.product_id), method: "M1", p: 0.99, product: prod };
        }
      }
    }

    // ── M2: Retailer SKU or URL slug (p = 0.99) ──
    if (!resolved && obs.sku) {
      if (indexStore) {
        const skuHit = await indexStore.get(`sku:${ret}:${obs.sku}`);
        if (skuHit?.product_id) {
          const prod = await fetchProduct(skuHit.product_id);
          if (prod) {
            resolved = { productId: String(skuHit.product_id), method: "M2", p: 0.99, product: prod };
          }
        }
      }
      if (!resolved) {
        const prod = await fetchProduct(obs.sku);
        if (prod) {
          resolved = { productId: String(obs.sku), method: "M2", p: 0.99, product: prod };
        }
      }
    }

    if (!resolved && obs.url) {
      const slug = extractUrlSlug(obs.url);
      if (slug && indexStore) {
        const slugHit = await indexStore.get(`sku:${ret}:${slug}`);
        if (slugHit?.product_id) {
          const prod = await fetchProduct(slugHit.product_id);
          if (prod) {
            resolved = { productId: String(slugHit.product_id), method: "M2", p: 0.99, product: prod };
          }
        }
      }
      if (!resolved && (productStore.indexNames as any).contains("by-url")) {
        const urlHit = await (productStore as any).index("by-url").get(obs.url);
        if (urlHit) {
          const id = urlHit.Identity?.ProductID || urlHit.productId;
          resolved = { productId: String(id), method: "M2", p: 0.99, product: urlHit };
        }
      }
    }

    // ── M3: Deterministic K3 key (p = 0.99) ──
    if (!resolved && obs.name && indexStore) {
      const normName = normalizeProductName(obs.name);
      const brand = extractBrand(obs.name);
      const size = extractSize(obs.sizeText || obs.name);
      const k3Key = buildK3Key(ret, brand, normName, size);
      const k3Hit = await indexStore.get(k3Key);
      if (k3Hit?.product_id) {
        const prod = await fetchProduct(k3Hit.product_id);
        if (prod) {
          resolved = { productId: String(k3Hit.product_id), method: "M3", p: 0.99, product: prod };
        }
      }
    }

    // ── M4: Candidates from blocking key scored by token similarity & size/brand agreement ──
    if (!resolved && obs.name && indexStore) {
      const brand = extractBrand(obs.name);
      const size = extractSize(obs.sizeText || obs.name);
      const bucket = getSizeBucket(size);
      const blkKey = buildBlkKey(ret, brand, bucket);
      const blkHit = await indexStore.get(blkKey);
      const candidateIds: string[] = blkHit?.product_ids || [];

      if (candidateIds.length > 0) {
        let bestProd: any = null;
        let bestScore = 0;

        const cappedCandidates = candidateIds.slice(0, 200);
        for (const cid of cappedCandidates) {
          const cand = await fetchProduct(cid);
          if (!cand) continue;
          const candName = cand.Identity?.ProductName || cand.name || "";
          const tokenSim = computeTokenSetSimilarity(obs.name, candName);
          const candSize = extractSize(cand.Identity?.PackageSize || candName);
          const sizeAgreement = (size.value && candSize.value && size.value === candSize.value) ? 1.0 : (size.value && candSize.value) ? 0.3 : 0.7;
          const candBrand = extractBrand(candName, cand.Identity?.Brand);
          const brandAgreement = brand === candBrand ? 1.0 : 0.5;

          const combined = 0.6 * tokenSim + 0.25 * sizeAgreement + 0.15 * brandAgreement;
          if (combined > bestScore) {
            bestScore = combined;
            bestProd = cand;
          }
        }

        if (bestScore >= 0.92 && bestProd) {
          resolved = {
            productId: String(bestProd.Identity?.ProductID || bestProd.productId),
            method: "M4",
            p: Math.min(0.98, Number(bestScore.toFixed(3))),
            product: bestProd,
          };
        } else if (bestScore >= 0.80 && bestProd) {
          resolved = {
            productId: String(bestProd.Identity?.ProductID || bestProd.productId),
            method: "M4",
            p: Math.min(0.91, Number(bestScore.toFixed(3))),
            product: bestProd,
          };
        } else if (bestScore > 0) {
          resolved = {
            productId: null,
            method: "M4",
            p: Number(bestScore.toFixed(3)),
            reason: "below_threshold",
          };
        }
      }
    }

    // ── M5: Category fallback / Unresolved ──
    if (!resolved) {
      resolved = {
        productId: null,
        method: null,
        p: 0,
        reason: "no_candidate",
      };
    }

    resolutions.push(resolved);
  }

  await tx.done;
  return resolutions;
}

// ── Rebuild NME Index from Existing Product Stores ─────────────────────────────

export async function rebuildNmeIndex(database?: any): Promise<number> {
  const db = database || await getDB();
  if (!db.objectStoreNames.contains("nme_index")) return 0;

  let totalIndexed = 0;
  const retailers: Array<{ code: RetailerCode; store: string }> = [
    { code: "CARREFOUR", store: "carrefourProducts" },
    { code: "NAIVAS", store: "naivasProducts" },
    { code: "QUICKMART", store: "quickmartProducts" },
  ];

  for (const { code, store } of retailers) {
    if (!db.objectStoreNames.contains(store)) continue;
    const readTx = db.transaction(store, "readonly");
    const products = await readTx.store.getAll();
    await readTx.done;

    if (!products || products.length === 0) continue;

    const blkMap = new Map<string, Set<string>>();
    const singleEntries: Array<{ key: string; value: any }> = [];

    for (const p of products) {
      const entries = buildNmeIndexForProduct(code, p);
      for (const e of entries) {
        if (e.value?.is_blk) {
          if (!blkMap.has(e.key)) blkMap.set(e.key, new Set());
          blkMap.get(e.key)!.add(e.value.product_id);
        } else {
          singleEntries.push(e);
        }
      }
    }

    const writeTx = db.transaction("nme_index", "readwrite");
    for (const e of singleEntries) {
      writeTx.store.put(e);
      totalIndexed++;
    }
    for (const [blkKey, idSet] of blkMap.entries()) {
      writeTx.store.put({ key: blkKey, product_ids: Array.from(idSet) });
      totalIndexed++;
    }
    await writeTx.done;
  }

  return totalIndexed;
}

// ── Primary Resolver & Backward-Compatible Facade ─────────────────────────────

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

export async function resolveProductMatch(
  retailer: string,
  retailerProductId: string | null,
  url: string | null,
  productName: string | null
): Promise<{ matched: boolean; matchMethod: string; confidence: string; reason?: string; product?: any }> {
  // NME v2 execution branch behind ns.nme.v2 flag
  if (isNmeV2Enabled()) {
    const obs: Observation = {
      retailer: retailer as RetailerCode,
      sku: retailerProductId,
      gtin: null,
      url,
      name: productName,
      sizeText: null,
      price_minor: null,
    };
    const [res] = await resolveBatch(retailer as RetailerCode, [obs]);
    if (res && res.productId && res.product) {
      const conf = res.p >= 0.95 ? "high" : res.p >= 0.80 ? "medium" : "low";
      return {
        matched: true,
        matchMethod: res.method || "nme_v2",
        confidence: conf,
        product: res.product,
      };
    }
    return {
      matched: false,
      matchMethod: res?.method || "none",
      confidence: "none",
      reason: res?.reason || "No matching record found",
    };
  }

  // LEGACY(ns-p4): Legacy resolveProductMatch with in-memory memCache fallback
  const db = await getDB();
  const upper = retailer.toUpperCase();
  const isCarrefour = upper === "CARREFOUR";
  const isQuickmart = upper === "QUICKMART";
  const storeName = isCarrefour ? "carrefourProducts" : isQuickmart ? "quickmartProducts" : "naivasProducts";
  const cacheKey: "carrefour" | "naivas" | "quickmart" = isCarrefour ? "carrefour" : isQuickmart ? "quickmart" : "naivas";

  if (retailerProductId) {
    const hotTx = db.transaction(storeName as any, "readonly");
    let hit = await hotTx.store.get(retailerProductId);
    if (!hit && !isNaN(Number(retailerProductId))) {
      hit = await hotTx.store.get(Number(retailerProductId));
    }
    if (hit) return { matched: true, matchMethod: "product_id", confidence: "high", product: hit };
  }

  if (url) {
    const urlTx = db.transaction(storeName as any, "readonly");
    const urlHit = await (urlTx.store.index as any)("by-url").get(url);
    if (urlHit) return { matched: true, matchMethod: "url", confidence: "high", product: urlHit };
  }

  const tx = db.transaction(storeName as any, "readonly");
  const store = tx.store;

  if (!memCache[cacheKey]) memCache[cacheKey] = await store.getAll();
  const cacheArr = memCache[cacheKey]!;

  if (retailerProductId && isCarrefour) {
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`/p/${escapeRegExp(String(retailerProductId))}(?:\\?|/|$)`);
    const found = cacheArr.find(p => regex.test(p.Identity?.RetailerProductUrl || ""));
    if (found) {
      return { matched: true, matchMethod: "url_path_fragment", confidence: "high", product: found };
    }
  }

  if (url && isQuickmart) {
    const cleanSlug = (u: string) => {
      if (!u) return null;
      try {
        const parsed = new URL(u, "https://www.quickmart.co.ke");
        const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
        if (!path || path.startsWith("products/view/")) return null;
        return path.replace(/-\d+$/, "").toLowerCase();
      } catch {
        return null;
      }
    };
    const targetSlug = cleanSlug(url);
    if (targetSlug) {
      const found = cacheArr.find(p => cleanSlug(p.Identity?.RetailerProductUrl || "") === targetSlug);
      if (found) {
        return { matched: true, matchMethod: "url_slug", confidence: "high", product: found };
      }
    }
  }

  if (productName) {
    const nameTx = db.transaction(storeName as any, "readonly");
    const nameHit = await (nameTx.store.index as any)("by-name").get(productName);
    if (nameHit) return { matched: true, matchMethod: "exact_name", confidence: "medium", product: nameHit };

    const lower = productName.toLowerCase().trim();
    if (!lowerIndexCache[cacheKey]) lowerIndexCache[cacheKey] = buildLowerIndex(cacheArr);
    const lowerIdx = lowerIndexCache[cacheKey]!;
    const foundLower = lowerIdx.get(lower);
    if (foundLower) {
      return { matched: true, matchMethod: "case_insensitive_name", confidence: "medium", product: foundLower };
    }

    const normSearch = normalizeProductName(productName);
    if (normSearch) {
      if (!normalizedIndexCache[cacheKey]) normalizedIndexCache[cacheKey] = buildNormalizedIndex(cacheArr);
      const normIdx = normalizedIndexCache[cacheKey]!;
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
  const upper = retailer.toUpperCase();
  const isCarrefour = upper === "CARREFOUR";
  const isQuickmart = upper === "QUICKMART";
  const storeName = isCarrefour ? "carrefourProducts" : isQuickmart ? "quickmartProducts" : "naivasProducts";
  const cacheKey: "carrefour" | "naivas" | "quickmart" = isCarrefour ? "carrefour" : isQuickmart ? "quickmart" : "naivas";
  const tx = db.transaction(storeName as any, "readonly");
  const store = tx.store;
  if (!memCache[cacheKey]) memCache[cacheKey] = await store.getAll();
  const products = memCache[cacheKey]!;

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
