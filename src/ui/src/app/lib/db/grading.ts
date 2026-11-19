/**
 * db/grading.ts
 *
 * FSA-NPS grade computation, product interpretation, and unified item evaluation.
 * Reference: Blueprint §2.1 (E-01..E-07, X-07, X-12, ADR-8, Invariant T20)
 */
import type { Grade, ReviewState, ScoringStatus } from "../nutriscore";
import { checkNutrientCompleteness } from "../../../../../shared/nutrient-completeness";

// ── Types and Interfaces ─────────────────────────────────────────────────────

/** Result shape returned by computeGradeFromProduct. */
export interface GradeResult {
  grade: Grade | "UNKNOWN";
  status: ScoringStatus;
  /** Raw plausible field values present in the record (non-null, physically possible). */
  plausibleFields: { field: string; value: number; unit: string }[];
  missing?: string[];
  assumptions?: Array<"fibre_zero" | "protein_zero" | "fvl_zero">;
  score?: number;
}

export type EvalStatus =
  | "NOT_ATTEMPTED"
  | "UNRESOLVED"
  | "INSUFFICIENT_DATA"
  | "COMPUTED_PROVISIONAL"
  | "COMPUTED_CONFIRMED";

export interface PolicyTrigger {
  n?: string;
  allergen?: string;
  actual: number | boolean;
  limit: number | boolean;
  cmp: "gt" | "lt" | "eq";
}

export interface PolicyDecision {
  action: "none" | "warn" | "block" | "caution";
  reason_class: "clinical_soft" | "safety_hard" | "allergen_data_unavailable" | null;
  triggers: PolicyTrigger[];
  min_conf_ok: boolean;
  profile_ver?: number | null;
}

export interface NutrientVector {
  productId: string | null;
  energyKj: number | null;
  energyKcal: number | null;
  sugarsG: number | null;
  satFatG: number | null;
  fatG: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fibreG: number | null;
  fvlPct: number | null;
  sodiumMg: number | null;
  saltG: number | null;
  sodiumDerivedFromSalt: boolean;
  sodiumSaltInconsistent: boolean;
  potassiumMg: number | null;
  phosphorusMg: number | null;
  allergens?: string[];
  liquid: boolean;
  servingG: number | null;
  [key: string]: unknown;
}

export interface ItemEvaluation {
  status: EvalStatus;
  grade: Grade | null;
  score: number | null;
  facts: Array<{ key: string; value: number; unit: string }>;
  missing: string[];
  assumptions: Array<"fibre_zero" | "protein_zero" | "fvl_zero">;
  tier: "high_confidence" | "confirmed" | "estimated" | "not_rated";
  decision: PolicyDecision;
  error_code?: string;
  versions: {
    scoring: "v5";
    algorithm: "fsa-nps-2023";
    catalogue: string;
    profile: number | null;
  };
}

// ── Constants & Helpers ──────────────────────────────────────────────────────

// ADR-8: Salt to sodium conversion factor (mg sodium per g salt)
export const SALT_TO_SODIUM_FACTOR_MG_PER_G = 400;

export const PLAUSIBILITY_BOUNDS = Object.freeze({
  energyKj:   { min: 0, max: 4000 },
  energyKcal: { min: 0, max: 956 },
  sugarsG:    { min: 0, max: 100 },
  satFatG:    { min: 0, max: 100 },
  sodiumMg:   { min: 0, max: 40000 },
  fatG:       { min: 0, max: 100 },
  carbsG:     { min: 0, max: 100 },
  proteinG:   { min: 0, max: 100 },
  fibreG:     { min: 0, max: 100 },
  fvlPct:     { min: 0, max: 100 },
});

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

// ── Feature Flag Helpers ─────────────────────────────────────────────────────

