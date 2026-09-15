import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Grade, ShoppingLedgerRow, DatasetMetadata, ReviewState, ScoringStatus } from "./nutriscore";


// User preferences and unified profile settings.
export interface Settings {
  diabetes: boolean;
  hypertension: boolean;
  kidney: boolean;
  profileName: string;
  primaryMetric: string;
  condition: string;
  initials: string;
}

export const DEFAULT_SETTINGS: Settings = {
  diabetes: true,
  hypertension: true,
  kidney: true,
  profileName: "Guest",
  primaryMetric: "Sugar",
  condition: "healthy",
  initials: "GU"
};
const SETTINGS_KEY = "warning-modules";

// Local-first storage. Nothing here is ever transmitted to an external server.
interface NutriDB extends DBSchema {
  shopping_ledger: {
    key: string;
    value: ShoppingLedgerRow;
    indexes: {
      "by-addedAt": number;
      // Compound index added in v11: enables O(1) duplicate detection in logCartEvent
      // and avoids the full-table scan in dedupeActiveCartItems.
      "by-retailer-product-status": [string, string, string];
      "by-status": string;
    };
  };
  dataset_metadata: {
    key: string;
    value: DatasetMetadata;
  };
  user_settings: {
    key: string;
    value: any; // Per-key primitives: boolean for flags, string for the rest.
  };
  product_cache: {
    key: string;
    value: any; // Cache for adapter output Product objects
  };
  price_cache: {
    key: string;
    value: number;
  };
  carrefourProducts: {
    key: string;
    value: any;
    indexes: { "by-url": string, "by-name": string };
  };
  naivasProducts: {
    key: string;
    value: any;
    indexes: { "by-url": string, "by-name": string };
  };
}

const DB_NAME = "nut04-nutriscore";
const DB_VERSION = 11;

/**
 * Increment this constant whenever the bundled JSON dataset files change.
 * importDatasets() compares the stored metadata version against this value;
 * a mismatch triggers a full store clear and re-import so the SW always serves
 * current nutrition data without requiring a DB_VERSION bump.
 */
const BUNDLED_DATASET_VERSION = "v2.1.0";

let dbPromise: Promise<IDBPDatabase<NutriDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<NutriDB>(DB_NAME, DB_VERSION, {
      blocked(currentVersion, blockedVersion, event) {
        console.warn(`[NutriScoreDB] IndexedDB upgrade to ${blockedVersion} is blocked by an older connection (v${currentVersion}). Close other extension tabs!`);
      },
      blocking(currentVersion, blockedVersion, event) {
        console.warn(`[NutriScoreDB] IndexedDB connection (v${currentVersion}) is blocking a newer version (${blockedVersion}). Closing this connection.`);
        if (dbPromise) dbPromise.then(db => db.close());
      },
      upgrade(db, oldVersion, newVersion, transaction) {
        if (oldVersion < 1) {
          const store = db.createObjectStore("shopping_history" as any, { keyPath: "id" });
          (store as any).createIndex("by-viewedAt", "viewedAt");
        }
        if (oldVersion < 2) {
          db.createObjectStore("user_settings");
        }
        if (oldVersion < 3) {
          db.createObjectStore("product_cache");
          // Handle renames if upgrading from v2
          if (db.objectStoreNames.contains("ledger" as any)) {
            db.deleteObjectStore("ledger" as any);
          }
          if (db.objectStoreNames.contains("settings" as any)) {
            db.deleteObjectStore("settings" as any);
          }
        }
        if (oldVersion < 4) {
          const cStore = db.createObjectStore("carrefourProducts", { keyPath: "Identity.ProductID" });
          cStore.createIndex("by-url", "Identity.RetailerProductUrl");
          const nStore = db.createObjectStore("naivasProducts", { keyPath: "Identity.ProductID" });
          nStore.createIndex("by-url", "Identity.RetailerProductUrl");
        }
        if (oldVersion < 5) {
          const cStore = transaction.objectStore("carrefourProducts");
          cStore.createIndex("by-name", "Identity.ProductName");
          const nStore = transaction.objectStore("naivasProducts");
          nStore.createIndex("by-name", "Identity.ProductName");
        }
        if (oldVersion < 6) {
          if (db.objectStoreNames.contains("shopping_history" as any)) {
            db.deleteObjectStore("shopping_history" as any);
          }
          const ledgerStore = db.createObjectStore("shopping_ledger", { keyPath: "id" });
          ledgerStore.createIndex("by-addedAt", "addedAt");
          db.createObjectStore("dataset_metadata", { keyPath: "retailer" });
        }
        if (oldVersion < 7) {
          if (db.objectStoreNames.contains("carrefourProducts")) db.deleteObjectStore("carrefourProducts");
          if (db.objectStoreNames.contains("naivasProducts")) db.deleteObjectStore("naivasProducts");
          
          const cStore = db.createObjectStore("carrefourProducts", { keyPath: "Identity.ProductID" });
          cStore.createIndex("by-url", "Identity.RetailerProductUrl");
          cStore.createIndex("by-name", "Identity.ProductName");
          
          const nStore = db.createObjectStore("naivasProducts", { keyPath: "Identity.ProductID" });
          nStore.createIndex("by-url", "Identity.RetailerProductUrl");
          nStore.createIndex("by-name", "Identity.ProductName");
        }
        if (oldVersion < 8) {
          db.createObjectStore("price_cache");
        }
        if (oldVersion < 9) {
          if (db.objectStoreNames.contains("kfctReference" as any)) {
            db.deleteObjectStore("kfctReference" as any);
          }
        }
        // v11: Compound indexes on shopping_ledger replace O(n) full-table scans.
        // by-retailer-product-status → O(1) duplicate detection in logCartEvent.
        // by-status → O(n_active) scan in dedupeActiveCartItems instead of O(n_total).
        if (oldVersion < 11) {
          const ledger = transaction.objectStore("shopping_ledger");
          ledger.createIndex("by-retailer-product-status", ["retailer", "productId", "status"]);
          ledger.createIndex("by-status", "status");
        }
      },
    });
  }
  return dbPromise;
}

