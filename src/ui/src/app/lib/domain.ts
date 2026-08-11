/**
 * NUT-04 — Shared Domain Utilities
 *
 * This is the single authoritative home for every piece of logic that multiple
 * parts of the extension need to agree on. Nothing here should be reimplemented
 * or forked elsewhere — import from here or from the SW-side domain.js mirror.
 *
 * Exports:
 *  - resolveTimeframe()       → TimeframeResolution
 *  - generateBucketSlots()    → slot array
 *  - entryBucketKey()         → string
 *  - resolveDisplayCategory() → string
 *  - resolveBadgeSignal()     → BadgeSignal
 *  - evaluateHealthAlerts()   → HealthAlertCounts
 */

import type { Grade, ShoppingLedgerRow } from "./nutriscore";

// ─── Timeframe Resolution ────────────────────────────────────────────────────

export type TimeframeKey = "today" | "week" | "month" | "year" | "all";
export type BucketUnit = "hour" | "day" | "week" | "month" | "quarter";

export interface TimeframeResolution {
  key: TimeframeKey;
  windowStart: number;
  windowEnd: number;
  bucketUnit: BucketUnit;
  /** Human-readable label for the x-axis tick at timestamp `ts`. */
  tickLabelFn: (ts: number) => string;
}

/**
 * Compute the canonical time window and chart bucketing for a given period key.
 * Pass `entries` only for "all" (needed to find the oldest event).
 * Pass `now` to override the current time (useful in tests).
 */
export function resolveTimeframe(
  key: TimeframeKey,
  entries: ShoppingLedgerRow[] = [],
  now: number = Date.now(),
): TimeframeResolution {
  const MS_DAY = 86_400_000;
  const todayMidnight = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();

  switch (key) {
    case "today":
      return {
        key,
        windowStart: todayMidnight,
        windowEnd: now,
        bucketUnit: "hour",
        tickLabelFn: (ts) => {
          const h = new Date(ts).getHours();
          if (h === 0) return "12 AM";
          if (h < 12) return `${h} AM`;
          if (h === 12) return "12 PM";
          return `${h - 12} PM`;
        },
      };

    case "week":
      return {
        key,
        windowStart: now - 7 * MS_DAY,
        windowEnd: now,
        bucketUnit: "day",
        tickLabelFn: (ts) =>
          new Date(ts).toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
      };

    case "month": {
      const ms = new Date(now);
      ms.setDate(1);
      ms.setHours(0, 0, 0, 0);
      return {
        key,
        windowStart: ms.getTime(),
        windowEnd: now,
        bucketUnit: "day",
        tickLabelFn: (ts) =>
          new Date(ts).toLocaleString(undefined, { day: "numeric" }),
      };
    }

    case "year":
      return {
        key,
        windowStart: now - 365 * MS_DAY,
        windowEnd: now,
        bucketUnit: "month",
        tickLabelFn: (ts) =>
          new Date(ts).toLocaleString(undefined, { month: "short" }),
      };

    case "all":
    default: {
      const oldest =
        entries.length > 0
          ? Math.min(...entries.map((e) => e.addedAt))
          : now - 30 * MS_DAY;
      const spanDays = (now - oldest) / MS_DAY;
      let bu: BucketUnit;
      let tlFn: (ts: number) => string;
      if (spanDays <= 365) {
        bu = "week";
        tlFn = (ts) => {
          const d = new Date(ts);
          return `${d.getMonth() + 1}/${d.getDate()}`;
        };
      } else if (spanDays <= 365 * 3) {
        bu = "month";
        tlFn = (ts) =>
          new Date(ts).toLocaleString(undefined, {
            month: "short",
            year: "2-digit",
          });
      } else {
        bu = "quarter";
        tlFn = (ts) => {
          const d = new Date(ts);
          return `Q${Math.floor(d.getMonth() / 3) + 1} '${String(d.getFullYear()).slice(2)}`;
        };
      }
      return {
        key,
        windowStart: oldest,
        windowEnd: now,
        bucketUnit: bu,
        tickLabelFn: tlFn,
      };
    }
  }
}