export function isScoringV5Enabled(): boolean {
  if (typeof self !== "undefined" && (self as any).NutriFlags && typeof (self as any).NutriFlags.isEnabled === "function") {
    return (self as any).NutriFlags.isEnabled("ns.scoring.v5");
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).NutriFlags && typeof (globalThis as any).NutriFlags.isEnabled === "function") {
    return (globalThis as any).NutriFlags.isEnabled("ns.scoring.v5");
  }
  return false;
}

export function isPolicyV2Enabled(): boolean {
  if (typeof self !== "undefined" && (self as any).NutriFlags && typeof (self as any).NutriFlags.isEnabled === "function") {
    return (self as any).NutriFlags.isEnabled("ns.policy.v2");
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).NutriFlags && typeof (globalThis as any).NutriFlags.isEnabled === "function") {
    return (globalThis as any).NutriFlags.isEnabled("ns.policy.v2");
  }
  return false;
}

// ── In-Memory LRU Cache (512 entries per Blueprint §2.1) ─────────────────────

const CACHE_CAPACITY = 512;
const evaluationLruCache = new Map<string, ItemEvaluation>();

export function clearEvaluationCache(): void {
  evaluationLruCache.clear();
}

function getFromCache(key: string): ItemEvaluation | undefined {
  if (!evaluationLruCache.has(key)) return undefined;
  const val = evaluationLruCache.get(key)!;
  evaluationLruCache.delete(key);
  evaluationLruCache.set(key, val);
  return val;
}

function putInCache(key: string, val: ItemEvaluation): void {
  if (evaluationLruCache.has(key)) {
    evaluationLruCache.delete(key);
  } else if (evaluationLruCache.size >= CACHE_CAPACITY) {
    const oldestKey = evaluationLruCache.keys().next().value;
    if (oldestKey !== undefined) evaluationLruCache.delete(oldestKey);
  }
  evaluationLruCache.set(key, val);
}

// ── Category Scoring Strategies ──────────────────────────────────────────────

type ScoringCtx = {
  nEnergy: number; nSugars: number; nSatFat: number; nSodium: number;
  pFibre: number; pProtein: number; pFVL: number;
  nPoints: number;
  computeFinalScore: () => number;
  computeLetter: (score: number) => Grade;
};

const CATEGORY_ADJUSTMENTS: Record<string, (n: any, ctx: ScoringCtx, p?: any) => Partial<ScoringCtx>> = {
  BEVERAGE: (n, ctx, p) => {
    const isWater =
      p?.Classification?.NutritionCategory === "Water" ||
      p?.Classification?.FSACategoryCode === "WATER" ||
      String(p?.Identity?.ProductName || "").toLowerCase().includes("water") ||
      String(p?.name || "").toLowerCase().includes("water");
    const energyKj = n.EnergyKJ ?? (n.EnergyKcal != null ? n.EnergyKcal * 4.184 : 0);
    const sugars = n.SugarsG ?? n.sugars_g ?? 0;
    return {
      nEnergy: energyKj <= 0 ? 0 : Math.min(Math.floor(energyKj / 30) + 1, 10),
      nSugars: sugars <= 0 ? 0 : Math.min(Math.floor(sugars / 1.5) + 1, 15),
      computeLetter: (score: number): Grade => {
        if (isWater) return "A";
        if (score <= 1) return "B";
        if (score <= 5) return "C";
        if (score <= 9) return "D";
        return "E";
      },
    };
  },
  ADDED_FAT: (n, ctx) => {
    const scoreSatFat = n.SaturatedFatG ?? n.satfat_g ?? 0;
    const totalFat = (n.FatG ?? n.fat_g ?? 0) || (scoreSatFat * 1.5);
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

// ── Canonicalisation & Gate ──────────────────────────────────────────────────

function parseNumber(val: any): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "object" && val !== null) {
    if ("ValueMG" in val) return parseNumber(val.ValueMG);
    if ("ValueG" in val) return parseNumber(val.ValueG);
    if ("ValueKcal" in val) return parseNumber(val.ValueKcal);
    if ("value" in val) return parseNumber(val.value);
  }
  const n = Number(val);
  if (isNaN(n) || !isFinite(n) || n < 0) return null;
  return n;
}