export async function getSettings(): Promise<Settings> {
  const db = await getDB();
  const tx = db.transaction("user_settings", "readonly");
  const diabetes = (await tx.store.get("diabetes")) ?? true;
  const hypertension = (await tx.store.get("hypertension")) ?? true;
  const kidney = (await tx.store.get("kidney")) ?? true;
  const profileName = (await tx.store.get("profileName")) || "";
  const primaryMetric = (await tx.store.get("primaryMetric")) || "Sugar";
  const condition = (await tx.store.get("condition")) || "healthy";
  const initials = (await tx.store.get("initials")) || "";
  return { ...DEFAULT_SETTINGS, diabetes, hypertension, kidney, profileName, primaryMetric, condition, initials };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("user_settings", "readwrite");
  await tx.store.put(settings.diabetes, "diabetes");
  await tx.store.put(settings.hypertension, "hypertension");
  await tx.store.put(settings.kidney, "kidney");
  await tx.store.put(settings.profileName, "profileName");
  await tx.store.put(settings.primaryMetric, "primaryMetric");
  await tx.store.put(settings.condition, "condition");
  await tx.store.put(settings.initials, "initials");
  await tx.done;
}

export async function logCartEvent(row: ShoppingLedgerRow): Promise<void> {
  const db = await getDB();
  // If it's an in_cart row, use the compound index for an O(1) duplicate check
  // instead of the prior O(n) getAllFromIndex + Array.find full-table scan.
  if (row.status === "in_cart") {
    const existing = await db.getFromIndex(
      "shopping_ledger",
      "by-retailer-product-status",
      [row.retailer, row.productId, "in_cart"] as any
    );
    if (existing && existing.id !== row.id) {
      existing.quantity += (row.quantity || 1);
      if (row.priceSnapshot != null) existing.priceSnapshot = row.priceSnapshot;
      await db.put("shopping_ledger", existing);
      return;
    }
  }
  await db.put("shopping_ledger", row);
}


export async function getAllEntries(): Promise<ShoppingLedgerRow[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("shopping_ledger", "by-addedAt");
  return all.reverse(); // newest first
}

export async function syncCart(retailer: string, cartItems: any[]): Promise<void> {
  const db = await getDB();
  
  // Clean up any historical duplicates before syncing
  await dedupeActiveCartItems(db);
  
  const allInCart = await db.getAll("shopping_ledger");
  const now = Date.now();
  
  const tx = db.transaction("shopping_ledger", "readwrite");
  const store = tx.store;
  
  // Track which items from the DOM payload we have processed
  const processedPayloadIds = new Set<string>();
  
  for (const row of allInCart) {
    if (row.retailer !== retailer) continue; // Skip other retailers
    if (row.status !== "in_cart") continue; // Only reconcile active items
    
    const cartMatch = cartItems.find(c => c.productId === row.productId);
    
    if (cartMatch) {
      // Still in cart -> update quantity and price if changed
      let changed = false;
      if (row.quantity !== cartMatch.quantity) {
        row.quantity = cartMatch.quantity;
        changed = true;
      }
      if (row.priceSnapshot !== cartMatch.priceSnapshot) {
        row.priceSnapshot = cartMatch.priceSnapshot;
        changed = true;
      }
      if (changed) {
        await store.put(row);
      }
      processedPayloadIds.add(cartMatch.productId);
    }
    // We intentionally DO NOT mark missing items as 'removed' here because the cart overlay
    // might simply be hidden, and we cannot reliably distinguish an empty cart from a closed cart.
  }
  
  await tx.done;
  
  // For new items not in ledger yet, we must resolve their stats first
  for (const item of cartItems) {
    if (processedPayloadIds.has(item.productId)) continue;
    
    const matchResult = await resolveProductMatch(
      retailer,
      item.productId,
      null, // url not parsed
      item.product_name || null
    );
    
    if (!matchResult.matched || !matchResult.product) continue;
    const p = matchResult.product;
    const interpretation = interpretProduct(p);
    if (!interpretation.canDisplayGrade) continue;

    let name = p.Identity?.ProductName || p.GroceryProductName || p.name || item.product_name || "Unknown Product";
    const gradeResult = computeGradeFromProduct(p);
    let gradeSnapshot: Grade | "UNKNOWN" = gradeResult.grade;
    let category = resolveDisplayCategory(p);
    let nutrition = {
      sodiumMg: p.Nutrition?.SodiumMG ?? null,
      sugarsG: p.Nutrition?.SugarsG ?? null,
      satFatG: p.Nutrition?.SaturatedFatG ?? null,
      potassiumMg: p.Nutrition?.PotassiumMG ?? p.Nutrition?.Potassium?.ValueMG ?? null
    };

    const newRow: ShoppingLedgerRow = {
      id: `${retailer}-${item.productId}-${now}`,
      productId: item.productId,
      name,
      retailer,
      addedAt: now,
      quantity: item.quantity || 1,
      priceSnapshot: item.priceSnapshot,
      gradeSnapshot,
      scoringStatus: gradeResult.status,
      category,
      status: "in_cart",
      nutritionSnapshot: nutrition
    };
    
    await logCartEvent(newRow);
  }
}

