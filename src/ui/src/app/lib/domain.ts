/* NUT-04 — Shared Domain Utilities
 *
 * Exports:
 *  - resolveDisplayCategory() → string          (category cascade for product records)
 *  - resolveBadgeSignal()     → BadgeSignal      (trust-tier + evidence label for badges)
 *
 * NOTE: resolveTimeframe, generateBucketSlots, entryBucketKey and evaluateHealthAlerts
 * were removed. All analytics/timeframe logic is now exclusively in db.ts (calculateAnalytics,
 * resolveTimeframe) and disease-engine.js (DISEASE_RULES). Import from there.
 */

import type { ShoppingLedgerRow } from "./nutriscore";

// ─── Category Resolution ─────────────────────────────────────────────────────


/* Resolve the display category for a validated product record. Cascade: NutritionCategory → CanonicalFoodClass → FSACategoryCode → "Uncategorized" For live badge / Category Insights: call on the current product record each time. For ledger rows: call once at cart-add time and freeze the result. */
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

/* The four tiers a badge can express, in descending confidence order. */
export type BadgeTier =
  | "high_confidence"
  | "confirmed"
  | "estimated"
  | "not_rated";

export interface BadgeSignal {
  tier: BadgeTier;
  /* Human-readable provenance label for the flyout, e.g. "Product label" */
  evidenceLabel: string;
  /* Any nutrition fields filled in rather than measured (from EstimatedFields). */
  estimatedFields: string[];
  /* Which consistency checks failed, if any. */
  failedChecks: string[];
}

const EVIDENCE_LABEL: Record<string, string> = {
  direct_label: "Product label",
  retailer_product_page: "Retailer website",
  manufacturer: "Manufacturer data",
  kfct2018_database: "KFCT 2018 reference",
  international_fct_database: "Matched reference",
  derived: "Derived from ingredients",
  category_reference: "Category estimate",
  unknown: "Unknown provenance",
};

/* Resolve the badge signal for a validated product record. This is the *single* function that decides what trust tier to show on the badge. It reads the dataset's own Validation.ConsistencyChecks verdict as authoritative — it never overrules it. Returns a structured BadgeSignal rather than throwing so the badge degrades gracefully even when data is partially missing. */
export function resolveBadgeSignal(record: unknown): BadgeSignal {
  if (!record || typeof record !== "object") {
    return {
      tier: "not_rated",
      evidenceLabel: "No data",
      estimatedFields: [],
      failedChecks: ["record_missing"],
    };
  }

  const r = record as Record<string, unknown>;
  const validation = (r.Validation as Record<string, unknown>) ?? {};
  const checks = (validation.ConsistencyChecks as Record<string, string>) ?? {};
  const prov = (r.NutritionProvenance as Record<string, unknown>) ?? {};
  const reviewState = (validation.ReviewState as string) ?? "UNVERIFIED";

  // Collect failed checks from the dataset's own verdict.
  const failedChecks = Object.entries(checks)
    .filter(([, v]) => v === "failed")
    .map(([k]) => k);

  if (reviewState === "REJECTED") {
    return {
      tier: "not_rated",
      evidenceLabel: "Validation failed",
      estimatedFields: [],
      failedChecks,
    };
  }

  const evidenceLevel = (prov.EvidenceLevel as string) || "unknown";
  const estimatedFields = Array.isArray(prov.EstimatedFields)
    ? (prov.EstimatedFields as string[])
    : [];

  let tier: BadgeTier = "not_rated";
  if (reviewState === "HIGH_CONFIDENCE") tier = "high_confidence";
  else if (reviewState === "VERIFIED") tier = "confirmed";
  else if (reviewState === "ESTIMATED") tier = "estimated";

  const evidenceLabel = EVIDENCE_LABEL[evidenceLevel] ?? "Unknown provenance";

  return {
    tier,
    evidenceLabel,
    estimatedFields,
    failedChecks,
  };
}

// ─── Health Alert Evaluation ─────────────────────────────────────────────────
// evaluateHealthAlerts() has been removed.
// Health alert counts (diabetes, hypertension, cvd, kidney) are now computed
// exclusively inside calculateAnalytics() in db.ts. That is the single authoritative
// source; DiseaseEngine.DISEASE_RULES governs the per-product clinical thresholds.
// Re-introducing a parallel implementation risks the silent threshold discrepancies
// that were identified in the Phase 1 audit.
export interface HealthAlertCounts {
  diabetes: number;
  hypertension: number;
  cvd: number;
  kidney: number;
}