export function canonicalise(record: any): NutrientVector {
  if (!record) {
    return {
      productId: null, energyKj: null, energyKcal: null, sugarsG: null,
      satFatG: null, fatG: null, carbsG: null, proteinG: null, fibreG: null,
      fvlPct: null, sodiumMg: null, saltG: null, sodiumDerivedFromSalt: false,
      sodiumSaltInconsistent: false, potassiumMg: null, phosphorusMg: null,
      liquid: false, servingG: null,
    };
  }

  const n = record.Nutrition || record.per_100g || record.NutritionInformation || {};
  const pkg = record.Packaging || {};
  const identity = record.Identity || {};
  const safety = record.Safety || {};

  let energyKj = parseNumber(n.EnergyKJ ?? n.energy_kj ?? n.energyKj);
  let energyKcal = parseNumber(n.EnergyKcal ?? n.energy_kcal ?? n.energyKcal);
  if (energyKj === null && energyKcal !== null) {
    energyKj = energyKcal * 4.184;
  } else if (energyKcal === null && energyKj !== null) {
    energyKcal = energyKj / 4.184;
  }

  const sugarsG = parseNumber(n.SugarsG ?? n.sugars_g ?? n.sugarsG ?? n.Sugars);
  const satFatG = parseNumber(n.SaturatedFatG ?? n.satfat_g ?? n.satFatG ?? n.SaturatedFat);
  const fatG = parseNumber(n.FatG ?? n.fat_g ?? n.fatG ?? n.TotalFat);
  const carbsG = parseNumber(n.CarbohydratesG ?? n.carbs_g ?? n.carbsG ?? n.Carbohydrates);
  const proteinG = parseNumber(n.ProteinG ?? n.protein_g ?? n.proteinG ?? n.Protein);
  const fibreG = parseNumber(n.FibreG ?? n.fibre_g ?? n.fibreG ?? n.Fibre);
  const fvlPct = parseNumber(n.FVL?.Percentage ?? n.fvl_pct ?? n.fvlPct);

  const rawSodium = n.SodiumMG ?? n.sodium_mg ?? n.sodiumMg ?? n.Sodium?.ValueMG ?? n.Sodium;
  const rawSalt = n.SaltG ?? n.salt_g ?? n.saltG ?? n.Salt;
  const sMg = parseNumber(rawSodium);
  const saltG = parseNumber(rawSalt);

  let sodiumMg: number | null = null;
  let resolvedSaltG: number | null = null;
  let sodiumDerivedFromSalt = false;
  let sodiumSaltInconsistent = false;

  if (sMg !== null && saltG !== null) {
    sodiumMg = sMg;
    resolvedSaltG = saltG;
    const derivedMg = saltG * SALT_TO_SODIUM_FACTOR_MG_PER_G;
    const maxVal = Math.max(sMg, derivedMg);
    sodiumSaltInconsistent = maxVal > 0 && Math.abs(sMg - derivedMg) / maxVal > 0.2;
  } else if (sMg !== null) {
    sodiumMg = sMg;
    resolvedSaltG = sMg / SALT_TO_SODIUM_FACTOR_MG_PER_G;
  } else if (saltG !== null) {
    sodiumMg = saltG * SALT_TO_SODIUM_FACTOR_MG_PER_G;
    resolvedSaltG = saltG;
    sodiumDerivedFromSalt = true;
  }

  const potassiumMg = parseNumber(n.PotassiumMG ?? n.potassium_mg ?? n.potassiumMg);
  const phosphorusMg = parseNumber(n.PhosphorusMG ?? n.phosphorus_mg ?? n.phosphorusMg);

  const unit = String(pkg.PackSizeUnit || record.packSizeUnit || record.sizeUnit || "").trim().toLowerCase();
  const liquid = unit === "ml" || unit === "l" || unit === "cl";
  const servingG = parseNumber(pkg.ServingSizeG || record.ServingSizeG || record.servingSizeG);

  let allergens: string[] | undefined = undefined;
  if (Array.isArray(safety.Allergens)) {
    allergens = [...safety.Allergens];
  } else if (Array.isArray(record.Allergens)) {
    allergens = [...record.Allergens];
  }

  return {
    productId: identity.ProductID || record.productId || record.GroceryProductID || null,
    energyKj,
    energyKcal,
    sugarsG,
    satFatG,
    fatG,
    carbsG,
    proteinG,
    fibreG,
    fvlPct,
    sodiumMg,
    saltG: resolvedSaltG,
    sodiumDerivedFromSalt,
    sodiumSaltInconsistent,
    potassiumMg,
    phosphorusMg,
    allergens,
    liquid,
    servingG,
  };
}

