/**
 * db/settings.ts
 *
 * User settings read/write, premium token verification, product cache management
 * and dataset import. Extracted from db.ts (SMELL-002 refactor).
 */
import { getDB, SCORING_VERSION } from "./shared";
import type { CatalogMeta } from "./shared";
import { memCache, memCacheVersion, normalizedIndexCache, lowerIndexCache } from "./product-resolution";


// User preferences and unified profile settings.
export interface Settings {
  diabetes: boolean;
  hypertension: boolean;
  kidney: boolean;
  obesity: boolean;
  profileName: string;
  primaryMetric: string;
  condition: string;
  initials: string;
  activeTheme: "diabetes" | "hypertension" | "kidney" | "obesity" | "general";
  // NOTE: isPremium is NO LONGER read from settings.
  // Entitlement is resolved via NutriEntitlement.resolveTier() in the service worker.
}

export const DEFAULT_SETTINGS: Settings = {
  diabetes: true,
  hypertension: true,
  kidney: true,
  obesity: true,
  profileName: "Guest",
  primaryMetric: "Sugar",
  condition: "healthy",
  initials: "GU",
  activeTheme: "general",
};


const SETTINGS_KEY = "warning-modules";

async function verifyPremiumToken(token: any): Promise<boolean> {
  if (typeof token !== 'string') return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const payloadStr = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadStr);
    if (!payload.premium) return false;
    if (payload.exp && Date.now() / 1000 > payload.exp) return false;

    const publicJwk = {"key_ops":["verify"],"ext":true,"kty":"EC","x":"iGdGHv1MpFC6CvvScN9quisbaABLwgeCydOEF1Y1bxs","y":"WCv5cEgn5uLog39E6utrs6DZ-PLQmKAoFt7t0m685Xk","crv":"P-256"};
    const key = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);

    const signatureStr = atob(parts[2].replace(/-/g, '+').replace(/_/g, '/'));
    const signature = new Uint8Array(signatureStr.length);
    for (let i = 0; i < signatureStr.length; i++) signature[i] = signatureStr.charCodeAt(i);

    const dataToVerify = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, dataToVerify);
  } catch (_e) {
    return false;
  }
}

export async function getSettings(): Promise<Settings> {
  const db = await getDB();
  const tx = db.transaction("user_settings", "readonly");
  const [
    diabetes, hypertension, kidney, obesity,
    profileName, primaryMetric, condition, initials, activeTheme,
  ] = await Promise.all([
    tx.store.get("diabetes"), tx.store.get("hypertension"), tx.store.get("kidney"), tx.store.get("obesity"),
    tx.store.get("profileName"), tx.store.get("primaryMetric"), tx.store.get("condition"), tx.store.get("initials"),
    tx.store.get("activeTheme"),
  ]);
  return {
    ...DEFAULT_SETTINGS,
    diabetes:      diabetes      ?? true,
    hypertension:  hypertension  ?? true,
    kidney:        kidney        ?? true,
    obesity:       obesity       ?? true,
    profileName:   profileName   || "",
    primaryMetric: primaryMetric || "Sugar",
    condition:     condition     || "healthy",
    initials:      initials      || "",
    activeTheme:   activeTheme   || "general",
  };
}


export async function saveSettings(settings: Settings): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("user_settings", "readwrite");
  await tx.store.put(settings.diabetes, "diabetes");
  await tx.store.put(settings.hypertension, "hypertension");
  await tx.store.put(settings.kidney, "kidney");
  await tx.store.put(settings.obesity, "obesity");
  await tx.store.put(settings.profileName, "profileName");
  await tx.store.put(settings.primaryMetric, "primaryMetric");
  await tx.store.put(settings.condition, "condition");
  await tx.store.put(settings.initials, "initials");
  await tx.store.put(settings.activeTheme, "activeTheme");
  await tx.done;
}


// Increment whenever scoring logic changes (Gate 2 policy, FSA table mapping, etc.).
// v4 = thin-client migration (P4).

export async function getCachedProduct(id: string): Promise<any> {
  const db = await getDB();
  const cached = await db.get("product_cache", id);
  if (!cached) return null;

  if (cached.scoringVersion !== SCORING_VERSION) return null;

  const retailer = cached.retailer || "NAIVAS";
  const metadata = await db.get("dataset_metadata", retailer);
  const currentVersion = metadata ? metadata.datasetVersion : "v2.0.0";

  if (cached.datasetVersion === currentVersion) {
    return cached;
  }
  return null;
}

async function cacheProduct(id: string, product: any): Promise<void> {
  const db = await getDB();
  product.cachedAt = Date.now();
  product.scoringVersion = SCORING_VERSION;

  const retailer = product.retailer || "NAIVAS";
  const metadata = await db.get("dataset_metadata", retailer);
  product.datasetVersion = metadata ? metadata.datasetVersion : "v2.0.0";

  await db.put("product_cache", product, id);
}

/**
 * Evicts product_cache entries older than 7 days.
 * Called by the chrome.alarms "cache-eviction" handler in background.js —
 * NOT from inside the hot cacheProduct() write path.
 */
export async function evictStaleCacheEntries(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("product_cache", "readwrite");
  let cursor = await tx.store.openCursor();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let evicted = 0;
  while (cursor) {
    if (!cursor.value.cachedAt || cursor.value.cachedAt < sevenDaysAgo) {
      await cursor.delete();
      evicted++;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  if (evicted > 0) {
    console.log(`[NutriScoreDB] Cache eviction: removed ${evicted} stale product_cache entries.`);
  }
}

// Purge every store. Resolves fast (well under 1s) for the erasure flow.
export async function purgeAll(): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.clear("shopping_ledger"),
    db.clear("product_cache")
  ]);
}

// Implement NutriScoreDB methods for background.js
export async function saveProduct(key: string, result: any): Promise<void> {
  await cacheProduct(key, result);
}

export async function savePrice(productId: string | number, price: number): Promise<void> {
  if (!productId || price == null) return;
  const db = await getDB();
  await db.put("price_cache", price, String(productId));
}

/**
 * Read a product's premium assessment from IndexedDB.
 */
export async function getPremiumAssessment(retailer: string, productId: string): Promise<any | null> {
  const db = await getDB();
  const key = `${retailer}|${productId}`;
  const row = await db.get("premium_assessments", key);
  return row ? row.assessments : null;
}

/**
 * Clear all premium assessment data from IndexedDB.
 * Called by NutriEntitlement.clear() when user downgrades or signs out.
 */
export async function clearPremium(): Promise<void> {
  const db = await getDB();
  await db.clear("premium_assessments");
}

/**
 * Read catalog metadata from dataset_metadata["_catalog"].
 */
export async function getCatalogMeta(): Promise<CatalogMeta | null> {
  const db = await getDB();
  return (await db.get("dataset_metadata", "_catalog")) as CatalogMeta | null;
}

/**
 * Write catalog metadata.
 */
export async function putCatalogMeta(meta: CatalogMeta): Promise<void> {
  const db = await getDB();
  await db.put("dataset_metadata", meta);
}

// importDatasets removed in P4: catalog now synced from Supabase via catalog-sync.js.
// Legacy call sites in background.js are replaced by NutriCatalogSync.ensureReady().