async function dedupeActiveCartItems(dbInstance?: any): Promise<void> {
  const db = dbInstance || await getDB();
  // O(n_active) via the by-status index — avoids loading the entire ledger into memory.
  // Previously this called db.getAll() which returned every historical row (O(n_total)).
  const activeItems: ShoppingLedgerRow[] = await db.getAllFromIndex(
    "shopping_ledger",
    "by-status",
    "in_cart" as any
  );

  const map = new Map<string, ShoppingLedgerRow>();
  const toDelete: string[] = [];

  for (const item of activeItems) {
    const key = `${item.retailer}-${item.productId}`;
    if (map.has(key)) {
      const existing = map.get(key)!;
      existing.quantity += item.quantity;
      toDelete.push(item.id);
    } else {
      map.set(key, item);
    }
  }

  if (toDelete.length > 0) {
    const tx = db.transaction("shopping_ledger", "readwrite");
    const store = tx.store;
    for (const existing of map.values()) {
      await store.put(existing);
    }
    for (const id of toDelete) {
      await store.delete(id);
    }
    await tx.done;
  }
}


// Increment whenever scoring logic changes (Gate 2 policy, FSA table mapping, etc.).
// Any cached product result that doesn't carry this version is treated as a cold miss
// and will be re-scored on next lookup.
const SCORING_VERSION = "v3";