export function gateNutrients(record: any, vec: NutrientVector): {
  g1: boolean;
  g2: boolean;
  missing: string[];
  plausibleFields: Array<{ key: string; value: number; unit: string }>;
} {
  const missing: string[] = [];
  if (vec.energyKj === null && vec.energyKcal === null) missing.push("energy");
  if (vec.sugarsG === null) missing.push("sugars");
  if (vec.satFatG === null) missing.push("saturated_fat");
  if (vec.sodiumMg === null && vec.saltG === null) missing.push("sodium_or_salt");

  const plausibleFields: Array<{ key: string; value: number; unit: string }> = [];
  const checkField = (key: string, val: number | null, unit: string, bounds: { min: number; max: number }) => {
    if (val !== null && val >= bounds.min && val <= bounds.max) {
      plausibleFields.push({ key, value: val, unit });
    }
  };

  checkField("energyKj", vec.energyKj, "kJ", PLAUSIBILITY_BOUNDS.energyKj);
  checkField("sugarsG", vec.sugarsG, "g", PLAUSIBILITY_BOUNDS.sugarsG);
  checkField("satFatG", vec.satFatG, "g", PLAUSIBILITY_BOUNDS.satFatG);
  checkField("sodiumMg", vec.sodiumMg, "mg", PLAUSIBILITY_BOUNDS.sodiumMg);
  checkField("fatG", vec.fatG, "g", PLAUSIBILITY_BOUNDS.fatG);
  checkField("carbsG", vec.carbsG, "g", PLAUSIBILITY_BOUNDS.carbsG);
  checkField("proteinG", vec.proteinG, "g", PLAUSIBILITY_BOUNDS.proteinG);
  checkField("fibreG", vec.fibreG, "g", PLAUSIBILITY_BOUNDS.fibreG);

  const g1 = plausibleFields.length > 0;
  const g2 = missing.length === 0;

  return { g1, g2, missing, plausibleFields };
}

// ── Policy Evaluator ─────────────────────────────────────────────────────────

const NONE_POLICY_DECISION: PolicyDecision = Object.freeze({
  action: "none" as const,
  reason_class: null,
  triggers: Object.freeze([]) as unknown as PolicyTrigger[],
  min_conf_ok: true,
});

const POLICY_NUTRIENT_MAP: Record<string, keyof NutrientVector> = {
  sugars_g_per_100g_max: "sugarsG",
  sugars_g_100g_max: "sugarsG",
  sugars_g: "sugarsG",
  SugarsG: "sugarsG",

  sodium_mg_per_100g_max: "sodiumMg",
  sodium_mg_100g_max: "sodiumMg",
  sodium_mg: "sodiumMg",
  SodiumMG: "sodiumMg",

  satfat_g_per_100g_max: "satFatG",
  satfat_g_100g_max: "satFatG",
  satfat_g: "satFatG",
  SaturatedFatG: "satFatG",

  energy_kcal_per_100g_max: "energyKcal",
  energy_kcal_100g_max: "energyKcal",
  energy_kcal: "energyKcal",
  EnergyKcal: "energyKcal",

  carbs_g_per_100g_max: "carbsG",
  carbs_g_100g_max: "carbsG",
  carbs_g: "carbsG",
  CarbohydratesG: "carbsG",

  fibre_g_per_100g_min: "fibreG",
  fibre_g_100g_min: "fibreG",
  fibre_g: "fibreG",
  FibreG: "fibreG",

  protein_g_per_100g_min: "proteinG",
  protein_g_100g_min: "proteinG",
  protein_g: "proteinG",
  ProteinG: "proteinG",
};