/** Generate every canonical time slot in the resolved window — including empty ones. */
export function generateBucketSlots(
  tf: TimeframeResolution,
): { key: string; ts: number; label: string }[] {
  const { windowStart, windowEnd, bucketUnit, tickLabelFn } = tf;
  const slots: { key: string; ts: number; label: string }[] = [];
  const cursor = new Date(windowStart);

  // Snap cursor to the start of its bucket boundary.
  if (bucketUnit === "hour") {
    cursor.setMinutes(0, 0, 0);
  } else if (bucketUnit === "day") {
    cursor.setHours(0, 0, 0, 0);
  } else if (bucketUnit === "week") {
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  } else if (bucketUnit === "month") {
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
  } else {
    cursor.setMonth(Math.floor(cursor.getMonth() / 3) * 3, 1);
    cursor.setHours(0, 0, 0, 0);
  }

  let safety = 0;
  while (cursor.getTime() <= windowEnd && safety++ < 500) {
    const ts = cursor.getTime();
    slots.push({ key: `${bucketUnit}-${ts}`, ts, label: tickLabelFn(ts) });
    if (bucketUnit === "hour") cursor.setHours(cursor.getHours() + 1);
    else if (bucketUnit === "day") cursor.setDate(cursor.getDate() + 1);
    else if (bucketUnit === "week") cursor.setDate(cursor.getDate() + 7);
    else if (bucketUnit === "month") cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setMonth(cursor.getMonth() + 3);
  }
  return slots;
}

/** Map a single event timestamp to the key of its bucket slot. */
export function entryBucketKey(ts: number, bu: BucketUnit): string {
  const d = new Date(ts);
  if (bu === "hour") {
    const s = new Date(d);
    s.setMinutes(0, 0, 0);
    return `hour-${s.getTime()}`;
  }
  if (bu === "day") {
    const s = new Date(d);
    s.setHours(0, 0, 0, 0);
    return `day-${s.getTime()}`;
  }
  if (bu === "week") {
    const s = new Date(d);
    s.setHours(0, 0, 0, 0);
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    return `week-${s.getTime()}`;
  }
  if (bu === "month")
    return `month-${new Date(d.getFullYear(), d.getMonth(), 1).getTime()}`;
  return `quarter-${new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime()}`;
}

// ─── Category Resolution ─────────────────────────────────────────────────────

/**
 * Resolve the display category for a validated product record.
 * Cascade: NutritionCategory → CanonicalFoodClass → FSACategoryCode → "Uncategorized"
 *
 * For live badge / Category Insights: call on the current product record each time.
 * For ledger rows: call once at cart-add time and freeze the result.
 */
export function resolveDisplayCategory(record: unknown): string {
  if (!record || typeof record !== "object") return "Uncategorized";
  const r = record as Record<string, unknown>;
  const cls = r.Classification as Record<string, unknown> | undefined;
  if (!cls) return "Uncategorized";
  const { NutritionCategory, CanonicalFoodClass, FSACategoryCode } = cls as Record<string, string | undefined>;
  if (NutritionCategory) return NutritionCategory;
  if (CanonicalFoodClass) return CanonicalFoodClass;
  if (FSACategoryCode) return FSACategoryCode;
  return "Uncategorized";
}

// ─── Badge Signal ────────────────────────────────────────────────────────────

/**
 * The four tiers a badge can express, in descending confidence order:
 *  - verified:            product_specific evidence, all consistency checks pass
 *  - estimated_family:    matched product-family / international FCT
 *  - category_reference:  category-average estimate, checks may still pass
 *  - failed:              one or more consistency checks failed, or record not found
 */
export type BadgeTier =
  | "verified"
  | "estimated_family"
  | "category_reference"
  | "failed";

export interface BadgeSignal {
  tier: BadgeTier;
  /** Human-readable provenance label for the flyout, e.g. "Product label" */
  evidenceLabel: string;
  /** Any nutrition fields filled in rather than measured (from EstimatedFields). */
  estimatedFields: string[];
  /** Which consistency checks failed, if any. */
  failedChecks: string[];
}

