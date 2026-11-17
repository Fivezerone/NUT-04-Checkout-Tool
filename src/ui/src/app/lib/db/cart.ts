/**
 * db/cart.ts
 *
 * Shopping-ledger write path: cart event logging, active-cart de-duplication,
 * full cart sync, Ledger v2 snapshot application, and pending-cart-sync retry helpers.
 * Reference: Blueprint §2.3 (C5; E-08, E-09, E-10, E-13, ADR-005)
 * Flag: ns.ledger.v2
 */
import type { Grade, ShoppingLedgerRow, LedgerRow } from "../nutriscore";
import { getDB } from "./shared";
import { resolveProductMatch } from "./product-resolution";
import { interpretProduct, computeGradeFromProduct, resolveDisplayCategory } from "./grading";

export type { LedgerRow };

export type CartItemInput = {
  productId: string;
  product_name: string | null;
  quantity: number;
  priceSnapshot: number | null;
  retailer: string | null;
};

export const RETENTION_90_DAYS_MS = 90 * 24 * 60 * 60 * 1000; // 7,776,000,000 ms (90 days, ADR-005)

// ── Feature Flag Evaluation ───────────────────────────────────────────────────
export function isLedgerV2Enabled(): boolean {
  if (typeof self !== "undefined" && (self as any).NutriFlags?.isEnabled) {
    return Boolean((self as any).NutriFlags.isEnabled("ns.ledger.v2"));
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).__NUTRI_FLAGS__?.["ns.ledger.v2"] !== undefined) {
    return Boolean((globalThis as any).__NUTRI_FLAGS__["ns.ledger.v2"]);
  }
  return false;
}

export function validateCartItem(v: unknown): CartItemInput {
  if (!v || typeof v !== "object") throw new Error("INVALID_CART_ITEM");
  const i = v as Record<string, unknown>;
  if (typeof i.productId !== "string" || !i.productId.trim()) throw new Error("INVALID_PRODUCT_ID");
  const q = i.quantity == null ? 1 : Number(i.quantity);
  if (!Number.isFinite(q) || q <= 0) throw new Error("INVALID_QUANTITY");
  const p = i.priceSnapshot == null ? null : Number(i.priceSnapshot);
  if (p !== null && (!Number.isFinite(p) || p < 0)) throw new Error("INVALID_PRICE");
  return {
    productId: i.productId.trim(),
    product_name: typeof i.product_name === "string" ? i.product_name : null,
    quantity: q,
    priceSnapshot: p,
    retailer: typeof i.retailer === "string" ? i.retailer : null,
  };
}

/**
 * Normalizes a stored ledger row on read, applying non-breaking defaults for
 * legacy records created prior to IndexedDB v19 (Blueprint §2.3 item 5).
 */
export function normalizeLedgerRow(row: any): LedgerRow {
  if (!row) return row;
  const gradeSnapshot = row.gradeSnapshot === "UNKNOWN" ? null : (row.gradeSnapshot ?? null);
  const scoringStatus = row.scoringStatus || (gradeSnapshot ? "scored" : "unscored");
  const unitPriceMinor =
    row.unitPriceMinor ?? (row.priceSnapshot != null ? Math.round(row.priceSnapshot * 100) : null);
  const priceSnapshot = row.priceSnapshot ?? (unitPriceMinor != null ? unitPriceMinor / 100 : null);
  const firstSeenAt = row.firstSeenAt || row.addedAt || Date.now();
  const updatedAt = row.updatedAt || row.addedAt || firstSeenAt;

  return {
    ...row,
    retailerProductId: row.retailerProductId || row.productId,
    productId: row.productId ?? null,
    quantity: row.quantity ?? 1,
    status: row.status || "in_cart",
    scoringStatus,
    gradeSnapshot,
    unitPriceMinor,
    priceSnapshot,
    category: row.category || "General",
    cartEpisodeId: row.cartEpisodeId || "legacy-episode",
    clientSeq: row.clientSeq ?? 0,
    versions: row.versions || { scoring: "v4", catalogue: "legacy", profile: null },
    firstSeenAt,
    updatedAt,
    addedAt: row.addedAt || firstSeenAt,
  };
}

/**
 * Atomically generates monotonic client sequence number per installation.
 * Uses Web Locks API ('ns-seq') to guarantee race-free serialization across tabs.
 */