export function evaluatePolicy(
  vec: NutrientVector,
  gate: { g1: boolean; g2: boolean; missing: string[] },
  tier: string,
  policy: any
): PolicyDecision {
  if (!policy) return { ...NONE_POLICY_DECISION, triggers: [] };

  const triggers: PolicyTrigger[] = [];
  const per100gFlags = policy.per100gFlags || [];

  for (const f of per100gFlags) {
    if (!f || !f.n) continue;
    if (f.basis === "per_day" || String(f.n).includes("per_day")) continue;

    const mappedKey = POLICY_NUTRIENT_MAP[f.n] || f.n;
    const val = vec[mappedKey];
    if (val === null || val === undefined || typeof val !== "number") continue;

    if (f.gt != null && val > f.gt) {
      triggers.push({ n: f.n, actual: val, limit: f.gt, cmp: "gt" });
    } else if (f.lt != null && val < f.lt) {
      triggers.push({ n: f.n, actual: val, limit: f.lt, cmp: "lt" });
    }
  }

  const exclude = policy.exclude || [];
  if (exclude.length > 0) {
    if (vec.allergens === undefined) {
      return {
        action: "caution",
        reason_class: "allergen_data_unavailable",
        triggers,
        min_conf_ok: false,
        profile_ver: policy.profileVer ?? null,
      };
    }
    for (const a of exclude) {
      if (Array.isArray(vec.allergens) && vec.allergens.includes(a)) {
        return {
          action: policy.blockMode || "block",
          reason_class: "safety_hard",
          triggers: [{ allergen: a, actual: true, limit: false, cmp: "eq" }, ...triggers],
          min_conf_ok: true,
          profile_ver: policy.profileVer ?? null,
        };
      }
    }
  }

  const confirmed = tier === "confirmed" || tier === "high_confidence";
  if (!triggers.length || !confirmed || !gate.g2) {
    return {
      action: "none",
      reason_class: null,
      triggers,
      min_conf_ok: confirmed,
      profile_ver: policy.profileVer ?? null,
    };
  }

  return {
    action: policy.blockMode || "warn",
    reason_class: "clinical_soft",
    triggers,
    min_conf_ok: true,
    profile_ver: policy.profileVer ?? null,
  };
}

// ── Unified evaluateItem Entry Point ─────────────────────────────────────────

