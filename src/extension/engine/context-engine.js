// Fix #3: fail-fast dependency resolution. If a dependency is missing the
// error clearly names the missing module and the script ordering fix needed,
// instead of silently resolving to null and crashing later inside
// buildHealthFlags() with an opaque "Cannot read properties of null" error.
function _require(name) {
  const ref =
    (typeof globalThis !== "undefined" && globalThis[name]) ||
    (typeof self !== "undefined" && self[name]) ||
    (typeof window !== "undefined" && window[name]) ||
    null;
  if (!ref) throw new Error(
    `[context-engine] Required global "${name}" not found. ` +
    `Check manifest.json content_scripts / importScripts ordering.`
  );
  return ref;
}
const _HealthFlags = _require("HealthFlags");
const _ScorerEnergyDense = _require("ScorerEnergyDense");
const _ScorerFibreForward = _require("ScorerFibreForward");
const _ScorerProteinTradeoff = _require("ScorerProteinTradeoff");
const _ScorerStrictDensity = _require("ScorerStrictDensity");
const _ScorerGeneral = _require("ScorerGeneral");

const TRACKED_NUTRIENTS = [
  "EnergyKcal", "FatG", "PhosphorusMG",
  "SugarsG", "CarbohydratesG", "FibreG",
  "SodiumMG", "SaturatedFatG",
  "PotassiumMG", "ProteinG"
];

const Kernel = {
  clamp(val, min = 0, max = 100) {
    return Math.min(Math.max(val, min), max);
  },

  parseNutrient(value) {
    if (value === null || value === undefined || isNaN(value) || value < 0) {
      return { value: null, status: "missing" };
    }
    return { value: Number(value), status: "present" };
  },

  isLiquid(packSizeUnit) {
    if (!packSizeUnit) return false;
    const u = packSizeUnit.toString().trim().toLowerCase();
    return u === "ml" || u === "l" || u === "cl";
  },

  resolveSodiumMg(parsedSodium, parsedSalt) {
    if (parsedSodium.status === "present") return { value: parsedSodium.value, derived: false };
    if (parsedSalt.status === "present") return { value: parsedSalt.value * 400, derived: true };
    return { value: null, derived: false };
  },

  normalizeProduct(product) {
    const nutrition = product?.Nutrition || {};
    const liquid = this.isLiquid(product?.Packaging?.PackSizeUnit);
    const values = {};
    for (const nutrient of TRACKED_NUTRIENTS) {
      values[nutrient] = this.parseNutrient(nutrition[nutrient]);
    }
    const saltParsed = this.parseNutrient(nutrition.SaltG);
    return {
      liquid,
      sodiumMg: this.resolveSodiumMg(values.SodiumMG, saltParsed),
      values
    };
  }
};

const GROUP = {
  ENERGY_DENSE: "energy_dense",
  FIBRE_FORWARD: "fibre_forward",
  PROTEIN_TRADEOFF: "protein_tradeoff",
  STRICT_DENSITY: "strict_density",
  GENERAL: "general"
};

const CATEGORY_GROUP_MAP = {
  "Fats & Oils": GROUP.ENERGY_DENSE,
  "Nuts & Seeds": GROUP.ENERGY_DENSE,
  "Vegetables": GROUP.FIBRE_FORWARD,
  "Fruit": GROUP.FIBRE_FORWARD,
  "Legumes": GROUP.FIBRE_FORWARD,
  "Starchy Roots": GROUP.FIBRE_FORWARD,
  "Cereals & Grains": GROUP.FIBRE_FORWARD,
  "Meat & Eggs": GROUP.PROTEIN_TRADEOFF,
  "Dairy": GROUP.PROTEIN_TRADEOFF,
  "Fish & Seafood": GROUP.PROTEIN_TRADEOFF,
  "Beverages": GROUP.STRICT_DENSITY,
  "Condiments & Spices": GROUP.STRICT_DENSITY,
  "Confectionery": GROUP.STRICT_DENSITY,
  "Mixed Dishes": GROUP.GENERAL
};

const MEDICAL_THRESHOLDS = {
  energyDense: { solidKcal: 275, liquidKcal: 70 },
  highSugar: { solidG: 22.5, liquidG: 11.25 },
  lowFibreG: 3.0,
  highSodiumMg: 600,
  cvd: { satFatG: 5, sodiumLowMg: 400, sodiumHighMg: 600 },
  renalPerServing: { sodiumMg: 200, potassiumMg: 200, phosphorusMg: 150 },
  renalProteinPerMealG: 25
};

