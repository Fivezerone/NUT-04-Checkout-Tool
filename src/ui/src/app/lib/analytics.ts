/**
 * NUT-04 — Analytics Engine
 *
 * The single pipeline that turns raw ledger rows into the DashboardViewModel.
 * No UI component should compute its own filtered set or aggregate its own
 * nutrition numbers — every component renders from the output of this function.
 *
 * Pipeline:
 *   resolveTimeframe()
 *     → filter to window + status ∈ {in_cart, purchased}
 *     → calculateAnalytics()
 *     → DashboardViewModel
 */

import {
  resolveTimeframe,
  generateBucketSlots,
  entryBucketKey,
  evaluateHealthAlerts,
  type TimeframeKey,
} from "./domain";
import { GRADE_ORDER, type Grade, type ShoppingLedgerRow } from "./nutriscore";

// ─── Drilldown ───────────────────────────────────────────────────────────────

export interface Drilldown {
  grade?: Grade;
  category?: string;
}

// ─── DashboardViewModel (canonical shape) ────────────────────────────────────

export interface NutrientTrendPoint {
  /** Bucket slot key (matches generateBucketSlots key). */
  id: string;
  label: string;
  ts: number;
  /** Averages — null when no valid measurements exist in this slot. */
  sodiumMg: number | null;
  sugarsG: number | null;
  satFatG: number | null;
  /** How many rows had real (non-null) values for at least one nutrient. */
  validCount: number;
  /** How many rows had ALL three nutrients null. */
  missingCount: number;
}

export interface DashboardViewModel {
  // ── Period ──────────────────────────────────────────────────────────────
  period: {
    key: TimeframeKey;
    windowStart: number;
    windowEnd: number;
    bucketUnit: string;
  };

  // ── Event counts ─────────────────────────────────────────────────────────
  /** Total rows in the ledger, regardless of period or status. */
  totalStoredEvents: number;
  /** Rows inside the selected period with status in_cart or purchased. */
  filteredPeriodEvents: number;
  /** Rows inside the period AND matching the optional drilldown filter. */
  drilldownEvents: number;

  // ── Active drilldown ─────────────────────────────────────────────────────
  drilldown: Drilldown | null;

  // ── Basket Quality ───────────────────────────────────────────────────────
  basketQuality: {
    /**
     * Distribution is the source of truth. totalItems is derived from it:
     *   totalItems = sum(Object.values(distribution))
     * A separate totalItems counter must never exist — that's the invariant
     * the architecture enforces to prevent the "1,371 vs 1,370" class of bug.
     */
    distribution: Record<Grade, number>;
  };

  // ── Nutrient Trends ───────────────────────────────────────────────────────
  nutrientTrends: {
    ticks: { ts: number; label: string }[];
    data: NutrientTrendPoint[];
    /** Grand totals across the whole period for debugging. */
    totalValidRows: number;
    totalMissingRows: number;
  };

  // ── Category Insights ─────────────────────────────────────────────────────
  categoryInsights: { category: string; pts: number; count: number }[];

  // ── Health Alerts (full counts — preferences applied at render time) ──────
  healthAlerts: {
    diabetes: number;
    hypertension: number;
    cvd: number;
    kidney: number;
  };

  // ── Ledger ────────────────────────────────────────────────────────────────
  ledger: {
    /** Rows to display in the current page of the ledger table. */
    rows: ShoppingLedgerRow[];
    /** Total count subject to period + drilldown filter (for pagination). */
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
}

// ─── Grade negative-point weights (for Category Insights) ────────────────────
const GRADE_PTS: Record<string, number> = { A: 1, B: 3, C: 7, D: 12, E: 20 };

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Calculate the full DashboardViewModel from raw ledger rows.
 *
 * @param allRows   Every row in the shopping_ledger store (any status, any date)
 * @param tfKey     The period selector value (today/week/month/year/all)
 * @param drilldown Optional grade/category filter composing with the period
 * @param page      Current ledger page (0-indexed)
 * @param pageSize  Rows per ledger page
 * @param now       Override for current time (useful in tests)
 */
export function calculateDashboardViewModel(
  allRows: ShoppingLedgerRow[],
  tfKey: TimeframeKey,
  drilldown: Drilldown | null = null,
  page = 0,
  pageSize = 8,
  now: number = Date.now(),
): DashboardViewModel {
  // ── Step 1: Resolve timeframe once. Every downstream step reads from this. ──
  const tf = resolveTimeframe(tfKey, allRows, now);

  // ── Step 2: Filter to period + active statuses. ────────────────────────────
  // "removed" rows are excluded — they must never contribute to any total.
  const periodRows = allRows.filter(
    (r) =>
      r.addedAt >= tf.windowStart &&
      r.addedAt <= tf.windowEnd &&
      (r.status === "in_cart" || r.status === "purchased"),
  );

  // ── Step 3: Apply drilldown as a second, optional filter layer. ────────────
  const drilldownRows =
    drilldown
      ? periodRows.filter((r) => {
          if (drilldown.grade && r.gradeSnapshot !== drilldown.grade)
            return false;
          if (drilldown.category && r.category !== drilldown.category)
            return false;
          return true;
        })
      : periodRows;

  // ── Step 4: Basket Quality ────────────────────────────────────────────────
  const distribution: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const r of periodRows) {
    if (r.gradeSnapshot in distribution) {
      distribution[r.gradeSnapshot] += 1;
    }
  }
  // totalItems is never stored separately — always derive:  sum(distribution)