export function evaluateItem(
  record: any,
  policy: any = null,
  options: { catalogueVersion?: string; scoringVersion?: string; bypassCache?: boolean } = {}
): ItemEvaluation {
  try {
    const catVersion = options.catalogueVersion || "catalog-v1";
    const profileVer = policy ? policy.profileVer ?? 1 : null;
    const productId = record?.Identity?.ProductID || record?.productId || record?.GroceryProductID || null;

    if (productId && !options.bypassCache) {
      const cacheKey = `${productId}:${catVersion}:v5:${profileVer ?? "none"}`;
      const cached = getFromCache(cacheKey);
      if (cached) return cached;
    }

    const versions = {
      scoring: "v5" as const,
      algorithm: "fsa-nps-2023" as const,
      catalogue: catVersion,
      profile: profileVer,
    };

    if (!record || (!record.Nutrition && !record.per_100g && !record.NutritionInformation)) {
      return {
        status: "NOT_ATTEMPTED",
        grade: null,
        score: null,
        facts: [],
        missing: ["energy", "sugars", "saturated_fat", "sodium_or_salt"],
        assumptions: [],
        tier: "not_rated",
        decision: { ...NONE_POLICY_DECISION, triggers: [] },
        versions,
      };
    }

    const vec = canonicalise(record);
    const gate = gateNutrients(record, vec);
    const validation = record.Validation || {};
    const reviewState: ReviewState = validation.ReviewState || record.review_state || "UNVERIFIED";

    const reviewStateToTier: Record<string, "high_confidence" | "confirmed" | "estimated" | "not_rated"> = {
      HIGH_CONFIDENCE: "high_confidence",
      VERIFIED: "confirmed",
      ESTIMATED: "estimated",
      UNVERIFIED: "not_rated",
      REJECTED: "not_rated",
    };
    const tier = reviewStateToTier[reviewState] ?? "not_rated";

    if (!gate.g2 || tier === "not_rated") {
      const evalResult: ItemEvaluation = {
        status: "INSUFFICIENT_DATA",
        grade: null,
        score: null,
        facts: gate.plausibleFields,
        missing: gate.missing,
        assumptions: [],
        tier,
        decision: { ...NONE_POLICY_DECISION, triggers: [] },
        versions,
      };
      if (productId && !options.bypassCache) {
        putInCache(`${productId}:${catVersion}:v5:${profileVer ?? "none"}`, evalResult);
      }
      return evalResult;
    }

    // Grade computation via computeGradeFromProduct with v5 forced
    const gradeRes = computeGradeFromProduct(record, { scoringVersion: "v5" });
    const status: EvalStatus = tier === "estimated" ? "COMPUTED_PROVISIONAL" : "COMPUTED_CONFIRMED";
    const decision = policy ? evaluatePolicy(vec, gate, tier, policy) : { ...NONE_POLICY_DECISION, triggers: [] };

    const evalResult: ItemEvaluation = {
      status,
      grade: gradeRes.grade === "UNKNOWN" ? null : (gradeRes.grade as Grade),
      score: gradeRes.score ?? null,
      facts: gate.plausibleFields,
      missing: [],
      assumptions: gradeRes.assumptions || [],
      tier,
      decision,
      versions,
    };

    if (productId && !options.bypassCache) {
      putInCache(`${productId}:${catVersion}:v5:${profileVer ?? "none"}`, evalResult);
    }
    return evalResult;
  } catch (err: any) {
    try {
      if (typeof self !== "undefined" && (self as any).NutriObs?.count) {
        (self as any).NutriObs.count("eval_error", 1);
      } else if (typeof globalThis !== "undefined" && (globalThis as any).NutriObs?.count) {
        (globalThis as any).NutriObs.count("eval_error", 1);
      }
    } catch (_ignored) {
      console.debug('[Grading] Telemetry counter error:', _ignored);
    }

    return {
      status: "NOT_ATTEMPTED",
      grade: null,
      score: null,
      facts: [],
      missing: [],
      assumptions: [],
      tier: "not_rated",
      decision: { action: "none", reason_class: null, triggers: [], min_conf_ok: false },
      error_code: err && err.message ? String(err.message) : "UNKNOWN_ERROR",
      versions: {
        scoring: "v5",
        algorithm: "fsa-nps-2023",
        catalogue: options.catalogueVersion || "catalog-v1",
        profile: null,
      },
    };
  }
}

// ── computeGradeFromProduct ──────────────────────────────────────────────────