export async function getNextClientSeq(): Promise<number> {
  const getAndIncrement = async (): Promise<number> => {
    let current: number;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const res = await chrome.storage.local.get("ns_client_seq");
      current = (Number(res?.ns_client_seq) || 0) + 1;
      await chrome.storage.local.set({ ns_client_seq: current });
    } else if (typeof localStorage !== "undefined") {
      const res = localStorage.getItem("ns_client_seq");
      current = (Number(res) || 0) + 1;
      localStorage.setItem("ns_client_seq", String(current));
    } else {
      if (!(globalThis as any).__NS_CLIENT_SEQ__) (globalThis as any).__NS_CLIENT_SEQ__ = 0;
      (globalThis as any).__NS_CLIENT_SEQ__ += 1;
      current = (globalThis as any).__NS_CLIENT_SEQ__;
    }
    return current;
  };

  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request("ns-seq", async () => {
      return getAndIncrement();
    });
  }
  return getAndIncrement();
}

/**
 * Generates or retrieves stable episode ID for the retailer shopping session.
 */
export function getOrCreateCartEpisodeId(retailer: string): string {
  const key = `ns_cart_episode_${retailer.toLowerCase()}`;
  if (typeof sessionStorage !== "undefined") {
    let ep = sessionStorage.getItem(key);
    if (!ep) {
      ep = `ep-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem(key, ep);
    }
    return ep;
  }
  if (typeof globalThis !== "undefined") {
    const g = globalThis as any;
    if (!g.__NS_EPISODES__) g.__NS_EPISODES__ = {};
    if (!g.__NS_EPISODES__[key]) {
      g.__NS_EPISODES__[key] = `ep-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
    return g.__NS_EPISODES__[key];
  }
  return `ep-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── In-Memory Hysteresis Tracker for Removed Cart Items ───────────────────────
export const _consecutiveAbsentMap = new Map<string, number>();

export function resetConsecutiveAbsentTracker(): void {
  _consecutiveAbsentMap.clear();
}

// ── Ledger v2: applyCartSnapshot (Blueprint §2.3) ─────────────────────────────
/**
 * Applies adapter cart snapshot as a derived, versioned, bounded projection.
 *
 * Invariants Enforced:
 * 1. Single readwrite transaction over shopping_ledger.
 * 2. Set (not add) quantity for matched rows (E-08).
 * 3. Insert new rows (whether scored, unscored or unmatched; never skipped - E-09).
 * 4. Mark rows absent from two consecutive snapshots as 'removed' (hysteresis stops flapping).
 * 5. Monotonic clientSeq and episodeId recorded on each row (E-10).
 */
export async function applyCartSnapshot(
  retailer: string,
  snapshot: CartItemInput[] | any[]
): Promise<{ added: number; updated: number; removed: number }> {
  const db = await getDB();
  const ret = (retailer || "NAIVAS").toUpperCase();
  const now = Date.now();
  const clientSeq = await getNextClientSeq();
  const episodeId = getOrCreateCartEpisodeId(ret);

  const validatedItems = (snapshot || []).map(validateCartItem);
  const snapshotProductIds = new Set(validatedItems.map(i => i.productId));

  let added = 0;
  let updated = 0;
  let removed = 0;

  // 1. Single readwrite transaction over shopping_ledger
  const tx = db.transaction("shopping_ledger", "readwrite");
  const store = tx.store;

  // Query existing in_cart items
  const allActive: ShoppingLedgerRow[] = await (store.index("by-status") as any).getAll("in_cart");
  const activeInCart = allActive.filter(r => (r.retailer || "").toUpperCase() === ret);

  const activeMap = new Map<string, ShoppingLedgerRow>();
  for (const row of activeInCart) {
    const key = (row as any).retailerProductId || row.productId;
    activeMap.set(key, row);
  }

  // 2. Set (not add) quantity for matched rows; insert new rows
  for (const item of validatedItems) {
    const existing = activeMap.get(item.productId);
    if (existing) {
      existing.quantity = item.quantity; // SET, NEVER ADD (E-08)
      if (item.priceSnapshot != null) {
        existing.priceSnapshot = item.priceSnapshot;
        (existing as any).unitPriceMinor = Math.round(item.priceSnapshot * 100);
      }
      (existing as any).updatedAt = now;
      (existing as any).clientSeq = clientSeq;
      (existing as any).cartEpisodeId = episodeId;
      await store.put(existing);
      updated++;
      _consecutiveAbsentMap.delete(`${ret}:${item.productId}`);
    } else {
      let scoringStatus: "scored" | "unscored" | "unmatched";
      let productId: string | null = null;
      let gradeSnapshot: Grade | null = null;
      let name = item.product_name || "Unknown Product";
      let category = "General";
      let nutrition = null;

      try {
        const matchResult = await resolveProductMatch(ret, item.productId, null, item.product_name || null);
        if (matchResult.matched && matchResult.product) {
          const p = matchResult.product;
          productId = String(p.Identity?.ProductID || p.productId || item.productId);
          name = p.Identity?.ProductName || p.GroceryProductName || p.name || item.product_name || name;
          category = resolveDisplayCategory(p);
          nutrition = {
            sodiumMg: p.Nutrition?.SodiumMG ?? null,
            sugarsG: p.Nutrition?.SugarsG ?? null,
            satFatG: p.Nutrition?.SaturatedFatG ?? null,
            potassiumMg: p.Nutrition?.PotassiumMG ?? p.Nutrition?.Potassium?.ValueMG ?? null,
            energyKcal: p.Nutrition?.EnergyKcal ?? (p.Nutrition?.EnergyKJ ? p.Nutrition?.EnergyKJ / 4.184 : null),
          };
          const interpretation = interpretProduct(p);
          if (interpretation.canDisplayGrade) {
            const gradeResult = computeGradeFromProduct(p);
            if (gradeResult.grade && gradeResult.grade !== "UNKNOWN") {
              scoringStatus = "scored";
              gradeSnapshot = gradeResult.grade;
            } else {
              scoringStatus = "unscored";
            }
          } else {
            scoringStatus = "unscored";
          }
        } else {
          scoringStatus = "unmatched";
        }
      } catch {
        scoringStatus = "unmatched";
      }

      const newRow: LedgerRow = {
        id: crypto.randomUUID(),
        retailer: ret,
        retailerProductId: item.productId,
        productId,
        name,
        quantity: item.quantity,
        status: "in_cart",
        scoringStatus,
        gradeSnapshot,
        unitPriceMinor: item.priceSnapshot != null ? Math.round(item.priceSnapshot * 100) : null,
        priceSnapshot: item.priceSnapshot,
        category,
        cartEpisodeId: episodeId,
        clientSeq,
        versions: {
          scoring: "v5",
          catalogue: "current",
          profile: null,
        },
        firstSeenAt: now,
        updatedAt: now,
        addedAt: now,
        nutritionSnapshot: nutrition,
      };

      await store.put(newRow as any);
      added++;
      _consecutiveAbsentMap.delete(`${ret}:${item.productId}`);
    }
  }

  // 3. Mark rows absent from two consecutive snapshots as 'removed' (hysteresis stops flapping)
  for (const [prodId, existing] of activeMap.entries()) {
    if (!snapshotProductIds.has(prodId)) {
      const absentKey = `${ret}:${prodId}`;
      const count = (_consecutiveAbsentMap.get(absentKey) || 0) + 1;
      if (count >= 2) {
        existing.status = "removed";
        (existing as any).updatedAt = now;
        (existing as any).clientSeq = clientSeq;
        await store.put(existing);
        _consecutiveAbsentMap.delete(absentKey);
        removed++;
      } else {
        _consecutiveAbsentMap.set(absentKey, count);
      }
    }
  }

  await tx.done;
  return { added, updated, removed };
}

/**
 * Persists an individual cart event.
 * Fixed under E-08: Sets quantity to last known instead of summing.
 */
export async function logCartEvent(row: ShoppingLedgerRow): Promise<void> {
  const db = await getDB();
  if (row.status === "in_cart") {
    const existing = await db.getFromIndex(
      "shopping_ledger",
      "by-retailer-product-status",
      [row.retailer, row.productId, "in_cart"] as any
    );
    if (existing && existing.id !== row.id) {
      // E-08: Set quantity (last known, never summed)
      existing.quantity = row.quantity || 1;
      if (row.priceSnapshot != null) existing.priceSnapshot = row.priceSnapshot;
      if ((row as any).unitPriceMinor != null) (existing as any).unitPriceMinor = (row as any).unitPriceMinor;
      (existing as any).updatedAt = (row as any).updatedAt || Date.now();
      await db.put("shopping_ledger", existing);
      return;
    }
  }
  await db.put("shopping_ledger", row);
}

export async function getAllEntries(): Promise<ShoppingLedgerRow[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("shopping_ledger", "by-addedAt");
  return all.map(normalizeLedgerRow).reverse() as any; // newest first
}

export async function getAllLedgerRows(): Promise<LedgerRow[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("shopping_ledger", "by-addedAt");
  return all.map(normalizeLedgerRow).reverse();
}

// ── LOGIC-004: Cart diffing extracted as pure functions ─────────────────────

export type CartDiffResult = {
  updates: Array<{ row: ShoppingLedgerRow; newQuantity: number; newPrice: number | null; changed: boolean }>;
  processedIds: Set<string>;
};

export function diffCartState(
  activeInCart: ShoppingLedgerRow[],
  cartItems: CartItemInput[]
): CartDiffResult {
  const processedIds = new Set<string>();
  const updates: CartDiffResult["updates"] = [];

  for (const row of activeInCart) {
    const cartMatch = cartItems.find(c => c.productId === row.productId);
    if (!cartMatch) continue;

    const changed =
      row.quantity !== cartMatch.quantity ||
      row.priceSnapshot !== cartMatch.priceSnapshot;

    updates.push({
      row,
      newQuantity: cartMatch.quantity,
      newPrice: cartMatch.priceSnapshot ?? null,
      changed,
    });
    processedIds.add(cartMatch.productId);
  }

  return { updates, processedIds };
}

async function applyCartDiff(db: any, diff: CartDiffResult): Promise<void> {
  if (diff.updates.length === 0) return;
  const tx = db.transaction("shopping_ledger", "readwrite");
  const store = tx.store;
  for (const { row, newQuantity, newPrice, changed } of diff.updates) {
    if (!changed) continue;
    row.quantity = newQuantity;
    if (newPrice !== null) row.priceSnapshot = newPrice;
    await store.put(row);
  }
  await tx.done;
}

export async function syncCart(retailer: string, cartItems: any[]): Promise<void> {
  if (isLedgerV2Enabled()) {
    await applyCartSnapshot(retailer, cartItems);
    return;
  }

  // Legacy syncCart path retained for rollback safety
  const db = await getDB();
  await dedupeActiveCartItems(db);

  const allActiveInCart: ShoppingLedgerRow[] = await db.getAllFromIndex(
    "shopping_ledger",
    "by-status",
    "in_cart" as any
  );
  const activeInCart = allActiveInCart.filter(r => r.retailer === retailer);
  const now = Date.now();

  const validatedItems = cartItems.map(validateCartItem);
  const diff = diffCartState(activeInCart, validatedItems);
  await applyCartDiff(db, diff);

  for (const item of validatedItems) {
    if (diff.processedIds.has(item.productId)) continue;

    const matchResult = await resolveProductMatch(
      retailer,
      item.productId,
      null,
      item.product_name || null
    );

    if (!matchResult.matched || !matchResult.product) continue;
    const p = matchResult.product;
    const interpretation = interpretProduct(p);
    if (!interpretation.canDisplayGrade) continue;

    const name = p.Identity?.ProductName || p.GroceryProductName || p.name || item.product_name || "Unknown Product";
    const gradeResult = computeGradeFromProduct(p);
    const gradeSnapshot: Grade | "UNKNOWN" = gradeResult.grade;
    const category = resolveDisplayCategory(p);
    const nutrition = {
      sodiumMg: p.Nutrition?.SodiumMG ?? null,
      sugarsG: p.Nutrition?.SugarsG ?? null,
      satFatG: p.Nutrition?.SaturatedFatG ?? null,
      potassiumMg: p.Nutrition?.PotassiumMG ?? p.Nutrition?.Potassium?.ValueMG ?? null,
      energyKcal: p.Nutrition?.EnergyKcal ?? (p.Nutrition?.EnergyKJ ? p.Nutrition?.EnergyKJ / 4.184 : null)
    };

    const newRow: ShoppingLedgerRow = {
      id: crypto.randomUUID(),
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

/**
 * Deduplicates active in_cart items.
 * Fixed under E-08: Keeps the last-writer row by updatedAt instead of summing quantities.
 */
export async function dedupeActiveCartItems(dbInstance?: any): Promise<void> {
  const db = dbInstance || await getDB();
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
      // E-08: Keep the last-writer row by updatedAt/addedAt instead of summing
      const itemTime = (item as any).updatedAt || item.addedAt || 0;
      const existingTime = (existing as any).updatedAt || existing.addedAt || 0;
      if (itemTime > existingTime) {
        toDelete.push(existing.id);
        map.set(key, item);
      } else {
        toDelete.push(item.id);
      }
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

export async function deleteLedgerEntry(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("shopping_ledger", id);
}

/**
 * ADR-005 & §4.10: 90-Day Device Storage Ceiling
 * Purges shopping ledger entries older than the cutoff timestamp (default: 90 days ago).
 */
export async function purgeLedgerOlderThan(cutoff?: number): Promise<number> {
  const db = await getDB();
  const actualCutoff = cutoff ?? (Date.now() - RETENTION_90_DAYS_MS);
  const range =
    typeof IDBKeyRange !== "undefined"
      ? IDBKeyRange.upperBound(actualCutoff, true)
      : ({ upper: actualCutoff, upperOpen: true } as any);
  const tx = db.transaction("shopping_ledger", "readwrite");
  const index = tx.store.index("by-addedAt");
  let cursor = await index.openCursor(range);
  let count = 0;
  while (cursor) {
    await cursor.delete();
    count++;
    cursor = await cursor.continue();
  }
  await tx.done;
  return count;
}

/**
 * Retrieves shopping ledger entries added on or after the start timestamp.
 */
export async function getEntriesSince(start: number): Promise<ShoppingLedgerRow[]> {
  const db = await getDB();
  const range =
    typeof IDBKeyRange !== "undefined"
      ? IDBKeyRange.lowerBound(start)
      : ({ lower: start, lowerOpen: false } as any);
  const all = await db.getAllFromIndex("shopping_ledger", "by-addedAt", range);
  return all.map(normalizeLedgerRow).reverse() as any; // newest first
}

/**
 * Computes Coverage C and unscored spend share for the Adherence and Variance Engine
 * (Blueprint §2.3 item 4, §3.1, §3.3).
 */
export function computeCartCoverage(rows: Array<ShoppingLedgerRow | LedgerRow>): {
  coverageC: number;
  unscoredShare: number;
  totalSpendMinor: number;
  scoredSpendMinor: number;
  unscoredSpendMinor: number;
  unmatchedSpendMinor: number;
} {
  let totalSpendMinor = 0;
  let scoredSpendMinor = 0;
  let unscoredSpendMinor = 0;
  let unmatchedSpendMinor = 0;

  for (const row of rows) {
    const qty = row.quantity || 1;
    const priceMinor =
      (row as any).unitPriceMinor ??
      (row.priceSnapshot != null ? Math.round(row.priceSnapshot * 100) : 0);
    const itemSpend = qty * priceMinor;
    totalSpendMinor += itemSpend;

    const status = (row as any).scoringStatus;
    if (status === "scored" || (status === undefined && row.gradeSnapshot && row.gradeSnapshot !== "UNKNOWN")) {
      scoredSpendMinor += itemSpend;
    } else if (status === "unscored") {
      unscoredSpendMinor += itemSpend;
    } else if (status === "unmatched") {
      unmatchedSpendMinor += itemSpend;
    } else {
      unscoredSpendMinor += itemSpend;
    }
  }

  const coverageC = totalSpendMinor > 0 ? Number((scoredSpendMinor / totalSpendMinor).toFixed(4)) : 0;
  const unscoredShare =
    totalSpendMinor > 0 ? Number(((unscoredSpendMinor + unmatchedSpendMinor) / totalSpendMinor).toFixed(4)) : 0;

  return {
    coverageC,
    unscoredShare,
    totalSpendMinor,
    scoredSpendMinor,
    unscoredSpendMinor,
    unmatchedSpendMinor,
  };
}

// ── M2: Pending cart-sync helpers (SW-termination-resilient alarm retry) ─────

export async function savePendingCartSync(
  payload: { retailer: string; items: any[] }
): Promise<string> {
  const db = await getDB();
  const id = payload.retailer; // stable, bounded key
  await db.put("pending_cart_syncs", {
    id,
    retailer: payload.retailer,
    items: payload.items,
    savedAt: Date.now(),
  });
  return id;
}

export async function clearPendingCartSync(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("pending_cart_syncs", id);
}

export async function getPendingCartSyncs(): Promise<
  Array<{ id: string; retailer: string; items: any[]; savedAt: number }>
> {
  const db = await getDB();
  return db.getAll("pending_cart_syncs");
}
