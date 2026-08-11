import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Grade, ShoppingLedgerRow, DatasetMetadata } from "./nutriscore";

// User preferences for the disease-warning modules. Persisted locally only.
export interface Settings {
  diabetes: boolean;      // sugar warnings
  hypertension: boolean;  // sodium warnings
  cardiovascular: boolean; // saturated fat / sodium-CVD warnings
  kidney: boolean;        // potassium / high-sodium kidney warnings
}

export const DEFAULT_SETTINGS: Settings = {
  diabetes: true,
  hypertension: true,
  cardiovascular: true,
  kidney: true,
};

const SETTINGS_KEY = "warning-modules";

// Local-first storage. Nothing here is ever transmitted to an external server.
interface NutriDB extends DBSchema {
  shopping_ledger: {
    key: string;
    value: ShoppingLedgerRow;
    indexes: { "by-addedAt": number };
  };
  dataset_metadata: {
    key: string;
    value: DatasetMetadata;
  };
  user_settings: {
    key: string;
    value: Settings;
  };
  product_cache: {
    key: string;
    value: any; // Cache for adapter output Product objects
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
  kfctReference: {
    key: string;
    value: any;
  };
}

const DB_NAME = "nut04-nutriscore";
const DB_VERSION = 7;

let dbPromise: Promise<IDBPDatabase<NutriDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<NutriDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        if (oldVersion < 1) {
          const store = db.createObjectStore("shopping_history", { keyPath: "id" });
          store.createIndex("by-viewedAt", "viewedAt");
        }
        if (oldVersion < 2) {
          db.createObjectStore("user_settings");
        }
        if (oldVersion < 3) {
          db.createObjectStore("product_cache");
          // Handle renames if upgrading from v2
          if (db.objectStoreNames.contains("ledger")) {
            db.deleteObjectStore("ledger");
          }
          if (db.objectStoreNames.contains("settings")) {
            db.deleteObjectStore("settings");
          }
        }
        if (oldVersion < 4) {
          const cStore = db.createObjectStore("carrefourProducts", { keyPath: "Identity.ProductID" });
          cStore.createIndex("by-url", "Identity.RetailerProductUrl");
          const nStore = db.createObjectStore("naivasProducts", { keyPath: "Identity.ProductID" });
          nStore.createIndex("by-url", "Identity.RetailerProductUrl");
          db.createObjectStore("kfctReference", { keyPath: "Identity.FoodCode" });
        }
        if (oldVersion < 5) {
          const cStore = transaction.objectStore("carrefourProducts");
          cStore.createIndex("by-name", "Identity.ProductName");
          const nStore = transaction.objectStore("naivasProducts");
          nStore.createIndex("by-name", "Identity.ProductName");
        }
        if (oldVersion < 6) {
          if (db.objectStoreNames.contains("shopping_history")) {
            db.deleteObjectStore("shopping_history");
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
      },
    });
  }
  return dbPromise;
}

export async function getSettings(): Promise<Settings> {
  const db = await getDB();
  const stored = await db.get("user_settings", SETTINGS_KEY);
  // Merge with defaults so newly added modules get a sensible value.
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await getDB();
  await db.put("user_settings", settings, SETTINGS_KEY);
}