export function computeGradeFromProduct(
  p: any,
  options: { scoringVersion?: string } = {}
): GradeResult {
  const plausibleFields: GradeResult["plausibleFields"] = [];

  if (!p || (!p.Nutrition && !p.per_100g && !p.NutritionInformation)) {
    return { grade: "UNKNOWN", status: "not_attempted", plausibleFields };
  }

  const n = p.Nutrition || p.per_100g || p.NutritionInformation;
  const fsaCat: string =
    p.Classification?.FSACategoryCode ||
    NUTRITION_CATEGORY_TO_FSA[p.Classification?.NutritionCategory] ||
    "GENERAL_FOOD";

  const energy   = n.EnergyKJ ?? (n.EnergyKcal != null ? n.EnergyKcal * 4.184 : null);
  const sugars   = n.SugarsG       ?? n.sugars_g ?? null;
  const satFat   = n.SaturatedFatG ?? n.satfat_g ?? null;
  const sodium   = n.SodiumMG      ?? n.sodium_mg
                                   ?? (n.SaltG != null ? (n.SaltG * SALT_TO_SODIUM_FACTOR_MG_PER_G) : null)
                                   ?? (n.salt_g != null ? (n.salt_g * SALT_TO_SODIUM_FACTOR_MG_PER_G) : null)
                                   ?? n.Sodium?.ValueMG ?? null;
  const fibre    = n.FibreG        ?? n.fibre_g ?? null;
  const protein  = n.ProteinG      ?? n.protein_g ?? null;
  const fvlPct   = n.FVL?.Percentage ?? n.fvl_pct ?? null;

  const addField = (field: string, val: number | null, unit: string, lo: number, hi: number) => {
    if (val != null && val >= lo && val <= hi) plausibleFields.push({ field, value: val, unit });
  };
  addField("Energy",        energy,  "kJ",  0, 4000);
  addField("Sugars",        sugars,  "g",   0, 100);
  addField("Saturated Fat", satFat,  "g",   0, 100);
  addField("Sodium",        sodium,  "mg",  0, 40_000);
  addField("Fibre",         fibre,   "g",   0, 100);
  addField("Protein",       protein, "g",   0, 100);

  const useV5 = options.scoringVersion === "v5" || isScoringV5Enabled();

  if (useV5) {
    const miss: string[] = [];
    if (energy == null) miss.push("energy");
    if (sugars == null) miss.push("sugars");
    if (satFat == null) miss.push("saturated_fat");
    if (sodium == null) miss.push("sodium_or_salt");

    if (miss.length > 0) {
      return { grade: "UNKNOWN", status: "insufficient_data", plausibleFields, missing: miss };
    }

    const assumptions = [
      fibre == null && "fibre_zero",
      protein == null && "protein_zero",
      fvlPct == null && "fvl_zero",
    ].filter(Boolean) as Array<"fibre_zero" | "protein_zero" | "fvl_zero">;

    // v5: negative nutrients are guaranteed non-null, positive components default to 0 points safely
    const ctx: ScoringCtx = {
      nEnergy: Math.min(Math.floor(energy / 335), 10),
      nSugars: Math.min(Math.floor((sugars as number) / 3.4), 15),
      nSatFat: Math.min(Math.floor((satFat as number) / 1), 10),
      nSodium: Math.min(Math.floor((sodium as number) / 80), 20),
      pFibre:  fibre == null ? 0 : Math.min(Math.floor(fibre / 0.9), 5),
      pProtein:protein == null ? 0 : Math.min(Math.floor(protein / 2.4), 7),
      pFVL: (fvlPct == null || fvlPct <= 40 ? 0 : fvlPct > 80 ? 5 : fvlPct > 60 ? 2 : 1),
      get nPoints() { return this.nEnergy + this.nSugars + this.nSatFat + this.nSodium; },
      computeFinalScore() {
        if (fsaCat === "CHEESE") return this.nPoints - this.pFibre - this.pProtein - this.pFVL;
        if (this.nPoints >= 11 && this.pFVL < 5) return this.nPoints - this.pFibre - this.pFVL;
        return this.nPoints - this.pFibre - this.pProtein - this.pFVL;
      },
      computeLetter: GENERAL_LETTER,
    };

    const adjust = CATEGORY_ADJUSTMENTS[fsaCat];
    if (adjust) {
      Object.assign(ctx, adjust(n, ctx, p));
    }

    const finalScore = ctx.computeFinalScore();
    const letter = ctx.computeLetter(finalScore);

    return { grade: letter, status: "computed", plausibleFields, missing: [], assumptions, score: finalScore };
  }

  // LEGACY(ns-p4): Gate 2 energy-only fallback removed in Phase 4
  if (energy == null) {
    return { grade: "UNKNOWN", status: "insufficient_data", plausibleFields };
  }

  const safePos = (v: number | null) => (v == null ? 0 : v);

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
      if (fsaCat === "CHEESE") return this.nPoints - this.pFibre - this.pProtein - this.pFVL;
      if (this.nPoints >= 11 && this.pFVL < 5) return this.nPoints - this.pFibre - this.pFVL;
      return this.nPoints - this.pFibre - this.pProtein - this.pFVL;
    },
    computeLetter: GENERAL_LETTER,
  };

  const adjust = CATEGORY_ADJUSTMENTS[fsaCat];
  if (adjust) {
    Object.assign(ctx, adjust(n, ctx, p));
  }

  const finalScore = ctx.computeFinalScore();
  const letter = ctx.computeLetter(finalScore);

  return { grade: letter, status: "computed", plausibleFields };
}

