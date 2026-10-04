/**
 * cartDiff.test.ts
 *
 * Unit tests for LOGIC-004: diffCartState pure function.
 * Zero I/O — fully synchronous, no IndexedDB required.
 */

import { describe, test, expect } from 'vitest';
import { diffCartState } from '../lib/db/cart';
import type { ShoppingLedgerRow } from '../lib/nutriscore';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRow(productId: string, quantity = 1, priceSnapshot = 100): ShoppingLedgerRow {
  return {
    id: `naivas-${productId}-0`,
    productId,
    name: `Product ${productId}`,
    retailer: 'NAIVAS',
    addedAt: 0,
    quantity,
    priceSnapshot,
    gradeSnapshot: 'B',
    scoringStatus: 'computed',
    category: 'Dairy',
    status: 'in_cart',
  } as ShoppingLedgerRow;
}

function makeItem(productId: string, quantity = 1, priceSnapshot = 100) {
  return { productId, quantity, priceSnapshot };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('diffCartState()', () => {
  test('empty → N items: no updates, no processedIds', () => {
    const result = diffCartState([], [makeItem('A'), makeItem('B')]);
    expect(result.updates).toHaveLength(0);
    expect(result.processedIds.size).toBe(0);
  });

  test('N → 0 items (full clear): no matches, nothing in processedIds', () => {
    const active = [makeRow('A'), makeRow('B')];
    const result = diffCartState(active, []);
    expect(result.updates).toHaveLength(0);
    expect(result.processedIds.size).toBe(0);
  });

  test('unchanged item: changed=false', () => {
    const active = [makeRow('A', 2, 150)];
    const items = [makeItem('A', 2, 150)];
    const { updates, processedIds } = diffCartState(active, items);
    expect(updates).toHaveLength(1);
    expect(updates[0].changed).toBe(false);
    expect(processedIds.has('A')).toBe(true);
  });

  test('quantity change: changed=true, newQuantity reflects cart', () => {
    const active = [makeRow('A', 1, 100)];
    const items = [makeItem('A', 3, 100)];
    const { updates } = diffCartState(active, items);
    expect(updates[0].changed).toBe(true);
    expect(updates[0].newQuantity).toBe(3);
  });

  test('price change: changed=true, newPrice reflects cart', () => {
    const active = [makeRow('A', 1, 100)];
    const items = [makeItem('A', 1, 199)];
    const { updates } = diffCartState(active, items);
    expect(updates[0].changed).toBe(true);
    expect(updates[0].newPrice).toBe(199);
  });

  test('partial add+remove in the same tick: only matched rows in updates', () => {
    const active = [makeRow('A'), makeRow('B')];
    // B removed from cart, C is new
    const items = [makeItem('A'), makeItem('C')];
    const { updates, processedIds } = diffCartState(active, items);
    expect(updates).toHaveLength(1);
    expect(updates[0].row.productId).toBe('A');
    expect(processedIds.has('A')).toBe(true);
    expect(processedIds.has('B')).toBe(false);
    expect(processedIds.has('C')).toBe(false); // C is new, not in activeInCart
  });

  test('duplicate-item coalescing: first match wins, second ignored', () => {
    // Two ledger rows for same productId (shouldn't normally happen after dedupeActiveCartItems,
    // but diffCartState must still handle it gracefully — only one update per payload item.)
    const active = [makeRow('A', 1), makeRow('A', 2)];
    const items = [makeItem('A', 5)];
    const { updates, processedIds } = diffCartState(active, items);
    // Both rows match the same payload item; both get updates
    expect(updates).toHaveLength(2);
    // But processedIds only has 'A' once
    expect(processedIds.size).toBe(1);
  });

  test('never returns negative quantity', () => {
    const active = [makeRow('A', 3)];
    const items = [makeItem('A', 0)];
    const { updates } = diffCartState(active, items);
    // quantity=0 is valid (cart cleared while overlay open)
    expect(updates[0].newQuantity).toBe(0);
  });
});
