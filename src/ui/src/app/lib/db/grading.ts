/**
 * db/grading.ts
 *
 * FSA-NPS grade computation and product interpretation.
 * Extracted from db.ts (SMELL-002 refactor).
 */
import type { Grade, ReviewState, ScoringStatus } from "../nutriscore";

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
 * Canonical mapping: 14-tier NutritionCategory vocab → FSA-NPS algorithm variant.
 * Used as a fallback when the dataset record omits FSACategoryCode (all current records).
 * FSA-NPS has four scoring tables: GENERAL_FOOD | BEVERAGE | CHEESE | FAT.
 */
export const NUTRITION_CATEGORY_TO_FSA: Record<string, string> = {
  "Beverages":           "BEVERAGE",
  "Fats & Oils":         "ADDED_FAT",
  "Dairy":               "GENERAL_FOOD",
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

export function resolveDisplayCategory(record: any): string {
  if (!record || !record.Classification) return "Uncategorized";
  const { NutritionCategory, CanonicalFoodClass, FSACategoryCode } = record.Classification;
  if (NutritionCategory && NutritionCategory !== "Uncategorized") return NutritionCategory;
  if (CanonicalFoodClass && CanonicalFoodClass !== "Uncategorized") return CanonicalFoodClass;
  if (FSACategoryCode) return FSACategoryCode;
  return "Uncategorized";
}

/**
 * LOGIC-001: Category-scoring strategy map.
 * Each entry receives the raw scoring components and returns an adjusted version.
 * Adding a new FSA category is now a single object entry rather than a new branch
 * that multiplies paths through the shared tail logic.
 */
type ScoringCtx = {
  nEnergy: number; nSugars: number; nSatFat: number; nSodium: number;
  pFibre: number; pProtein: number; pFVL: number;
  nPoints: number;
  computeFinalScore: () => number;
  computeLetter: (score: number) => Grade;
};

const CATEGORY_ADJUSTMENTS: Record<string, (n: any, ctx: ScoringCtx) => Partial<ScoringCtx>> = {
  BEVERAGE: (n, ctx) => ({
    nEnergy: ctx.nEnergy <= 0 ? 0 : Math.min(Math.floor(ctx.nEnergy / 30) + 1, 10),
    nSugars: (n.SugarsG ?? 0) <= 0 ? 0 : Math.min(Math.floor((n.SugarsG ?? 0) / 1.5) + 1, 15),
    computeLetter: (score: number): Grade => {
      if (score <= 1) return "B";
      if (score <= 5) return "C";
      if (score <= 9) return "D";
      return "E";
    },
  }),
  ADDED_FAT: (n, ctx) => {
    const scoreSatFat = n.SaturatedFatG ?? 0;
    const totalFat = (n.FatG ?? 0) || (scoreSatFat * 1.5);
    const ratio = totalFat > 0 ? (scoreSatFat / totalFat) * 100 : 0;
    return { nSatFat: Math.min(Math.floor(ratio / 10), 10) };
  },
  RED_MEAT: (_n, ctx) => ({ pProtein: Math.min(ctx.pProtein, 2) }),
};

const GENERAL_LETTER = (score: number): Grade => {
  if (score <= -1) return "A";
  if (score <= 2)  return "B";
  if (score <= 10) return "C";
  if (score <= 18) return "D";
  return "E";
};

export function computeGradeFromProduct(p: any): GradeResult {
  const plausibleFields: GradeResult["plausibleFields"] = [];

  if (!p || !p.Nutrition) {
    return { grade: "UNKNOWN", status: "not_attempted", plausibleFields };
  }

  const n = p.Nutrition;
  const fsaCat: string =
    p.Classification?.FSACategoryCode ||
    NUTRITION_CATEGORY_TO_FSA[p.Classification?.NutritionCategory] ||
    "GENERAL_FOOD";

  const energy   = n.EnergyKJ ?? (n.EnergyKcal != null ? n.EnergyKcal * 4.184 : null);
  const sugars   = n.SugarsG       ?? null;
  const satFat   = n.SaturatedFatG ?? null;
  const sodium   = n.SodiumMG      ?? (n.SaltG != null ? n.SaltG / 2.5 * 1000 : null)
                                   ?? n.Sodium?.ValueMG ?? null;
  const fibre    = n.FibreG        ?? null;
  const protein  = n.ProteinG      ?? null;
  const fvlPct   = n.FVL?.Percentage ?? null;

  const addField = (field: string, val: number | null, unit: string, lo: number, hi: number) => {
    if (val != null && val >= lo && val <= hi) plausibleFields.push({ field, value: val, unit });
  };
  addField("Energy",        energy,  "kJ",  0, 4000);
  addField("Sugars",        sugars,  "g",   0, 100);
  addField("Saturated Fat", satFat,  "g",   0, 100);
  addField("Sodium",        sodium,  "mg",  0, 40_000);
  addField("Fibre",         fibre,   "g",   0, 100);
  addField("Protein",       protein, "g",   0, 100);

  if (energy == null) {
    return { grade: "UNKNOWN", status: "insufficient_data", plausibleFields };
  }

  const safePos = (v: number | null) => (v == null ? 0 : v);

  // Base scoring components — may be adjusted by category strategy below.
  const ctx: ScoringCtx = {
    nEnergy: Math.min(Math.floor(energy / 335), 10),
    nSugars: Math.min(Math.floor(safePos(sugars) / 3.4), 15),
    nSatFat: Math.min(Math.floor(safePos(satFat) / 1), 10),
    nSodium: Math.min(Math.floor(safePos(sodium) / 80), 20),
    pFibre:  Math.min(Math.floor(safePos(fibre) / 0.9), 5),
    pProtein:Math.min(Math.floor(safePos(protein) / 2.4), 7),
    pFVL: (safePos(fvlPct) > 80 ? 5 : safePos(fvlPct) > 60 ? 2 : safePos(fvlPct) > 40 ? 1 : 0),
    get nPoints() { return this.nEnergy + this.nSugars + this.nSatFat + this.nSodium; },
    computeFinalScore() {
      // CHEESE: protein always counted.
      // Standard: if nPoints >= 11 and pFVL < 5, exclude protein.
      if (fsaCat === "CHEESE") return this.nPoints - this.pFibre - this.pProtein - this.pFVL;
      if (this.nPoints >= 11 && this.pFVL < 5) return this.nPoints - this.pFibre - this.pFVL;
      return this.nPoints - this.pFibre - this.pProtein - this.pFVL;
    },
    computeLetter: GENERAL_LETTER,
  };

  // Apply category-specific adjustment (LOGIC-001 strategy map).
  const adjust = CATEGORY_ADJUSTMENTS[fsaCat];
  if (adjust) {
    Object.assign(ctx, adjust(n, ctx));
  }

  const finalScore = ctx.computeFinalScore();
  const letter = ctx.computeLetter(finalScore);

  return { grade: letter, status: "computed", plausibleFields };
}

/**
 * LOGIC-003: Extracted — validate ReviewState against enum and return normalised value.
 * Adds a queryable dataQualityFlag instead of only logging to the console.
 */
function validateReviewState(
  rawReviewState: string,
  dataQualityFlags: string[]
): ReviewState {
  if (rawReviewState && !VALID_REVIEW_STATES.has(rawReviewState as ReviewState)) {
    console.error(
      `[NutriScoreDB] §8 anomaly: unrecognised ReviewState "${rawReviewState}"`,
    );
    // LOGIC-003: push queryable flag so the anomaly is visible in the dataset, not only in console.
    dataQualityFlags.push('unrecognised_review_state');
    return "UNVERIFIED";
  }
  return (VALID_REVIEW_STATES.has(rawReviewState as ReviewState)
    ? (rawReviewState as ReviewState)
    : "UNVERIFIED");
}

/** LOGIC-003: Extracted — resolve evidence / value-specificity provenance fields. */
function resolveProvenance(prov: any): { evidenceLevel: string; valueSpecificity: string } {
  return {
    evidenceLevel: prov.EvidenceLevel || "unknown",
    valueSpecificity: prov.ValueSpecificity || "unknown",
  };
}

/** LOGIC-003: Extracted — resolve FSA category code from classification. */
function resolveFsaCategory(classification: any): string | null {
  return (
    classification.FSACategoryCode ||
    NUTRITION_CATEGORY_TO_FSA[classification.NutritionCategory] ||
    null
  );
}

/** LOGIC-003: Extracted — resolve NOVA processing level and confidence. */
function resolveNovaInfo(classification: any): { novaLevel: number | null; novaConfidence: string | null } {
  return {
    novaLevel: classification.NOVA?.Level ?? null,
    novaConfidence: classification.NOVA?.Confidence ?? null,
  };
}

export function interpretProduct(record: any): any {
  if (!record) return { canDisplayGrade: false, scoringStatus: "not_attempted" };

  const validation = record.Validation || {};
  const prov = record.NutritionProvenance || {};
  const classification = record.Classification || {};

  const dataQualityFlags: string[] = [...(validation.DataQualityFlags || [])];

  // LOGIC-003 composition — each concern is independently named and testable.
  const reviewState = validateReviewState(validation.ReviewState ?? "", dataQualityFlags);
  const { evidenceLevel, valueSpecificity } = resolveProvenance(prov);
  const nutrientAlgorithmVariant = resolveFsaCategory(classification);
  const { novaLevel, novaConfidence } = resolveNovaInfo(classification);
  const foodCategory = resolveDisplayCategory(record);

  const baseEarlyReturn = {
    canDisplayGrade: false,
    scoringStatus: "not_attempted" as ScoringStatus,
    reviewState,
    foodCategory,
    nutrientAlgorithmVariant,
    novaLevel,
    novaConfidence,
    evidenceLevel,
    valueSpecificity,
    dataQualityFlags,
  };

  if (novaLevel == null && !nutrientAlgorithmVariant) return baseEarlyReturn;
  if (reviewState === "REJECTED" || reviewState === "UNVERIFIED") return baseEarlyReturn;
  if (!nutrientAlgorithmVariant || foodCategory === "Uncategorized") return baseEarlyReturn;

  const n = record.Nutrition || {};
  const gate2Passed = n.EnergyKJ != null || n.EnergyKcal != null;
  const checks = validation.ConsistencyChecks || {};

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
    validationStatus: reviewState,
    evidenceTier,
    evidenceLevel,
    valueSpecificity,
    novaLevel,
    novaConfidence,
    categoryPlausibilityCheck: checks.CategoryPlausibility || "not_checked",
    energyConsistencyCheck: checks.Atwater || "not_checked",
    saltSodiumConsistencyCheck: checks.SaltSodium || "not_checked",
    dataQualityFlags,
    sourceReference: prov.SourceID ? { sourceId: prov.SourceID, sourceName: prov.SourceName } : null,
    canDisplayGrade: gate2Passed,
    scoringStatus: gate2Passed ? "computed" : "insufficient_data" as ScoringStatus,
  };
}