// ── interpretProduct ─────────────────────────────────────────────────────────

function validateReviewState(rawReviewState: string, dataQualityFlags: string[]): ReviewState {
  if (rawReviewState && !VALID_REVIEW_STATES.has(rawReviewState as ReviewState)) {
    console.error(`[NutriScoreDB] §8 anomaly: unrecognised ReviewState "${rawReviewState}"`);
    dataQualityFlags.push("unrecognised_review_state");
    return "UNVERIFIED";
  }
  return VALID_REVIEW_STATES.has(rawReviewState as ReviewState)
    ? (rawReviewState as ReviewState)
    : "UNVERIFIED";
}

function resolveProvenance(prov: any): { evidenceLevel: string; valueSpecificity: string } {
  return {
    evidenceLevel: prov.EvidenceLevel || "unknown",
    valueSpecificity: prov.ValueSpecificity || "unknown",
  };
}

function resolveFsaCategory(classification: any): string | null {
  return (
    classification.FSACategoryCode ||
    NUTRITION_CATEGORY_TO_FSA[classification.NutritionCategory] ||
    null
  );
}

function resolveNovaInfo(classification: any): { novaLevel: number | null; novaConfidence: string | null } {
  return {
    novaLevel: classification.NOVA?.Level ?? null,
    novaConfidence: classification.NOVA?.Confidence ?? null,
  };
}

export function interpretProduct(
  record: any,
  options: { scoringVersion?: string } = {}
): any {
  if (!record) return { canDisplayGrade: false, scoringStatus: "not_attempted" };

  const validation = record.Validation || {};
  const prov = record.NutritionProvenance || {};
  const classification = record.Classification || {};

  const dataQualityFlags: string[] = [...(validation.DataQualityFlags || [])];

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

  const n = record.Nutrition || record.per_100g || record.NutritionInformation || {};
  const useV5 = options.scoringVersion === "v5" || isScoringV5Enabled();

  let gate2Passed: boolean;
  if (useV5) {
    const completeness = checkNutrientCompleteness({
      energyKj: n.EnergyKJ ?? n.energy_kj ?? null,
      energyKcal: n.EnergyKcal ?? n.energy_kcal ?? null,
      sugarsG: n.SugarsG ?? n.sugars_g ?? null,
      satFatG: n.SaturatedFatG ?? n.satfat_g ?? null,
      sodiumMg: n.SodiumMG ?? n.sodium_mg ?? (n.Sodium?.ValueMG ?? null),
      saltG: n.SaltG ?? n.salt_g ?? null,
    });
    gate2Passed = completeness.computability === "COMPUTABLE";
  } else {
    // LEGACY(ns-p4): Gate 2 energy-only fallback removed in Phase 4
    gate2Passed = n.EnergyKJ != null || n.EnergyKcal != null || n.energy_kj != null || n.energy_kcal != null;
  }

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
    scoringStatus: gate2Passed ? "computed" : ("insufficient_data" as ScoringStatus),
  };
}