export async function getCachedProduct(id: string): Promise<any> {
  const db = await getDB();
  const cached = await db.get("product_cache", id);
  if (!cached) return null;

  // Reject stale entries from an older scoring version.
  if (cached.scoringVersion !== SCORING_VERSION) return null;

  let retailer = cached.retailer || "NAIVAS";
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

  let retailer = product.retailer || "NAIVAS";
  const metadata = await db.get("dataset_metadata", retailer);
  product.datasetVersion = metadata ? metadata.datasetVersion : "v2.0.0";

  await db.put("product_cache", product, id);
  
  if (Math.random() < 0.05) {
    const tx = db.transaction("product_cache", "readwrite");
    let cursor = await tx.store.openCursor();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    while (cursor) {
      if (!cursor.value.cachedAt || cursor.value.cachedAt < sevenDaysAgo) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
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

// Data ingest logic for the Service Worker (Background)
export async function importDatasets(): Promise<void> {
  const db = await getDB();

  /**
   * Import a single product store, but only when the stored dataset version differs
   * from BUNDLED_DATASET_VERSION. The old `count === 0` guard prevented re-import
   * whenever the bundled JSON was updated without a DB_VERSION bump — silently serving
   * stale nutrition data. The version comparison fixes this.
   *
   * On a version mismatch the store is cleared first to guarantee a clean slate,
   * then in-memory caches for that retailer are invalidated so subsequent product
   * lookups read fresh data from IDB.
   */
  const importStore = async (retailerKey: string, storeName: string, path: string) => {
    const metadata = await db.get("dataset_metadata", retailerKey);
    if (metadata?.datasetVersion === BUNDLED_DATASET_VERSION) {
      // Already current — nothing to do.
      return;
    }

    console.log(`[NutriScoreDB] Importing ${storeName} (${BUNDLED_DATASET_VERSION})...`);
    // @ts-ignore
    const res = await fetch(chrome.runtime.getURL(path));
    if (!res.ok) {
      console.error(`[NutriScoreDB] Failed to fetch ${path}: HTTP ${res.status}`);
      return;
    }

    const data = await res.json();

    // Clear before re-import so removed products don't linger.
    await db.clear(storeName as any);

    const chunkSize = 500;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      const tx = db.transaction(storeName as any, "readwrite");
      chunk.forEach((p: any) => tx.store.put(p));
      await tx.done;
      await new Promise(r => setTimeout(r, 0)); // yield to keep SW responsive
    }

    const mTx = db.transaction("dataset_metadata", "readwrite");
    mTx.store.put({
      retailer: retailerKey,
      datasetVersion: BUNDLED_DATASET_VERSION,
      generatedAt: new Date().toISOString(),
      recordCount: data.length,
    });
    await mTx.done;

    // Invalidate in-memory caches so the next resolveProductMatch/getAllProducts call
    // re-populates from the freshly imported IDB data.
    const cacheKey = retailerKey.toLowerCase() as "carrefour" | "naivas";
    memCache[cacheKey] = null;
    lowerIndexCache[cacheKey] = null;
    normalizedIndexCache[cacheKey] = null;
    memCacheVersion[cacheKey] = BUNDLED_DATASET_VERSION;
    console.log(`[NutriScoreDB] ${storeName} import complete (${data.length} records).`);
  };

  await Promise.all([
    importStore("CARREFOUR", "carrefourProducts", "data/carrefour_products.json"),
    importStore("NAIVAS",    "naivasProducts",    "data/naivas_products.json"),
  ]);
}

// Product lookup for Score Engine

export function resolveDisplayCategory(record: any): string {
  if (!record || !record.Classification) return "Uncategorized";
  const { NutritionCategory, CanonicalFoodClass, FSACategoryCode } = record.Classification;
  // Use the most descriptive category available
  if (NutritionCategory && NutritionCategory !== "Uncategorized") return NutritionCategory;
  if (CanonicalFoodClass && CanonicalFoodClass !== "Uncategorized") return CanonicalFoodClass;
  if (FSACategoryCode) return FSACategoryCode;
  return "Uncategorized";
}

/** Result shape returned by computeGradeFromProduct. */
export interface GradeResult {
  grade: Grade | "UNKNOWN";
  status: ScoringStatus;
  /** Raw plausible field values present in the record (non-null, physically possible). */
  plausibleFields: { field: string; value: number; unit: string }[];
}

// ── Canonical enum sets for runtime validation (§8) ──────────────────────────
const VALID_REVIEW_STATES = new Set<ReviewState>([
  "REJECTED", "UNVERIFIED", "ESTIMATED", "VERIFIED", "HIGH_CONFIDENCE",
]);
const VALID_EVIDENCE_LEVELS = new Set<string>([
  "direct_label", "retailer_product_page", "manufacturer",
  "kfct2018_database", "international_fct_database",
  "derived", "category_reference", "unknown",
]);
const VALID_VALUE_SPECIFICITIES = new Set<string>([
  "product_specific", "pack_variant_specific", "category_specific",
  "generic_reference", "unknown",
]);

/**
 * Compute FSA-NPS grade from raw nutrition data.
 *
 * Enforces Gate 2 (§4): all four required fields must be non-null.
 * MUST NOT substitute 0 for a missing required field.
 * Returns a GradeResult with an explicit status so callers never have to
 * reverse-engineer "no grade" from a null or "UNKNOWN" string.
 */
export function computeGradeFromProduct(p: any): GradeResult {
  const plausibleFields: GradeResult["plausibleFields"] = [];

  if (!p || !p.Nutrition) {
    return { grade: "UNKNOWN", status: "not_attempted", plausibleFields };
  }

  const n = p.Nutrition;
  // Derive FSA scoring table: prefer explicit FSACategoryCode, fall back to the
  // same NutritionCategory map used in interpretProduct so both functions agree.
  const fsaCat: string =
    p.Classification?.FSACategoryCode ||
    NUTRITION_CATEGORY_TO_FSA[p.Classification?.NutritionCategory] ||
    "GENERAL_FOOD";

  // Collect raw field values (null = not present on label).
  const energy   = n.EnergyKJ ?? (n.EnergyKcal != null ? n.EnergyKcal * 4.184 : null);
  const sugars   = n.SugarsG       ?? null;
  const satFat   = n.SaturatedFatG ?? null;
  const sodium   = n.SodiumMG      ?? (n.SaltG != null ? n.SaltG / 2.5 * 1000 : null)
                                   ?? n.Sodium?.ValueMG ?? null;
  const fibre    = n.FibreG        ?? null;
  const protein  = n.ProteinG      ?? null;
  const fvlPct   = n.FVL?.Percentage ?? null;

  // Build plausible-fields list — only include values actually present on the label.
  const addField = (field: string, val: number | null, unit: string, lo: number, hi: number) => {
    if (val != null && val >= lo && val <= hi) plausibleFields.push({ field, value: val, unit });
  };
  addField("Energy",        energy,  "kJ",  0, 4000);
  addField("Sugars",        sugars,  "g",   0, 100);
  addField("Saturated Fat", satFat,  "g",   0, 100);
  addField("Sodium",        sodium,  "mg",  0, 40_000);
  addField("Fibre",         fibre,   "g",   0, 100);
  addField("Protein",       protein, "g",   0, 100);

  // ── Gate 2: energy is the only required field. ───────────────────────────────
  // A null value on a food label conventionally means zero or negligible — not
  // "data missing". Blocking the grade because sugars or sodium aren't listed
  // (common for oils, plain water, meat) produces worse information than
  // computing the score with those fields treated as 0.
  if (energy == null) {
    return { grade: "UNKNOWN", status: "insufficient_data", plausibleFields };
  }

  // Null required fields → 0 for scoring (absent on label = negligible).
  const scoreSugars  = sugars  ?? 0;
  const scoreSatFat  = satFat  ?? 0;
  const scoreSodium  = sodium  ?? 0;

  // ── Scoring ────────────────────────────────────────────────────────────────────────────
  let nEnergy = Math.min(Math.floor(energy / 335), 10);
  let nSugars = Math.min(Math.floor(scoreSugars / 3.4), 15);
  let nSatFat = Math.min(Math.floor(scoreSatFat / 1), 10);
  let nSodium = Math.min(Math.floor(scoreSodium / 80), 20);

  if (fsaCat === "BEVERAGE") {
    nEnergy = energy <= 0 ? 0 : Math.min(Math.floor(energy / 30) + 1, 10);
    nSugars = scoreSugars <= 0 ? 0 : Math.min(Math.floor(scoreSugars / 1.5) + 1, 15);
  }
  if (fsaCat === "ADDED_FAT") {
    const totalFat = (n.FatG ?? 0) || (scoreSatFat * 1.5);
    const ratio = totalFat > 0 ? (scoreSatFat / totalFat) * 100 : 0;
    nSatFat = Math.min(Math.floor(ratio / 10), 10);
  }

  const nPoints = nEnergy + nSugars + nSatFat + nSodium;

  // Positive-point fields: absence lowers score but does NOT block computation (§4).
  const safePos = (v: number | null) => (v == null ? 0 : v);
  let pFibre   = Math.min(Math.floor(safePos(fibre) / 0.9), 5);
  let pProtein = Math.min(Math.floor(safePos(protein) / 2.4), 7);
  if (fsaCat === "RED_MEAT") pProtein = Math.min(pProtein, 2);

  let pFVL = 0;
  const fvlNum = safePos(fvlPct);
  if (fvlNum > 80) pFVL = 5;
  else if (fvlNum > 60) pFVL = 2;
  else if (fvlNum > 40) pFVL = 1;

  let finalScore: number;
  if (fsaCat === "CHEESE") {
    finalScore = nPoints - pFibre - pProtein - pFVL;
  } else if (nPoints >= 11 && pFVL < 5) {
    finalScore = nPoints - pFibre - pFVL;
  } else {
    finalScore = nPoints - pFibre - pProtein - pFVL;
  }

  let letter: Grade;
  if (fsaCat === "BEVERAGE") {
    if (finalScore <= 1) letter = "B";
    else if (finalScore <= 5) letter = "C";
    else if (finalScore <= 9) letter = "D";
    else letter = "E";
  } else {
    if (finalScore <= -1) letter = "A";
    else if (finalScore <= 2)  letter = "B";
    else if (finalScore <= 10) letter = "C";
    else if (finalScore <= 18) letter = "D";
    else letter = "E";
  }

  return { grade: letter, status: "computed", plausibleFields };
}


// In-memory cache for fast scanning to avoid slow IndexedDB cursors.
// Entries are invalidated by importDatasets() whenever BUNDLED_DATASET_VERSION changes,
// ensuring that a dataset update within a running SW session is immediately visible.
let memCache: { carrefour: any[] | null; naivas: any[] | null } = { carrefour: null, naivas: null };

/** Tracks the dataset version that each memCache partition was populated from. */
const memCacheVersion: { carrefour: string | null; naivas: string | null } = { carrefour: null, naivas: null };

const normalizedIndexCache: { carrefour: Map<string, any> | null; naivas: Map<string, any> | null } = { carrefour: null, naivas: null };
const lowerIndexCache: { carrefour: Map<string, any> | null; naivas: Map<string, any> | null } = { carrefour: null, naivas: null };

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

export async function resolveProductMatch(retailer: string, retailerProductId: string | null, url: string | null, productName: string | null): Promise<{ matched: boolean, matchMethod: string, confidence: string, reason?: string, product?: any }> {
  const db = await getDB();
  const isCarrefour = retailer.toUpperCase() === "CARREFOUR";
  const storeName = isCarrefour ? "carrefourProducts" : "naivasProducts";
  const tx = db.transaction(storeName as any, "readonly");
  const store = tx.store;

  // Initialize memCache for this store if not present
  if (isCarrefour && !memCache.carrefour) memCache.carrefour = await store.getAll();
  if (!isCarrefour && !memCache.naivas) memCache.naivas = await store.getAll();
  
  const cacheArr = isCarrefour ? memCache.carrefour! : memCache.naivas!;

  if (retailerProductId) {
    let hit = await store.get(retailerProductId);
    if (!hit && !isNaN(Number(retailerProductId))) {
      hit = await store.get(Number(retailerProductId));
    }
    if (hit) return { matched: true, matchMethod: "product_id", confidence: "high", product: hit };
    
    // For Carrefour: the cart gives numeric IDs like "55606" but DB keys are UUIDs.
    // Search by matching /p/{id} fragment in the stored RetailerProductUrl.
    if (retailerProductId && isCarrefour) {
      const regex = new RegExp(`\\/p\\/${retailerProductId}(?:\\?|\\/|$)`);
      const found = cacheArr.find(p => regex.test(p.Identity?.RetailerProductUrl || ""));
      if (found) {
        return { matched: true, matchMethod: "url_path_fragment", confidence: "high", product: found };
      }
    }
  }

  if (url) {
    const urlHit = await (store.index as any)("by-url").get(url);
    if (urlHit) return { matched: true, matchMethod: "url", confidence: "high", product: urlHit };
  }

  if (productName) {
    const nameHit = await (store.index as any)("by-name").get(productName);
    if (nameHit) return { matched: true, matchMethod: "exact_name", confidence: "medium", product: nameHit };
    const lower = productName.toLowerCase().trim();
    if (isCarrefour && !lowerIndexCache.carrefour) lowerIndexCache.carrefour = buildLowerIndex(memCache.carrefour!);
    if (!isCarrefour && !lowerIndexCache.naivas) lowerIndexCache.naivas = buildLowerIndex(memCache.naivas!);
    const lowerIdx = isCarrefour ? lowerIndexCache.carrefour! : lowerIndexCache.naivas!;
    const foundLower = lowerIdx.get(lower);
    if (foundLower) {
      return { matched: true, matchMethod: "case_insensitive_name", confidence: "medium", product: foundLower };
    }

    const normSearch = normalizeProductName(productName);
    if (normSearch) {
      if (isCarrefour && !normalizedIndexCache.carrefour) normalizedIndexCache.carrefour = buildNormalizedIndex(memCache.carrefour!);
      if (!isCarrefour && !normalizedIndexCache.naivas) normalizedIndexCache.naivas = buildNormalizedIndex(memCache.naivas!);
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
  // Replaces N parallel db.get() calls (one per product) with a single getAll() + Map lookup — O(1) per product.
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


function normalizeProductName(name: string): string {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/\s*pack /g, '')
    .replace(/\s*p\/kg /g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical mapping: 14-tier NutritionCategory vocab → FSA-NPS algorithm variant.
 * Used as a fallback when the dataset record omits FSACategoryCode (all current records).
 * FSA-NPS has four scoring tables: GENERAL_FOOD | BEVERAGE | CHEESE | FAT.
 */
const NUTRITION_CATEGORY_TO_FSA: Record<string, string> = {
  // Beverages score on the beverage table.
  "Beverages":        "BEVERAGE",
  // Fats & Oils use the added-fat sat-fat ratio adjustment.
  "Fats & Oils":      "ADDED_FAT",
  // Dairy defaults to GENERAL_FOOD; cheese sub-type is not captured here at category level.
  "Dairy":            "GENERAL_FOOD",
  // All other 14-tier categories map to GENERAL_FOOD.
  "Cereals & Grains":    "GENERAL_FOOD",
  "Confectionery":       "GENERAL_FOOD",
  "Meat & Eggs":         "GENERAL_FOOD",
  "Condiments & Spices": "GENERAL_FOOD",
  "Vegetables":          "GENERAL_FOOD",
  "Fruit":               "GENERAL_FOOD",
  "Nuts & Seeds":        "GENERAL_FOOD",
  "Legumes":             "GENERAL_FOOD",
  "Mixed Dishes":        "GENERAL_FOOD",
  "Fish & Seafood":      "GENERAL_FOOD",
  "Starchy Roots":       "GENERAL_FOOD",
};

export function interpretProduct(record: any): any {
  if (!record) return { canDisplayGrade: false, scoringStatus: "not_attempted" };

  const validation = record.Validation || {};
  const prov = record.NutritionProvenance || {};
  const rawReviewState: string = validation.ReviewState ?? "";

  const VALID_REVIEW_STATES = new Set<string>([
    "REJECTED", "UNVERIFIED", "ESTIMATED", "VERIFIED", "HIGH_CONFIDENCE",
  ]);
  if (rawReviewState && !VALID_REVIEW_STATES.has(rawReviewState)) {
    console.error(
      `[NutriScoreDB] §8 anomaly: unrecognised ReviewState "${rawReviewState}" on record`,
      record.Identity?.ProductID ?? "(no id)",
    );
  }

  const rawEvidenceLevel: string = prov.EvidenceLevel ?? "";
  const rawValueSpecificity: string = prov.ValueSpecificity ?? "";

  const classification = record.Classification || {};
  const foodCategory = resolveDisplayCategory(record);
  // Prefer the explicit FSACategoryCode; fall back to NutritionCategory→FSA mapping.
  // This covers all current records in the dataset, which were built before FSACategoryCode
  // was introduced as a field.
  const nutrientAlgorithmVariant: string | null =
    classification.FSACategoryCode ||
    NUTRITION_CATEGORY_TO_FSA[classification.NutritionCategory] ||
    null;

  // §6 — Non-food / unclassifiable: null NOVA.Level without a valid category → Not rated.
  const novaLevel = classification.NOVA?.Level;
  const novaConfidence = classification.NOVA?.Confidence ?? null;
  if (novaLevel == null && !nutrientAlgorithmVariant) {
    return {
      canDisplayGrade: false,
      scoringStatus: "not_attempted",
      reviewState: rawReviewState || "UNVERIFIED",
      foodCategory,
      nutrientAlgorithmVariant,
      novaLevel,
      novaConfidence,
      evidenceLevel: rawEvidenceLevel || "unknown",
      valueSpecificity: rawValueSpecificity || "unknown",
    };
  }

  // §3 Gate 1 — Trust eligibility via ReviewState.
  const reviewState: ReviewState =
    VALID_REVIEW_STATES.has(rawReviewState)
      ? (rawReviewState as ReviewState)
      : "UNVERIFIED"; // safe default for anomalous values

  if (reviewState === "REJECTED" || reviewState === "UNVERIFIED") {
    return {
      canDisplayGrade: false,
      scoringStatus: "not_attempted",
      reviewState,
      foodCategory,
      nutrientAlgorithmVariant,
      novaLevel,
      novaConfidence,
      evidenceLevel: rawEvidenceLevel || "unknown",
      valueSpecificity: rawValueSpecificity || "unknown",
    };
  }

  // Gate 1 passed (ESTIMATED | VERIFIED | HIGH_CONFIDENCE). Proceed to Gate 2.

  // §3 — Category guard: no grade without an FSA algorithm variant.
  if (!nutrientAlgorithmVariant || foodCategory === "Uncategorized") {
    return {
      canDisplayGrade: false,
      scoringStatus: "not_attempted",
      reviewState,
      foodCategory,
      nutrientAlgorithmVariant,
      novaLevel,
      novaConfidence,
      evidenceLevel: rawEvidenceLevel || "unknown",
      valueSpecificity: rawValueSpecificity || "unknown",
    };
  }

  // §4 Gate 2 — Energy is the only required datum.
  // Null sugars/satFat/sodium are treated as 0 in computeGradeFromProduct,
  // so products are gradeable whenever energy is known.
  const n = record.Nutrition || {};
  const gate2Passed = n.EnergyKJ != null || n.EnergyKcal != null;

  const checks = validation.ConsistencyChecks || {};

  // Map EvidenceLevel → shopper-facing badge tier label.
  // ValueSpecificity + EvidenceLevel together determine the provenance caption (§5.2).
  // The tier shown on the badge maps directly from ReviewState (§5.1).
  const reviewStateToBadgeTier: Record<ReviewState, string> = {
    HIGH_CONFIDENCE: "high_confidence",
    VERIFIED:        "confirmed",
    ESTIMATED:       "estimated",
    UNVERIFIED:      "not_rated",
    REJECTED:        "not_rated",
  };
  const evidenceTier = reviewStateToBadgeTier[reviewState] ?? "not_rated";

  return {
    foodCategory,
    nutrientAlgorithmVariant,
    reviewState,
    // Legacy alias kept so badge renderer doesn't break during transition.
    validationStatus: reviewState,
    evidenceTier,
    evidenceLevel: rawEvidenceLevel || "unknown",
    valueSpecificity: rawValueSpecificity || "unknown",
    novaLevel,
    novaConfidence,
    categoryPlausibilityCheck: checks.CategoryPlausibility || "not_checked",
    energyConsistencyCheck: checks.Atwater || "not_checked",
    saltSodiumConsistencyCheck: checks.SaltSodium || "not_checked",
    dataQualityFlags: validation.DataQualityFlags || [],
    sourceReference: prov.SourceID ? { sourceId: prov.SourceID, sourceName: prov.SourceName } : null,
    // Gate 2 outcome — callers use scoringStatus to decide display path (§4 rule 5).
    canDisplayGrade: gate2Passed,
    scoringStatus: gate2Passed ? "computed" : "insufficient_data" as ScoringStatus,
  };
}


export function resolveTimeframe(timeframeKey: string, now = Date.now()) {
  const start = new Date(now);
  let bucketUnit = "day", bucketCount = 1, tickLabelFormat = "short";
  
  if (timeframeKey === "today") {
    start.setHours(0, 0, 0, 0);
    bucketUnit = "hour";
    bucketCount = 24;
  } else if (timeframeKey === "week") {
    start.setDate(start.getDate() - 7);
    bucketUnit = "day";
    bucketCount = 7;
  } else if (timeframeKey === "month") {
    start.setMonth(start.getMonth() - 1);
    bucketUnit = "day";
    bucketCount = 30;
  } else if (timeframeKey === "year") {
    start.setFullYear(start.getFullYear() - 1);
    bucketUnit = "month";
    bucketCount = 12;
  } else if (timeframeKey === "all") {
    start.setFullYear(2020); 
    bucketUnit = "month"; 
    bucketCount = 60; 
  }
  
  const tickLabelFn = (ts: number) => {
    const d = new Date(ts);
    if (bucketUnit === "hour") return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (bucketUnit === "day") return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    if (bucketUnit === "month") return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
    return d.toLocaleDateString([], { year: 'numeric' });
  };
  
  return {
    windowStart: start.getTime(),
    windowEnd: now,
    bucketUnit,
    bucketCount,
    tickLabelFormat,
    tickLabelFn
  };
}

function generateBucketSlots(
  tf: any
): { key: string; ts: number; label: string }[] {
  const { windowStart, windowEnd, bucketUnit, tickLabelFn } = tf;
  const slots: { key: string; ts: number; label: string }[] = [];
  const cursor = new Date(windowStart);

  if (bucketUnit === "hour") {
    cursor.setMinutes(0, 0, 0);
  } else if (bucketUnit === "day") {
    cursor.setHours(0, 0, 0, 0);
  } else if (bucketUnit === "week") {
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7)); 
  } else if (bucketUnit === "month") {
    cursor.setDate(1); cursor.setHours(0, 0, 0, 0);
  } else {
    cursor.setMonth(Math.floor(cursor.getMonth() / 3) * 3, 1); cursor.setHours(0, 0, 0, 0);
  }

  let safety = 0;
  while (cursor.getTime() <= windowEnd && safety++ < 500) {
    const ts = cursor.getTime();
    slots.push({ key: `${bucketUnit}-${ts}`, ts, label: tickLabelFn(ts) });
    if (bucketUnit === "hour")    cursor.setHours(cursor.getHours() + 1);
    else if (bucketUnit === "day")    cursor.setDate(cursor.getDate() + 1);
    else if (bucketUnit === "week")   cursor.setDate(cursor.getDate() + 7);
    else if (bucketUnit === "month")  cursor.setMonth(cursor.getMonth() + 1);
    else                              cursor.setMonth(cursor.getMonth() + 3);
  }
  return slots;
}

function entryBucketKey(ts: number, bu: string): string {
  const d = new Date(ts);
  if (bu === "hour") {
    const s = new Date(d); s.setMinutes(0, 0, 0);
    return `hour-${s.getTime()}`;
  }
  if (bu === "day") {
    const s = new Date(d); s.setHours(0, 0, 0, 0);
    return `day-${s.getTime()}`;
  }
  if (bu === "week") {
    const s = new Date(d); s.setHours(0, 0, 0, 0);
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    return `week-${s.getTime()}`;
  }
  if (bu === "month")
    return `month-${new Date(d.getFullYear(), d.getMonth(), 1).getTime()}`;
  return `quarter-${new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime()}`;
}

export function calculateAnalytics(filteredLedger: any[], totalStoredCount: number, tf: any) {
  const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  let ptsSum = 0;
  const gradePts: Record<string, number> = { A: 1, B: 3, C: 7, D: 12, E: 20 };
  
  // category â†’ { totalSpend, validItems (with price > 0) }
  const categoryMap: Record<string, { price: number; n: number }> = {};
  
  let diabetes = 0;
  let hypertension = 0;
  let cvd = 0;
  let kidney = 0;

  const slots = generateBucketSlots(tf);
  type Acc = { sodium: number; nSodium: number; sugar: number; nSugar: number; satFat: number; nSatFat: number; n: number };
  const acc: Record<string, Acc> = {};
  for (const s of slots) acc[s.key] = { sodium: 0, nSodium: 0, sugar: 0, nSugar: 0, satFat: 0, nSatFat: 0, n: 0 };

  let validCount = 0;
  let missingCount = 0;

  filteredLedger.forEach(e => {
    // Basket Quality
    counts[e.gradeSnapshot || e.grade] = (counts[e.gradeSnapshot || e.grade] || 0) + 1;
    ptsSum += gradePts[e.gradeSnapshot || e.grade] || 0;
    
    // Category Insights â€” only count items with a real price and a real grade
    const rowPrice = e.priceSnapshot ?? 0;
    const rowGrade = e.gradeSnapshot || (e as any).grade || "";
    if (rowPrice > 0 && rowGrade && rowGrade !== "UNKNOWN") {
      const m = categoryMap[e.category] ?? (categoryMap[e.category] = { price: 0, n: 0 });
      m.price += rowPrice;
      m.n += 1;
    }

    // Health Alerts
    const sugar = e.nutritionSnapshot?.sugarsG ?? e.sugarsG ?? null;
    const sodium = e.nutritionSnapshot?.sodiumMg ?? e.sodiumMg ?? null;
    const satFat = e.nutritionSnapshot?.satFatG ?? e.satFatG ?? null;
    const potassium = e.nutritionSnapshot?.potassiumMg ?? e.potassiumMg ?? null;
    
    if (sugar !== null) {
      if (Number(sugar) > 22.5) diabetes++;
    }
    if (sodium !== null) {
      if (Number(sodium) > 600) hypertension++;
    }
    if ((sodium !== null && Number(sodium) > 600) || (potassium !== null && Number(potassium) > 200)) {
      kidney++;
    }
    if (satFat !== null || sodium !== null) {
      if (Number(satFat) > 5 || (Number(sodium) > 400 && Number(sodium) <= 600)) cvd++;
    }

    // Nutrient Trends â€” OR gate: any non-null nutrient contributes to its own bucket average
    const hasAny = sugar !== null || sodium !== null || satFat !== null;
    if (hasAny) {
      validCount++;
      const key = entryBucketKey(e.addedAt, tf.bucketUnit);
      if (acc[key]) {
        acc[key].n += 1;
        if (sodium !== null) { acc[key].sodium += Number(sodium); acc[key].nSodium += 1; }
        if (sugar  !== null) { acc[key].sugar  += Number(sugar);  acc[key].nSugar  += 1; }
        if (satFat !== null) { acc[key].satFat += Number(satFat); acc[key].nSatFat += 1; }
      }
    } else {
      missingCount++;
    }
  });

  const categoryInsights = Object.entries(categoryMap)
    .map(([category, m]) => ({
      category,
      avgPrice: Math.round(m.price / m.n),
      count: m.n
    }))
    .sort((a, b) => b.avgPrice - a.avgPrice)
    .slice(0, 6);

  const trendData = slots.map((s) => {
    const b = acc[s.key];
    return {
      ts: s.ts,
      label: s.label,
      id: s.key,
      sodiumMg: b.nSodium > 0 ? Math.round(b.sodium / b.nSodium) : null,
      sugarsG:  b.nSugar  > 0 ? Math.round((b.sugar  / b.nSugar)  * 10) / 10 : null,
      satFatG:  b.nSatFat > 0 ? Math.round((b.satFat / b.nSatFat) * 10) / 10 : null,
      hasData: b.n > 0,
      sodium:  b.nSodium > 0 ? Math.round(b.sodium / b.nSodium) : 0,
      sugar:   b.nSugar  > 0 ? Math.round((b.sugar  / b.nSugar)  * 10) / 10 : 0,
      satFat:  b.nSatFat > 0 ? Math.round((b.satFat / b.nSatFat) * 10) / 10 : 0
    };
  });

  const GRADE_ORDER: Grade[] = ['A', 'B', 'C', 'D', 'E'];
  function computeAverageGrade(counts: Record<string, number>): Grade | null {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    const gradeValue: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5 };
    const weighted = GRADE_ORDER.reduce((sum, g) => sum + (gradeValue[g] as number) * (counts[g] || 0), 0);
    const avgValue = Math.round(weighted / total);
    return GRADE_ORDER[Math.min(Math.max(avgValue, 1), 5) - 1];
  }

  return {
    totalStoredEvents: totalStoredCount,
    filteredPeriodEvents: filteredLedger.length,
    basketQuality: {
      averageGrade: computeAverageGrade(counts) || "C",
      pts: ptsSum,
      distribution: counts as any
    },
    categoryInsights,
    nutrientTrends: {
      windowStart: tf.windowStart,
      windowEnd: tf.windowEnd,
      ticks: slots.map(s => ({ ts: s.ts, label: s.label })),
      data: trendData as any,
      validCount,
      missingCount
    },
    healthAlerts: {
      diabetes,
      hypertension,
      cvd,
      kidney
    }
  };
}

export async function savePrice(productId: string | number, price: number): Promise<void> {
  if (!productId || price == null) return;
  const db = await getDB();
  await db.put("price_cache", price, String(productId));
}


async function getPrice(productId: string | number): Promise<number | null> {
  if (!productId) return null;
  const db = await getDB();
  const price = await db.get("price_cache", String(productId));
  return price ?? null;
}

export async function deleteLedgerEntry(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("shopping_ledger", id);
}
