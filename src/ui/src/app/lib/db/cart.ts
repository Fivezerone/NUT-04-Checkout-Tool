/**
 * db/cart.ts
 *
 * Shopping-ledger write path: cart event logging, active-cart de-duplication,
 * full cart sync, and pending-cart-sync retry helpers (SW-termination resilient).
 * Extracted from db.ts (SMELL-002 refactor).
 */
import type { Grade, ShoppingLedgerRow } from "../nutriscore";
import { getDB } from "./shared";
import { resolveProductMatch } from "./product-resolution";
import { interpretProduct, computeGradeFromProduct, resolveDisplayCategory } from "./grading";

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

// ── LOGIC-004: Cart diffing extracted as pure functions ─────────────────────

export type CartDiffResult = {
  /** Items from activeInCart that also appear in cartItems (may have changed qty/price). */
  updates: Array<{ row: ShoppingLedgerRow; newQuantity: number; newPrice: number | null; changed: boolean }>;
  /** productIds from cartItems already processed (not new). */
  processedIds: Set<string>;
};

/**
 * LOGIC-004: Pure cart-diff computation — zero I/O, fully property-testable.
 *
 * Determines which active ledger rows match the incoming cart payload and how
 * their quantity/price needs to change. Returns a diff the write-path can apply.
 *
 * @param activeInCart - Currently in_cart rows from IndexedDB (retailer-filtered already).
 * @param cartItems    - Incoming cart payload from the content script.
 */
export function diffCartState(
  activeInCart: ShoppingLedgerRow[],
  cartItems: any[]
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

/**
 * LOGIC-004: Apply the diff's quantity/price updates to IndexedDB in a single transaction.
 * Separated from the pure diff so the write-batch has no branching logic of its own.
 */
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
  const db = await getDB();

  await dedupeActiveCartItems(db);

  // H1 fix: use the "by-status" index — O(current cart size) not O(lifetime ledger).
  const allActiveInCart: ShoppingLedgerRow[] = await db.getAllFromIndex(
    "shopping_ledger",
    "by-status",
    "in_cart" as any
  );
  const activeInCart = allActiveInCart.filter(r => r.retailer === retailer);
  const now = Date.now();

  // LOGIC-004: pure diff, then separate write batch.
  const diff = diffCartState(activeInCart, cartItems);
  await applyCartDiff(db, diff);

  // Add new items that weren't in the existing ledger.
  for (const item of cartItems) {
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

export async function deleteLedgerEntry(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("shopping_ledger", id);
}

// ── M2: Pending cart-sync helpers (SW-termination-resilient alarm retry) ─────

/**
 * Persists a cart-sync payload before attempting it. Returns a stable job ID.
 * Called by the SYNC_CART_STATE handler in background.js immediately before
 * invoking syncCart(), so a mid-flight SW kill leaves a durable retry record.
 */
export async function savePendingCartSync(
  payload: { retailer: string; items: any[] }
): Promise<string> {
  const db = await getDB();
  const id = `pcs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.put("pending_cart_syncs", {
    id,
    retailer: payload.retailer,
    items: payload.items,
    savedAt: Date.now(),
  });
  return id;
}

/**
 * Removes a pending cart-sync job after it has been successfully processed.
 */
export async function clearPendingCartSync(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("pending_cart_syncs", id);
}

/**
 * Returns all pending cart-sync jobs. Used by the alarm handler to drain any
 * payloads left over from a previous SW invocation that was killed mid-flight.
 */
export async function getPendingCartSyncs(): Promise<
  Array<{ id: string; retailer: string; items: any[]; savedAt: number }>
> {
  const db = await getDB();
  return db.getAll("pending_cart_syncs");
}