  // ── Step 5: Nutrient Trends ───────────────────────────────────────────────
  const slots = generateBucketSlots(tf);
  type Acc = {
    sodiumSum: number;
    sugarsSum: number;
    satFatSum: number;
    validCount: number;
    missingCount: number;
  };
  const acc: Record<string, Acc> = {};
  for (const s of slots) {
    acc[s.key] = {
      sodiumSum: 0,
      sugarsSum: 0,
      satFatSum: 0,
      validCount: 0,
      missingCount: 0,
    };
  }

  for (const r of periodRows) {
    const key = entryBucketKey(r.addedAt, tf.bucketUnit as Parameters<typeof entryBucketKey>[1]);
    if (!(key in acc)) continue;
    const snap = r.nutritionSnapshot;
    const hasSodium = typeof snap.sodiumMg === "number";
    const hasSugars = typeof snap.sugarsG === "number";
    const hasSatFat = typeof snap.satFatG === "number";

    if (!hasSodium && !hasSugars && !hasSatFat) {
      acc[key].missingCount += 1;
    } else {
      acc[key].validCount += 1;
      if (hasSodium) acc[key].sodiumSum += snap.sodiumMg as number;
      if (hasSugars) acc[key].sugarsSum += snap.sugarsG as number;
      if (hasSatFat) acc[key].satFatSum += snap.satFatG as number;
    }
  }

  const trendData: NutrientTrendPoint[] = slots.map((s) => {
    const b = acc[s.key];
    const v = b.validCount;
    return {
      id: s.key,
      label: s.label,
      ts: s.ts,
      // null means "no data in this slot" — never coerce to 0.
      sodiumMg: v > 0 ? Math.round(b.sodiumSum / v) : null,
      sugarsG: v > 0 ? Math.round((b.sugarsSum / v) * 10) / 10 : null,
      satFatG: v > 0 ? Math.round((b.satFatSum / v) * 10) / 10 : null,
      validCount: b.validCount,
      missingCount: b.missingCount,
    };
  });

  const totalValidRows = trendData.reduce((s, d) => s + d.validCount, 0);
  const totalMissingRows = trendData.reduce((s, d) => s + d.missingCount, 0);

  // ── Step 6: Category Insights ─────────────────────────────────────────────
  const catMap: Record<string, { pts: number; n: number }> = {};
  for (const r of periodRows) {
    const m = catMap[r.category] ?? (catMap[r.category] = { pts: 0, n: 0 });
    m.pts += GRADE_PTS[r.gradeSnapshot] ?? 0;
    m.n += 1;
  }
  const categoryInsights = Object.entries(catMap)
    .map(([category, m]) => ({
      category,
      pts: Math.round(m.pts / m.n),
      count: m.n,
    }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 6);

  // ── Step 7: Health Alerts ─────────────────────────────────────────────────
  // Full counts, all four conditions — preferences applied at render time only.
  const healthAlerts = evaluateHealthAlerts(periodRows);

  // ── Step 8: Ledger pagination ─────────────────────────────────────────────
  const ledgerSource = drilldownRows; // ledger always shows drilldown-filtered rows
  const pageCount = Math.max(1, Math.ceil(ledgerSource.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const ledgerRows = ledgerSource.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  );

  // ── Assemble ──────────────────────────────────────────────────────────────
  return {
    period: {
      key: tf.key,
      windowStart: tf.windowStart,
      windowEnd: tf.windowEnd,
      bucketUnit: tf.bucketUnit,
    },
    totalStoredEvents: allRows.filter(
      (r) => r.status === "in_cart" || r.status === "purchased",
    ).length,
    filteredPeriodEvents: periodRows.length,
    drilldownEvents: drilldownRows.length,
    drilldown,
    basketQuality: { distribution },
    nutrientTrends: {
      ticks: slots.map((s) => ({ ts: s.ts, label: s.label })),
      data: trendData,
      totalValidRows,
      totalMissingRows,
    },
    categoryInsights,
    healthAlerts,
    ledger: {
      rows: ledgerRows,
      total: ledgerSource.length,
      page: safePage,
      pageSize,
      pageCount,
    },
  };
}

/** Derive totalItems from basketQuality.distribution. Never maintain a parallel counter. */
export function deriveTotalItems(distribution: Record<Grade, number>): number {
  return GRADE_ORDER.reduce((sum, g) => sum + (distribution[g] ?? 0), 0);
}