export async function logCartEvent(row: ShoppingLedgerRow): Promise<void> {
  const db = await getDB();
  // If it's an in_cart row, ensure we don't insert a duplicate.
  if (row.status === "in_cart") {
    const all = await db.getAllFromIndex("shopping_ledger", "by-addedAt");
    const existing = all.find(r => r.retailer === row.retailer && r.productId === row.productId && r.status === "in_cart");
    if (existing && existing.id !== row.id) {
       existing.quantity += (row.quantity || 1);
       if (row.priceSnapshot) existing.priceSnapshot = row.priceSnapshot;
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
    
    let gradeSnapshot: Grade = "C";
    let category = "Uncategorized";
    let nutrition = { sodiumMg: null, sugarsG: null, satFatG: null };
    let name = item.product_name || "Unknown Product";
    if (matchResult.matched && matchResult.product) {
      const p = matchResult.product;
      name = p.Identity?.ProductName || p.GroceryProductName || p.name || name;
      const interpretation = interpretProduct(p);
      gradeSnapshot = interpretation.canDisplayGrade
        ? computeGradeFromProduct(p)
        : "C";
      category = resolveDisplayCategory(p);
      nutrition = {
        sodiumMg: p.Nutrition?.SodiumMG ?? null,
        sugarsG: p.Nutrition?.SugarsG ?? null,
        satFatG: p.Nutrition?.SaturatedFatG ?? null
      };
    }
    
    const newRow: ShoppingLedgerRow = {
      id: `${retailer}-${item.productId}-${now}`,
      productId: item.productId,
      name,
      retailer,
      addedAt: now,
      quantity: item.quantity || 1,
      priceSnapshot: item.priceSnapshot,
      gradeSnapshot,
      category,
      status: "in_cart",
      nutritionSnapshot: nutrition
    };
    
    await logCartEvent(newRow);
  }
}

export async function dedupeActiveCartItems(dbInstance?: any): Promise<void> {
  const db = dbInstance || await getDB();
  const all = await db.getAll("shopping_ledger");
  const activeItems = all.filter(r => r.status === "in_cart");
  
  const map = new Map();
  const toDelete = [];
  
  for (const item of activeItems) {
    const key = `${item.retailer}-${item.productId}`;
    if (map.has(key)) {
       const existing = map.get(key);
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

export async function countEntries(): Promise<number> {
  const db = await getDB();
  return db.count("shopping_ledger");
}

export async function getCachedProduct(id: string): Promise<any> {
  const db = await getDB();
  const cached = await db.get("product_cache", id);
  if (!cached) return null;
  
  let retailer = cached.retailer || "NAIVAS";
  const metadata = await db.get("dataset_metadata", retailer);
  const currentVersion = metadata ? metadata.datasetVersion : "v2.0.0";
  
  if (cached.datasetVersion === currentVersion) {
    return cached;
  }
  return null;
}

export async function cacheProduct(id: string, product: any): Promise<void> {
  const db = await getDB();
  product.cachedAt = Date.now();
  
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


export async function getAllScans(): Promise<any[]> {
  return await getAllEntries();
}

export async function getHistoricalTrends(): Promise<any> {
  const entries = await getAllEntries();
  return { count: entries.length };
}

export async function clearScans(): Promise<void> {
  await purgeAll();
}

// Seed demo history so the dashboard has something to show on first open.
export async function seedIfEmpty(): Promise<void> {
  const db = await getDB();
  const existing = await db.count("shopping_ledger");
  if (existing > 0) return;

  const { PRODUCTS } = await import("./products");
  const grades: Grade[] = ["A", "B", "C", "D", "E"];
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const tx = db.transaction("shopping_ledger", "readwrite");
  for (let i = 0; i < 45; i++) {
    const p = PRODUCTS[i % PRODUCTS.length];
    const daysAgo = Math.floor((i / 45) * 30);
    const jitter = (n: number | null) =>
      n === null ? null : Math.max(0, Math.round(n * (0.85 + Math.random() * 0.3)));
    const entry: LedgerEntry = {
      id: `seed-${i}`,
      productId: p.id,
      name: p.name,
      category: p.category,
      grade: grades[Math.floor(Math.random() * grades.length)],
      sodiumMg: jitter(p.nutrients.sodiumMg),
      sugarsG: jitter(p.nutrients.sugarsG),
      satFatG: jitter(p.nutrients.satFatG),
      viewedAt: now - daysAgo * day - Math.floor(Math.random() * day),
    };
    await tx.store.put(entry);
  }
  await tx.done;
}

// Data ingest logic for the Service Worker (Background)
export async function importDatasets(): Promise<void> {
  const db = await getDB();
  const cCount = await db.count("carrefourProducts");
  const nCount = await db.count("naivasProducts");
  const kCount = await db.count("kfctReference");

  const importStore = async (count: number, storeName: string, path: string) => {
    if (count === 0) {
      console.log(`[NutriScoreDB] Importing ${storeName}...`);
      const res = await fetch(chrome.runtime.getURL(path));
      if (res.ok) {
        const data = await res.json();
        const chunkSize = 500;
        for (let i = 0; i < data.length; i += chunkSize) {
          const chunk = data.slice(i, i + chunkSize);
          const tx = db.transaction(storeName, "readwrite");
          chunk.forEach((p: any) => tx.store.put(p));
          await tx.done;
          await new Promise(r => setTimeout(r, 0)); // yield
        }
        
        const mTx = db.transaction("dataset_metadata", "readwrite");
        mTx.store.put({
          retailer: storeName.replace("Products", "").replace("Reference", "").toUpperCase(),
          datasetVersion: "v2.0.0",
          generatedAt: new Date().toISOString(),
          recordCount: data.length
        });
        await mTx.done;
      }
    }
  };

  await Promise.all([
    importStore(cCount, "carrefourProducts", "data/carrefour_final.json"),
    importStore(nCount, "naivasProducts", "data/naivas_final.json"),
    importStore(kCount, "kfctReference", "data/kfct2018_reference_validated.json"),
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

/**
 * Compute FSA-NPS grade from raw nutrition data.
 * Mirrors the logic in score-engine.js.
 */
export function computeGradeFromProduct(p: any): Grade {
  if (!p || !p.Nutrition) return "UNKNOWN" as Grade;
  const n = p.Nutrition;
  const fsaCat = p.Classification?.FSACategoryCode || "GENERAL_FOOD";

  const energy   = n.EnergyKJ ?? (n.EnergyKcal != null ? n.EnergyKcal * 4.184 : null);
  const sugars   = n.SugarsG       ?? null;
  const satFat   = n.SaturatedFatG ?? null;
  const sodium   = n.SodiumMG      ?? n.Sodium?.ValueMG ?? null;
  const fibre    = n.FibreG        ?? null;
  const protein  = n.ProteinG      ?? null;
  const fvlPct   = n.FVL?.Percentage ?? null;

  if (energy == null && sugars == null && satFat == null && sodium == null) {
    return "UNKNOWN" as Grade;
  }

  const safeNum = (val: number | null) => (val == null ? 0 : val);
  const eVal = safeNum(energy);
  const sugVal = safeNum(sugars);
  const satVal = safeNum(satFat);
  const sodVal = safeNum(sodium);

  let nEnergy = Math.min(Math.floor(eVal / 335), 10);
  let nSugars = Math.min(Math.floor(sugVal / 3.4), 15);
  let nSatFat = Math.min(Math.floor(satVal / 1), 10);
  let nSodium = Math.min(Math.floor(sodVal / 80), 20);

  if (fsaCat === "BEVERAGE") {
    nEnergy = eVal <= 0 ? 0 : Math.min(Math.floor(eVal / 30) + 1, 10);
    nSugars = sugVal <= 0 ? 0 : Math.min(Math.floor(sugVal / 1.5) + 1, 15);
  }
  if (fsaCat === "ADDED_FAT") {
    const totalFat = safeNum(n.FatG) || (satVal * 1.5);
    const ratio = totalFat > 0 ? (satVal / totalFat) * 100 : 0;
    nSatFat = Math.min(Math.floor(ratio / 10), 10);
  }

  const nPoints = nEnergy + nSugars + nSatFat + nSodium;

  let pFibre   = Math.min(Math.floor(safeNum(fibre) / 0.9), 5);
  let pProtein = Math.min(Math.floor(safeNum(protein) / 2.4), 7);
  if (fsaCat === "RED_MEAT") pProtein = Math.min(pProtein, 2);

  let pFVL = 0;
  const fvlPctNum = safeNum(fvlPct);
  if (fvlPctNum > 80) pFVL = 5;
  else if (fvlPctNum > 60) pFVL = 2;
  else if (fvlPctNum > 40) pFVL = 1;

  let finalScore: number;
  if (fsaCat === "CHEESE") {
    finalScore = nPoints - pFibre - pProtein - pFVL;
  } else if (nPoints >= 11 && pFVL < 5) {
    finalScore = nPoints - pFibre - pFVL;
  } else {
    finalScore = nPoints - pFibre - pProtein - pFVL;
  }

  if (fsaCat === "BEVERAGE") {
    if (finalScore <= 1) return "B";
    if (finalScore <= 5) return "C";
    if (finalScore <= 9) return "D";
    return "E";
  }
  if (finalScore <= -1) return "A";
  if (finalScore <= 2)  return "B";
  if (finalScore <= 10) return "C";
  if (finalScore <= 18) return "D";
  return "E";
}

// In-memory cache for fast scanning to avoid slow IndexedDB cursors
let memCache: {
  carrefour: any[] | null;
  naivas: any[] | null;
} = { carrefour: null, naivas: null };

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
      const pathFragment = `/p/${retailerProductId}`;
      const found = cacheArr.find(p => (p.Identity?.RetailerProductUrl || "").includes(pathFragment));
      if (found) {
        return { matched: true, matchMethod: "url_path_fragment", confidence: "high", product: found };
      }
    }
  }

  if (url) {
    const urlHit = await store.index("by-url").get(url);
    if (urlHit) return { matched: true, matchMethod: "url", confidence: "high", product: urlHit };
  }

  if (productName) {
    const nameHit = await store.index("by-name").get(productName);
    if (nameHit) return { matched: true, matchMethod: "exact_name", confidence: "medium", product: nameHit };
    
    const lower = productName.toLowerCase().trim();
    const found = cacheArr.find(p => (p.Identity?.ProductName || "").toLowerCase().trim() === lower);
    if (found) {
      return { matched: true, matchMethod: "case_insensitive_name", confidence: "medium", product: found };
    }

    const normSearch = normalizeProductName(productName);
    if (normSearch) {
      const foundNorm = cacheArr.find(p => {
        const pName = p.Identity?.ProductName;
        return pName && normalizeProductName(pName) === normSearch;
      });
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
  return isCarrefour ? memCache.carrefour! : memCache.naivas!;
}

export function normalizeProductName(name: string): string {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/\s*pack /g, '')
    .replace(/\s*p\/kg /g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function interpretProduct(record: any): any {
  if (!record) return { canDisplayGrade: false };

  const validation = record.Validation || {};
  const validationStatus = validation.ReviewState || "pending";
  
  if (validationStatus === "manual_review_required") {
    return { canDisplayGrade: false, validationStatus };
  }

  const classification = record.Classification || {};
  const foodCategory = resolveDisplayCategory(record);
  const nutrientAlgorithmVariant = classification.FSACategoryCode || null;

  if (!nutrientAlgorithmVariant || foodCategory === "Uncategorized") {
    return { canDisplayGrade: false, validationStatus, foodCategory, nutrientAlgorithmVariant };
  }

  const prov = record.NutritionProvenance || {};
  let evidenceTier = "unverified";
  const rawEvidence = prov.EvidenceLevel;
  
  if (["retailer_matched_product", "single_ingredient_known_composition"].includes(rawEvidence)) {
    evidenceTier = "high_confidence";
  } else if (rawEvidence === "category_reference") {
    evidenceTier = "estimated";
  } else if (rawEvidence === "international_fct") {
    evidenceTier = "high_confidence";
  } else if (rawEvidence === "manufacturer") {
    evidenceTier = "verified";
  } else if (rawEvidence === "rejected") {
    evidenceTier = "rejected";
  } else if (rawEvidence === "unverified" || rawEvidence === "recovered_pending_evidence" || rawEvidence === "unresolved" || rawEvidence === "retailer_matched_product_low_confidence" || !rawEvidence) {
    evidenceTier = "unverified";
  }

  const checks = validation.ConsistencyChecks || {};
  const nutrition = record.Nutrition || {};
  const hasCoreNutrients = nutrition.EnergyKJ != null || 
                           nutrition.EnergyKcal != null || 
                           nutrition.SugarsG != null || 
                           nutrition.SaturatedFatG != null || 
                           nutrition.SodiumMG != null || 
                           nutrition.Sodium?.ValueMG != null;
  
  let canDisplayGrade = ["validated", "approved", "approved_conditional", "approved_category_fallback"].includes(validationStatus) 
                          && evidenceTier !== "rejected";

  if (!hasCoreNutrients) {
    canDisplayGrade = false;
  }

  return {
    foodCategory,
    nutrientAlgorithmVariant,
    validationStatus,
    categoryPlausibilityCheck: checks.CategoryPlausibility || "not_checked",
    energyConsistencyCheck: checks.Atwater || "not_checked",
    saltSodiumConsistencyCheck: checks.SaltSodium || "not_checked",
    dataQualityFlags: validation.DataQualityFlags || [],
    evidenceTier,
    valueSpecificity: prov.ValueSpecificity || null,
    sourceReference: prov.SourceID ? { sourceId: prov.SourceID, sourceName: prov.SourceName } : null,
    canDisplayGrade
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

export function generateBucketSlots(
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

export function entryBucketKey(ts: number, bu: string): string {
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
  
  const categoryMap: Record<string, { pts: number; n: number }> = {};
  
  let diabetes = 0;
  let hypertension = 0;
  let cvd = 0;
  let kidney = 0;

  const slots = generateBucketSlots(tf);
  type Acc = { sodium: number; sugar: number; satFat: number; n: number };
  const acc: Record<string, Acc> = {};
  for (const s of slots) acc[s.key] = { sodium: 0, sugar: 0, satFat: 0, n: 0 };

  let validCount = 0;
  let missingCount = 0;

  filteredLedger.forEach(e => {
    // Basket Quality
    counts[e.gradeSnapshot || e.grade] = (counts[e.gradeSnapshot || e.grade] || 0) + 1;
    ptsSum += gradePts[e.gradeSnapshot || e.grade] || 0;
    
    // Category Insights
    const m = categoryMap[e.category] ?? (categoryMap[e.category] = { pts: 0, n: 0 });
    m.pts += gradePts[e.gradeSnapshot || e.grade] ?? 0;
    m.n += 1;

    // Health Alerts
    const sugar = e.nutritionSnapshot?.sugarsG ?? e.sugarsG ?? null;
    const sodium = e.nutritionSnapshot?.sodiumMg ?? e.sodiumMg ?? null;
    const satFat = e.nutritionSnapshot?.satFatG ?? e.satFatG ?? null;
    
    if (sugar !== null) {
      if (Number(sugar) > 22.5) diabetes++;
    }
    if (sodium !== null) {
      if (Number(sodium) > 600) hypertension++;
      if (Number(sodium) > 600) kidney++;
    }
    if (satFat !== null || sodium !== null) {
      if (Number(satFat) > 5 || (Number(sodium) > 400 && Number(sodium) <= 600)) cvd++;
    }

    // Nutrient Trends (Missing vs Zero)
    if (sugar !== null && sodium !== null && satFat !== null) {
      validCount++;
      const key = entryBucketKey(e.addedAt, tf.bucketUnit);
      if (acc[key]) {
        acc[key].sodium  += Number(sodium);
        acc[key].sugar   += Number(sugar);
        acc[key].satFat  += Number(satFat);
        acc[key].n       += 1;
      }
    } else {
      missingCount++;
    }
  });

  const categoryInsights = Object.entries(categoryMap)
    .map(([category, m]) => ({
      category,
      pts: Math.round(m.pts / m.n),
    }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 6);

  const trendData = slots.map((s) => {
    const b = acc[s.key];
    return {
      ts: s.ts,
      label: s.label,
      id: s.key,
      sodiumMg: b.n > 0 ? Math.round(b.sodium / b.n) : null,
      sugarsG: b.n > 0 ? Math.round((b.sugar / b.n) * 10) / 10 : null,
      satFatG: b.n > 0 ? Math.round((b.satFat / b.n) * 10) / 10 : null,
      hasData: b.n > 0,
      sodium: b.n > 0 ? Math.round(b.sodium / b.n) : 0,
      sugar: b.n > 0 ? Math.round((b.sugar / b.n) * 10) / 10 : 0,
      satFat: b.n > 0 ? Math.round((b.satFat / b.n) * 10) / 10 : 0
    };
  });

  return {
    totalStoredEvents: totalStoredCount,
    filteredPeriodEvents: filteredLedger.length,
    basketQuality: {
      averageGrade: "C", // Simplified for now
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