const NutritionContextEngine = {
  DISCLAIMER: "This information assesses dietary composition against standard benchmarks. It is not a prediction of disease probability or medical advice.",

  GROUP,
  CATEGORY_GROUP_MAP,
  MEDICAL_THRESHOLDS,

  resolveServingGrams(product) {
    const declared = product?.Packaging?.ServingSizeG;
    if (typeof declared === "number" && !isNaN(declared) && declared > 0) {
      return { grams: declared, basis: "declared", confidence: "high" };
    }
    return { grams: 100, basis: "estimated_per_100_proxy", confidence: "low" };
  },

  getContextGrade(badnessScore) {
    if (badnessScore >= 80) return "E";
    if (badnessScore >= 60) return "D";
    if (badnessScore >= 40) return "C";
    if (badnessScore >= 20) return "B";
    return "A";
  },

  buildHealthFlags(product, normalized) {
    const serving = this.resolveServingGrams(product);
    return _HealthFlags.buildHealthFlags(normalized, serving.grams, serving.basis, serving.confidence, MEDICAL_THRESHOLDS);
  },

  computeContextScore(product, normalized) {
    const category = product.Classification?.NutritionCategory || null;

    let group = category !== null ? CATEGORY_GROUP_MAP[category] : undefined;
    let categoryRecognized = true;
    if (!group) {
      group = GROUP.GENERAL;
      categoryRecognized = false;
    }

    let result;
    switch (group) {
      case GROUP.ENERGY_DENSE: result = _ScorerEnergyDense.score(normalized); break;
      case GROUP.FIBRE_FORWARD: result = _ScorerFibreForward.score(normalized); break;
      case GROUP.PROTEIN_TRADEOFF: result = _ScorerProteinTradeoff.score(normalized); break;
      case GROUP.STRICT_DENSITY: result = _ScorerStrictDensity.score(normalized); break;
      case GROUP.GENERAL:
      default: result = _ScorerGeneral.score(normalized); break;
    }

    const badnessRatio = result.maxNegative > 0 ? result.negativePoints / result.maxNegative : 0;
    const goodnessRatio = result.maxPositive > 0 ? result.positivePoints / result.maxPositive : 0;

    const badnessScore = Kernel.clamp(Math.round(badnessRatio * 100 - goodnessRatio * 50));

    return {
      group,
      categoryRecognized,
      contextAdjustmentApplied: group !== GROUP.GENERAL,
      badnessScore,
      grade: this.getContextGrade(badnessScore),
      breakdown: result.breakdown,
      dataConfidence: result.dataConfidence
    };
  },

  evaluate(product, normalized) {
    if (!product || !product.Nutrition) {
      throw new Error("Invalid schema: missing Nutrition object.");
    }

    const resolved = normalized || Kernel.normalizeProduct(product);
    const productId = product.Identity?.ProductID || null;
    const category = product.Classification?.NutritionCategory || null;

    const context = this.computeContextScore(product, resolved);
    const { flags, detail } = this.buildHealthFlags(product, resolved);
    const anyFlagComputed = Object.values(flags).some(v => v !== null);

    return {
      productId,
      category,
      HealthFlags: flags,
      HealthFlagsDetail: detail,
      Grading: {
        ContextScore: context.grade,
        contextGroup: context.group,
        contextAdjustmentApplied: context.contextAdjustmentApplied,
        categoryRecognized: context.categoryRecognized,
        badnessScore: context.badnessScore,
        breakdown: context.breakdown,
        dataConfidence: context.dataConfidence
      },
      disclaimer: anyFlagComputed ? this.DISCLAIMER : ""
    };
  }
};

const evaluateProductForUser = (product) => {
  const contextResult = NutritionContextEngine.evaluate(product);
  return {
    productId: contextResult.productId,
    category: contextResult.category,
    contextScore: contextResult.Grading.ContextScore,
    healthFlags: contextResult.HealthFlags,
    diseaseAssessment: {}, 
    warnings: [],
    context: contextResult,
    disease: {},
    disclaimer: contextResult.disclaimer || ""
  };
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NutritionContextEngine, Kernel, evaluateProductForUser, GROUP, CATEGORY_GROUP_MAP, MEDICAL_THRESHOLDS };
}

// Fix #1: single registration — self covers SW (self===globalThis) and content/window contexts.
if (typeof globalThis !== "undefined") {
  globalThis.NutritionContextEngine = NutritionContextEngine;
  globalThis.Kernel = Kernel;
  globalThis.evaluateProductForUser = evaluateProductForUser;
}
if (typeof self !== "undefined") {
  self.NutritionContextEngine = NutritionContextEngine;
  self.Kernel = Kernel;
  self.evaluateProductForUser = evaluateProductForUser;
}