const EVIDENCE_LABEL: Record<string, string> = {
  product_specific: "Product label",
  international_fct: "Matched reference",
  category_reference: "Category estimate",
};

/**
 * Resolve the badge signal for a validated product record.
 *
 * This is the *single* function that decides what trust tier to show on the
 * badge. It reads the dataset's own Validation.ConsistencyChecks verdict as
 * authoritative — it never overrules it.
 *
 * Returns a structured BadgeSignal rather than throwing so the badge degrades
 * gracefully even when data is partially missing.
 */
export function resolveBadgeSignal(record: unknown): BadgeSignal {
  if (!record || typeof record !== "object") {
    return {
      tier: "failed",
      evidenceLabel: "No data",
      estimatedFields: [],
      failedChecks: ["record_missing"],
    };
  }

  const r = record as Record<string, unknown>;
  const validation = (r.Validation as Record<string, unknown>) ?? {};
  const checks = (validation.ConsistencyChecks as Record<string, string>) ?? {};
  const prov = (r.NutritionProvenance as Record<string, unknown>) ?? {};

  // Collect failed checks from the dataset's own verdict.
  const failedChecks = Object.entries(checks)
    .filter(([, v]) => v === "failed")
    .map(([k]) => k);

  if (failedChecks.length > 0) {
    return {
      tier: "failed",
      evidenceLabel: "Validation failed",
      estimatedFields: [],
      failedChecks,
    };
  }

  const evidenceLevel = (prov.EvidenceLevel as string) ?? "";
  const estimatedFields = Array.isArray(prov.EstimatedFields)
    ? (prov.EstimatedFields as string[])
    : [];

  // Determine tier from evidence level.
  if (evidenceLevel === "product_specific") {
    return {
      tier: "verified",
      evidenceLabel: EVIDENCE_LABEL.product_specific,
      estimatedFields,
      failedChecks: [],
    };
  }

  if (evidenceLevel === "international_fct") {
    return {
      tier: "estimated_family",
      evidenceLabel: EVIDENCE_LABEL.international_fct,
      estimatedFields,
      failedChecks: [],
    };
  }

  if (evidenceLevel === "category_reference") {
    return {
      tier: "category_reference",
      evidenceLabel: EVIDENCE_LABEL.category_reference,
      estimatedFields,
      failedChecks: [],
    };
  }

  // Unknown or missing evidence level — treat as failed.
  return {
    tier: "failed",
    evidenceLabel: "Unknown provenance",
    estimatedFields,
    failedChecks: ["unknown_evidence_level"],
  };
}

// ─── Health Alert Evaluation ─────────────────────────────────────────────────

export interface HealthAlertCounts {
  diabetes: number;
  hypertension: number;
  cvd: number;
  kidney: number;
}

/**
 * Evaluate health alert counts for a filtered set of ledger events.
 *
 * This runs once against the period-filtered population and returns raw counts.
 * User preference toggles (show/hide per condition) are applied at render time
 * only — they must never gate these counts or affect any other analytics.
 */
export function evaluateHealthAlerts(
  rows: ShoppingLedgerRow[],
): HealthAlertCounts {
  let diabetes = 0;
  let hypertension = 0;
  let cvd = 0;
  let kidney = 0;

  for (const e of rows) {
    const { sodiumMg, sugarsG, satFatG } = e.nutritionSnapshot;
    if (typeof sugarsG === "number" && sugarsG > 22.5) diabetes++;
    if (typeof sodiumMg === "number" && sodiumMg > 600) hypertension++;
    if (
      (typeof satFatG === "number" && satFatG > 5) ||
      (typeof sodiumMg === "number" && sodiumMg > 400 && sodiumMg <= 600)
    )
      cvd++;
    if (typeof sodiumMg === "number" && sodiumMg > 600) kidney++;
  }

  return { diabetes, hypertension, cvd, kidney };
}
