/**
 * nutri-score-engine.js
 *
 * Single-file consolidation of what were previously two standalone scripts
 * (disease-engine.js, nutrition-context-engine.js). Architecture: a Shared
 * Kernel of nutrient-parsing/derivation utilities, computed once per product,
 * feeding two still-independent, still-orthogonal engines, composed behind
 * one Facade.
 *
 *   Kernel                — parseNutrient/clamp/isLiquid/sodium-or-salt
 *                            derivation. The only place these exist now.
 *   DiseaseEngine          — patient-profile-aware clinical risk composite.
 *                            Unchanged public contract: evaluate(product, patientProfile).
 *   NutritionContextEngine — category-aware grading + category-blind
 *                            HealthFlags. Unchanged public contract:
 *                            evaluate(product).
 *   NutriScoreEngine        — Facade. evaluate(product, patientProfile) runs
 *                            Kernel.normalizeProduct() ONCE and hands the
 *                            result to both engines, instead of each engine
 *                            re-parsing the same ~10 nutrient fields
 *                            independently. This is the efficiency win:
 *                            product resolution/evaluation at catalog scale
 *                            (thousands of records) no longer pays for the
 *                            same SugarsG/SodiumMG/FibreG parse twice.
 *
 * Both sub-engines remain fully callable on their own, with their original
 * signatures, for isolated unit testing — they accept an optional
 * pre-normalized object as a trailing argument and self-normalize via the
 * Kernel if it's omitted. Nothing outside this file needs to change to keep
 * calling DiseaseEngine.evaluate(product, patientProfile) or
 * NutritionContextEngine.evaluate(product) directly; NutriScoreEngine is the
 * recommended entry point only when you need both results together.
 *
 * BEHAVIOR CHANGE FROM CONSOLIDATION (intentional, tested — not a side
 * effect to discover later): DiseaseEngine's hypertension/renal sodium
 * exposure now goes through the same SodiumMG-or-derived-from-SaltG
 * resolution NutritionContextEngine already had. Previously, a product with
 * only SaltG populated (no SodiumMG) would silently read as "missing sodium"
 * for DiseaseEngine — degrading confidence and potentially under-reporting
 * a real hypertension/renal risk — while NutritionContextEngine correctly
 * resolved it. Centralizing sodium resolution in the Kernel fixes this
 * cross-engine disagreement as a structural consequence of the refactor.
 *
 * API SURFACE CHANGE: DiseaseEngine.parseNutrient/.clamp and
 * NutritionContextEngine.parseNutrient/.clamp/.isLiquid/.resolveSodiumMg no
 * longer exist as methods on those objects — they live on Kernel now. If
 * anything outside this file called them directly (rather than through
 * .evaluate()), update those call sites to Kernel.parseNutrient etc.
 *
 * Everything else — thresholds, weights, scoring bands, category mapping,
 * disclaimer text, known schema gaps (PotassiumMG, PhosphorusMG,
 * ServingSizeG, TransFatG) — is unchanged from the two source files.
 */

// ---------------------------------------------------------------------------
// DiseaseEngine's own constants — unchanged from disease-engine.js
// ---------------------------------------------------------------------------

const NUTRIENT_LABELS = {
  SugarsG: { label: "sugar", unit: "g" },
  CarbohydratesG: { label: "carbohydrates", unit: "g" },
  EnergyKcal: { label: "calories", unit: "kcal" },
  FibreG: { label: "fibre", unit: "g" },
  SodiumMG: { label: "sodium", unit: "mg" },
  SaturatedFatG: { label: "saturated fat", unit: "g" },
  PotassiumMG: { label: "potassium", unit: "mg" },
  ProteinG: { label: "protein", unit: "g" }
};

const CONDITION_DISPLAY_NAMES = {
  diabetes: "Diabetes",
  hypertension: "Hypertension",
  renal: "Kidney",
  obesity: "Obesity"
};

const DISEASE_RULES = {
  diabetes: {
    basis: "per_100g",
    thresholds: { SugarsG: 22.5, CarbohydratesG: 60.0, EnergyKcal: 400.0 }, // DR-001 benchmarks
    protective: { FibreG: 6.0 },
    weights: {
      harmful: { SugarsG: 0.40, CarbohydratesG: 0.30, EnergyKcal: 0.30 },
      protective: { FibreG: 0.20 }
    }
  },
  hypertension: {
    basis: "per_100g",
    thresholds: { SodiumMG: 600.0, SaturatedFatG: 5.0 }, // DR-002 benchmarks
    protective: {},
    weights: {
      harmful: { SodiumMG: 0.75, SaturatedFatG: 0.25 },
      protective: {}
    }
  },
  renal: {
    basis: "per_100g",
    thresholds: { SodiumMG: 600.0, PotassiumMG: 200.0, ProteinG: 15.0 }, // DR-005/006 benchmarks
    protective: {},
    weights: {
      harmful: { SodiumMG: 0.50, PotassiumMG: 0.30, ProteinG: 0.20 },
      protective: {}
    }
  },
  obesity: {
    basis: "per_100g",
    thresholds: { EnergyKcal: 400.0, SugarsG: 22.5, SaturatedFatG: 5.0 },
    protective: {},
    weights: {
      harmful: { EnergyKcal: 0.40, SugarsG: 0.30, SaturatedFatG: 0.30 },
      protective: {}
    }
  }
};

const INTERACTIONS = [
  { conditions: ["diabetes", "obesity"], sharedDrivers: ["SugarsG", "EnergyKcal"], coefficient: 0.20 },
  { conditions: ["hypertension", "renal"], sharedDrivers: ["SodiumMG"], coefficient: 0.25 },
  { conditions: ["hypertension", "obesity"], sharedDrivers: ["SaturatedFatG"], coefficient: 0.10 }
];

// ---------------------------------------------------------------------------
// Shared Kernel
// ---------------------------------------------------------------------------

// Every nutrient either engine's rules touch, derived from DISEASE_RULES so
// adding a new disease rule automatically extends what gets normalized —
// plus the handful NutritionContextEngine needs that DiseaseEngine doesn't
// (EnergyKcal/FatG), plus the schema-gap fields we still want to structurally
// check for even though they're always absent today (PhosphorusMG;
// PotassiumMG is already covered via the renal rule above).
const TRACKED_NUTRIENTS = (() => {
  const set = new Set(["EnergyKcal", "FatG", "PhosphorusMG"]);
  for (const rules of Object.values(DISEASE_RULES)) {
    Object.keys(rules.thresholds).forEach(n => set.add(n));
    Object.keys(rules.protective || {}).forEach(n => set.add(n));
  }
  return Array.from(set);
})();

const Kernel = {
  clamp(val, min = 0, max = 100) {
    return Math.min(Math.max(val, min), max);
  },

  // Missing !== zero. Negative values are physically impossible for a
  // nutrient (a residual data-cleaning error) and are treated as missing
  // rather than silently pulling a weighted score down.
  parseNutrient(value) {
    if (value === null || value === undefined || isNaN(value) || value < 0) {
      return { value: null, status: "missing" };
    }
    return { value: Number(value), status: "present" };
  },

  // Unknown/absent unit defaults to solid (the majority case in the
  // catalog) rather than throwing.
  isLiquid(packSizeUnit) {
    if (!packSizeUnit) return false;
    const u = packSizeUnit.toString().trim().toLowerCase();
    return u === "ml" || u === "l" || u === "cl";
  },

  // SodiumMG direct if present; else derived from SaltG (Sodium mg =
  // Salt g * 1000 / 2.5). Takes already-parsed inputs so callers never
  // parse SodiumMG/SaltG a second time — normalizeProduct() is the only
  // place raw nutrition values get parsed.
  resolveSodiumMg(parsedSodium, parsedSalt) {
    if (parsedSodium.status === "present") return { value: parsedSodium.value, derived: false };
    if (parsedSalt.status === "present") return { value: parsedSalt.value * 400, derived: true };
    return { value: null, derived: false };
  },

  // The single parse-once pass. Every nutrient either engine needs is
  // parsed here exactly once, regardless of how many engines or scoring
  // criteria subsequently read it.
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

// ---------------------------------------------------------------------------
// NutritionContextEngine's own constants — unchanged from
// nutrition-context-engine.js
// ---------------------------------------------------------------------------

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
  renalPerServing: { sodiumMg: 200, potassiumMg: 200, phosphorusMg: 150 },
  renalProteinPerMealG: 25
};

// ---------------------------------------------------------------------------
// DiseaseEngine
// ---------------------------------------------------------------------------

const DiseaseEngine = {
  DISCLAIMER: "This information assesses dietary composition against standard benchmarks. It is not a prediction of disease probability or medical advice.",

  getSeverityLevel(score) {
    if (score >= 80) return "very_high";
    if (score >= 60) return "high";
    if (score >= 40) return "moderate";
    if (score >= 20) return "low";
    return "minimal";
  },

  // Reads normalized.sodiumMg (fallback-resolved) instead of raw SodiumMG
  // for the sodium criterion specifically — this is the cross-engine
  // consistency fix described in the file header. Every other nutrient
  // reads straight from normalized.values.
  calculateExposures(normalized, rules) {
    const exposures = {};

    for (const [nutrient, benchmark] of Object.entries(rules.thresholds)) {
      const parsed = nutrient === "SodiumMG"
        ? (normalized.sodiumMg.value !== null ? { value: normalized.sodiumMg.value, status: "present" } : { value: null, status: "missing" })
        : normalized.values[nutrient];
      exposures[nutrient] = parsed.status === "present"
        ? { ratio: parsed.value / benchmark, actual: parsed.value, status: "present" }
        : { ratio: null, actual: null, status: "missing" };
    }

    for (const [nutrient, benchmark] of Object.entries(rules.protective || {})) {
      const parsed = normalized.values[nutrient];
      exposures[nutrient] = parsed.status === "present"
        ? { ratio: parsed.value / benchmark, actual: parsed.value, status: "present" }
        : { ratio: null, actual: null, status: "missing" };
    }

    return exposures;
  },

  evaluateCondition(condition, normalized) {
    const rules = DISEASE_RULES[condition];
    const exposures = this.calculateExposures(normalized, rules);

    const harmfulWeights = Object.values(rules.weights.harmful);
    const trueMaxWeight = harmfulWeights.length ? Math.max(...harmfulWeights) : 0;

    let rawBurden = 0;
    let highestWeightMissing = false;
    const missingDrivers = [];
    const triggeredFactors = [];

    for (const [nutrient, weight] of Object.entries(rules.weights.harmful)) {
      const exp = exposures[nutrient];
      if (exp && exp.status === "present") {
        rawBurden += exp.ratio * weight;
        if (exp.ratio > 1) {
          triggeredFactors.push({ nutrient, actual: exp.actual, threshold: rules.thresholds[nutrient] });
        }
      } else {
        missingDrivers.push(nutrient);
        if (weight === trueMaxWeight) highestWeightMissing = true;
      }
    }

    for (const [nutrient, weight] of Object.entries(rules.weights.protective)) {
      const exp = exposures[nutrient];
      if (exp && exp.status === "present") {
        const boundedProtection = Math.min(exp.ratio, 1);
        rawBurden -= boundedProtection * weight;
      }
    }

    const finalScore = Kernel.clamp(Math.round(rawBurden * 60));

    let dataConfidence = "high";
    if (highestWeightMissing) {
      dataConfidence = "low";
    } else if (missingDrivers.length > 0) {
      dataConfidence = "degraded";
    }

    return {
      score: finalScore,
      level: this.getSeverityLevel(finalScore),
      dataConfidence,
      missingDrivers,
      triggeredFactors,
      exposures
    };
  },

  calculateInteractionBurden(activeConditions, assessments) {
    const crossBurden = [];

    for (const { conditions: pair, sharedDrivers, coefficient } of INTERACTIONS) {
      const [condA, condB] = pair;
      if (!activeConditions.includes(condA) || !activeConditions.includes(condB)) continue;
      if (!assessments[condA] || !assessments[condB]) continue;

      let sharedExposure = 0;
      sharedDrivers.forEach(driver => {
        const expA = assessments[condA].exposures[driver];
        const expB = assessments[condB].exposures[driver];
        if (expA?.status === "present" && expB?.status === "present") {
          sharedExposure += Math.max(expA.ratio, expB.ratio);
        }
      });

      if (sharedExposure > 0) {
        const interactionMagnitude = sharedExposure * coefficient;
        crossBurden.push({
          overlappingConditions: [condA, condB],
          sharedDrivers,
          burdenLevel: interactionMagnitude > 1.0 ? "high" : (interactionMagnitude > 0.5 ? "moderate" : "low")
        });
      }
    }

    return crossBurden;
  },

  buildWarnings(condition, assessment) {
    const displayName = CONDITION_DISPLAY_NAMES[condition]
      || (condition.charAt(0).toUpperCase() + condition.slice(1));

    return assessment.triggeredFactors.map(factor => {
      const meta = NUTRIENT_LABELS[factor.nutrient] || { label: factor.nutrient, unit: "" };
      return {
        disease: `${displayName} Risk`,
        condition: `High ${meta.label} (>${factor.threshold}${meta.unit} per 100g)`,
        triggerQuantity: `${factor.actual}${meta.unit}`
      };
    });
  },

  // normalized is optional — omit it to self-normalize via the Kernel for
  // standalone/isolated calls; pass it when NutriScoreEngine has already
  // computed it once for both engines.
  evaluate(product, patientProfile, normalized) {
    if (!product || !product.Nutrition) {
      throw new Error("Invalid schema: missing Nutrition object.");
    }

    const resolved = normalized || Kernel.normalizeProduct(product);
    const productId = product.Identity?.ProductID || null;
    const conditionsProfile = patientProfile?.conditions || {};
    const activeConditions = Object.keys(conditionsProfile).filter(c => conditionsProfile[c]?.active);

    if (activeConditions.length === 0) {
      return {
        status: "no_active_conditions",
        productId,
        diseaseAssessment: {},
        interactionBurden: [],
        warnings: [],
        disclaimer: ""
      };
    }

    const unrecognizedConditions = activeConditions.filter(c => !DISEASE_RULES[c]);
    if (unrecognizedConditions.length > 0 && typeof console !== "undefined") {
      console.warn(`DiseaseEngine: unrecognized condition key(s) in patient profile: ${unrecognizedConditions.join(", ")}`);
    }

    const rawAssessments = {};
    const diseaseAssessment = {};
    const warnings = [];

    for (const condition of activeConditions) {
      if (!DISEASE_RULES[condition]) continue;

      const assessment = this.evaluateCondition(condition, resolved);
      rawAssessments[condition] = assessment;

      const { exposures, triggeredFactors, ...clean } = assessment;
      diseaseAssessment[condition] = clean;

      warnings.push(...this.buildWarnings(condition, assessment));
    }

    const interactionBurden = this.calculateInteractionBurden(activeConditions, rawAssessments);

    return {
      productId,
      diseaseAssessment,
      interactionBurden,
      warnings,
      disclaimer: warnings.length > 0 ? this.DISCLAIMER : ""
    };
  }
};

// ---------------------------------------------------------------------------
// NutritionContextEngine
// ---------------------------------------------------------------------------

const NutritionContextEngine = {
  DISCLAIMER: "This information assesses dietary composition against standard benchmarks. It is not a prediction of disease probability or medical advice.",

  GROUP,
  CATEGORY_GROUP_MAP,
  MEDICAL_THRESHOLDS,

  // Not part of Kernel: only NutritionContextEngine's renal HealthFlag
  // needs a serving-size resolution, so it stays local rather than being
  // centralized for a single consumer.
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
    const liquid = normalized.liquid;
    const flags = {};
    const detail = {};

    const energy = normalized.values.EnergyKcal;
    if (energy.status === "present") {
      const threshold = liquid ? MEDICAL_THRESHOLDS.energyDense.liquidKcal : MEDICAL_THRESHOLDS.energyDense.solidKcal;
      flags.IsEnergyDense = energy.value > threshold;
      detail.IsEnergyDense = { basis: liquid ? "per_100ml" : "per_100g", threshold, actual: energy.value };
    } else {
      flags.IsEnergyDense = null;
      detail.IsEnergyDense = { reason: "missing_energy_data" };
    }

    const sodium = normalized.sodiumMg;
    if (sodium.value !== null) {
      flags.IsHighSodium = sodium.value > MEDICAL_THRESHOLDS.highSodiumMg;
      detail.IsHighSodium = { threshold: MEDICAL_THRESHOLDS.highSodiumMg, actual: sodium.value, derivedFromSalt: sodium.derived };
    } else {
      flags.IsHighSodium = null;
      detail.IsHighSodium = { reason: "missing_sodium_and_salt_data" };
    }

    const sugar = normalized.values.SugarsG;
    const fibre = normalized.values.FibreG;
    if (sugar.status === "present" && fibre.status === "present") {
      const sugarThreshold = liquid ? MEDICAL_THRESHOLDS.highSugar.liquidG : MEDICAL_THRESHOLDS.highSugar.solidG;
      const highSugar = sugar.value > sugarThreshold;
      const lowFibre = fibre.value < MEDICAL_THRESHOLDS.lowFibreG;
      flags.DiabeticFriendly = !(highSugar || lowFibre);
      detail.DiabeticFriendly = { highSugar, lowFibre, sugarThreshold, fibreThreshold: MEDICAL_THRESHOLDS.lowFibreG };
    } else {
      flags.DiabeticFriendly = null;
      detail.DiabeticFriendly = { reason: "missing_sugar_or_fibre_data" };
    }

    const serving = this.resolveServingGrams(product);
    const potassium = normalized.values.PotassiumMG;
    const phosphorus = normalized.values.PhosphorusMG;
    const protein = normalized.values.ProteinG;

    if (sodium.value === null && potassium.status !== "present" && phosphorus.status !== "present" && protein.status !== "present") {
      flags.RenalSafe = null;
      detail.RenalSafe = { reason: "insufficient_data: no renal-relevant nutrients available" };
    } else {
      const scale = serving.grams / 100;
      const sodiumPerServing = sodium.value !== null ? sodium.value * scale : null;
      const potassiumPerServing = potassium.status === "present" ? potassium.value * scale : null;
      const phosphorusPerServing = phosphorus.status === "present" ? phosphorus.value * scale : null;
      const proteinPerServing = protein.status === "present" ? protein.value * scale : null;

      const breaches = [];
      if (sodiumPerServing !== null && sodiumPerServing > MEDICAL_THRESHOLDS.renalPerServing.sodiumMg) breaches.push("sodium");
      if (potassiumPerServing !== null && potassiumPerServing > MEDICAL_THRESHOLDS.renalPerServing.potassiumMg) breaches.push("potassium");
      if (phosphorusPerServing !== null && phosphorusPerServing > MEDICAL_THRESHOLDS.renalPerServing.phosphorusMg) breaches.push("phosphorus");
      if (proteinPerServing !== null && proteinPerServing > MEDICAL_THRESHOLDS.renalProteinPerMealG) breaches.push("protein");

      const missingCriteria = [];
      if (potassium.status !== "present") missingCriteria.push("PotassiumMG");
      if (phosphorus.status !== "present") missingCriteria.push("PhosphorusMG");

      flags.RenalSafe = breaches.length > 0 ? false : (missingCriteria.length > 0 ? null : true);
      detail.RenalSafe = {
        servingBasis: serving.basis,
        servingConfidence: serving.confidence,
        breaches,
        missingCriteria
      };
    }

    return { flags, detail };
  },

  scoreEnergyDense(normalized) {
    const breakdown = [];
    let negativePoints = 0;
    const maxNegative = 10;

    const fat = normalized.values.FatG;
    const satFat = normalized.values.SaturatedFatG;
    if (fat.status === "present" && satFat.status === "present" && fat.value > 0) {
      const ratio = satFat.value / fat.value;
      let pts = 0;
      if (ratio > 0.50) pts = 6;
      else if (ratio > 0.30) pts = 3;
      negativePoints += pts;
      breakdown.push({ criterion: "saturated_fat_ratio", ratio: Number(ratio.toFixed(2)), points: pts, maxPoints: 6 });
    } else {
      breakdown.push({ criterion: "saturated_fat_ratio", points: 0, maxPoints: 6, status: "not_evaluated", reason: fat.value === 0 ? "FatG is zero, ratio undefined" : "missing_data" });
    }

    const sodium = normalized.sodiumMg;
    if (sodium.value !== null) {
      let pts = 0;
      if (sodium.value > 600) pts = 4;
      else if (sodium.value > 400) pts = 2;
      negativePoints += pts;
      breakdown.push({ criterion: "sodium", actual: sodium.value, points: pts, maxPoints: 4, derivedFromSalt: sodium.derived });
    } else {
      breakdown.push({ criterion: "sodium", points: 0, maxPoints: 4, status: "not_evaluated", reason: "missing_data" });
    }

    breakdown.push({ criterion: "trans_fat", status: "not_evaluated", reason: "TransFatG not present in current schema" });

    const missing = breakdown.some(b => b.status === "not_evaluated" && b.criterion !== "trans_fat");
    return { negativePoints, maxNegative, positivePoints: 0, maxPositive: 0, breakdown, dataConfidence: missing ? "degraded" : "high" };
  },

  scoreFibreForward(normalized) {
    const breakdown = [];
    let negativePoints = 0, positivePoints = 0;
    const maxNegative = 6, maxPositive = 6;
    const liquid = normalized.liquid;

    const carbs = normalized.values.CarbohydratesG;
    const fibre = normalized.values.FibreG;
    const sugar = normalized.values.SugarsG;

    let fibreCarbRatio = null;
    if (carbs.status === "present" && fibre.status === "present" && carbs.value > 0) {
      fibreCarbRatio = fibre.value / carbs.value;
      let pts = 0;
      if (fibreCarbRatio >= 0.10) pts = 6;
      else if (fibreCarbRatio >= 0.05) pts = 3;
      positivePoints += pts;
      breakdown.push({ criterion: "fibre_to_carb_ratio", ratio: Number(fibreCarbRatio.toFixed(2)), points: pts, maxPoints: 6 });
    } else {
      breakdown.push({ criterion: "fibre_to_carb_ratio", points: 0, maxPoints: 6, status: "not_evaluated", reason: carbs.value === 0 ? "CarbohydratesG is zero" : "missing_data" });
    }

    const sugarThreshold = liquid ? 11.25 : 22.5;
    if (fibreCarbRatio !== null && fibreCarbRatio >= 0.10) {
      breakdown.push({ criterion: "sugar", status: "waived", reason: "fibre_to_carb_ratio >= 10%", points: 0, maxPoints: 6 });
    } else if (sugar.status === "present") {
      let pts = 0;
      if (sugar.value > sugarThreshold) pts = 6;
      else if (sugar.value > sugarThreshold / 2) pts = 3;
      negativePoints += pts;
      breakdown.push({ criterion: "sugar", actual: sugar.value, threshold: sugarThreshold, points: pts, maxPoints: 6 });
    } else {
      breakdown.push({ criterion: "sugar", points: 0, maxPoints: 6, status: "not_evaluated", reason: "missing_data" });
    }

    const missing = breakdown.some(b => b.status === "not_evaluated");
    return { negativePoints, maxNegative, positivePoints, maxPositive, breakdown, dataConfidence: missing ? "degraded" : "high" };
  },

  scoreProteinTradeoff(normalized) {
    const breakdown = [];
    let negativePoints = 0, positivePoints = 0;
    const maxNegative = 8, maxPositive = 5;

    const protein = normalized.values.ProteinG;
    if (protein.status === "present") {
      let pts = 0;
      if (protein.value >= 15) pts = 5;
      else if (protein.value >= 10) pts = 3;
      positivePoints += pts;
      breakdown.push({ criterion: "protein_density", actual: protein.value, points: pts, maxPoints: 5 });
    } else {
      breakdown.push({ criterion: "protein_density", points: 0, maxPoints: 5, status: "not_evaluated", reason: "missing_data" });
    }

    const satFat = normalized.values.SaturatedFatG;
    if (satFat.status === "present") {
      let pts = 0;
      if (satFat.value > 5) pts = 5;
      else if (satFat.value > 2.5) pts = 2;
      negativePoints += pts;
      breakdown.push({ criterion: "saturated_fat", actual: satFat.value, points: pts, maxPoints: 5 });
    } else {
      breakdown.push({ criterion: "saturated_fat", points: 0, maxPoints: 5, status: "not_evaluated", reason: "missing_data" });
    }

    const sodium = normalized.sodiumMg;
    if (sodium.value !== null) {
      let pts = 0;
      if (sodium.value > 600) pts = 3;
      else if (sodium.value > 400) pts = 1;
      negativePoints += pts;
      breakdown.push({ criterion: "sodium", actual: sodium.value, points: pts, maxPoints: 3, derivedFromSalt: sodium.derived });
    } else {
      breakdown.push({ criterion: "sodium", points: 0, maxPoints: 3, status: "not_evaluated", reason: "missing_data" });
    }

    const missing = breakdown.some(b => b.status === "not_evaluated");
    return { negativePoints, maxNegative, positivePoints, maxPositive, breakdown, dataConfidence: missing ? "degraded" : "high" };
  },

  scoreStrictDensity(normalized) {
    const breakdown = [];
    let negativePoints = 0;
    const maxNegative = 10;
    const liquid = normalized.liquid;

    const energy = normalized.values.EnergyKcal;
    if (energy.status === "present") {
      let pts = 0;
      if (liquid) {
        if (energy.value > 50) pts = 6;
        else if (energy.value > 25) pts = 3;
      } else {
        if (energy.value > 275) pts = 6;
        else if (energy.value > 150) pts = 3;
      }
      negativePoints += pts;
      breakdown.push({ criterion: "energy_density", actual: energy.value, basis: liquid ? "per_100ml" : "per_100g", points: pts, maxPoints: 6 });
    } else {
      breakdown.push({ criterion: "energy_density", points: 0, maxPoints: 6, status: "not_evaluated", reason: "missing_data" });
    }

    const sugar = normalized.values.SugarsG;
    const sugarThreshold = liquid ? 11.25 : 22.5;
    if (sugar.status === "present") {
      let pts = 0;
      if (sugar.value > sugarThreshold) pts = 4;
      else if (sugar.value > sugarThreshold / 2) pts = 2;
      negativePoints += pts;
      breakdown.push({ criterion: "sugar", actual: sugar.value, threshold: sugarThreshold, points: pts, maxPoints: 4 });
    } else {
      breakdown.push({ criterion: "sugar", points: 0, maxPoints: 4, status: "not_evaluated", reason: "missing_data" });
    }

    const missing = breakdown.some(b => b.status === "not_evaluated");
    return { negativePoints, maxNegative, positivePoints: 0, maxPositive: 0, breakdown, dataConfidence: missing ? "degraded" : "high" };
  },

  scoreGeneral(normalized) {
    const breakdown = [];
    let negativePoints = 0, positivePoints = 0;
    const maxNegative = 12, maxPositive = 6;
    const liquid = normalized.liquid;

    const push = (criterion, parsed, thresholds, pointsHigh, pointsMid, positive) => {
      if (parsed.status === "present") {
        let pts = 0;
        if (positive) {
          if (parsed.value >= thresholds[0]) pts = pointsHigh;
          else if (parsed.value >= thresholds[1]) pts = pointsMid;
          positivePoints += pts;
        } else {
          if (parsed.value > thresholds[0]) pts = pointsHigh;
          else if (parsed.value > thresholds[1]) pts = pointsMid;
          negativePoints += pts;
        }
        breakdown.push({ criterion, actual: parsed.value, points: pts, maxPoints: pointsHigh });
      } else {
        breakdown.push({ criterion, points: 0, maxPoints: pointsHigh, status: "not_evaluated", reason: "missing_data" });
      }
    };

    const energyThreshold = liquid ? 70 : 275;
    push("energy", normalized.values.EnergyKcal, [energyThreshold, energyThreshold / 2], 3, 1, false);

    const sugarThreshold = liquid ? 11.25 : 22.5;
    push("sugar", normalized.values.SugarsG, [sugarThreshold, sugarThreshold / 2], 3, 1, false);

    push("saturated_fat", normalized.values.SaturatedFatG, [5, 2.5], 3, 1, false);

    const sodium = normalized.sodiumMg;
    const sodiumParsed = sodium.value !== null ? { value: sodium.value, status: "present" } : { value: null, status: "missing" };
    push("sodium", sodiumParsed, [600, 400], 3, 1, false);

    push("fibre", normalized.values.FibreG, [6, 3], 3, 1, true);
    push("protein", normalized.values.ProteinG, [10, 5], 3, 1, true);

    const missing = breakdown.some(b => b.status === "not_evaluated");
    return { negativePoints, maxNegative, positivePoints, maxPositive, breakdown, dataConfidence: missing ? "degraded" : "high" };
  },

  computeContextScore(product, normalized) {
    const category = product.Classification?.NutritionCategory || null;

    let group = category !== null ? CATEGORY_GROUP_MAP[category] : undefined;
    let categoryRecognized = true;
    if (!group) {
      group = GROUP.GENERAL;
      categoryRecognized = false;
      if (typeof console !== "undefined") {
        console.warn(`NutritionContextEngine: unrecognized NutritionCategory "${category}" — falling back to general grading.`);
      }
    }

    let result;
    switch (group) {
      case GROUP.ENERGY_DENSE: result = this.scoreEnergyDense(normalized); break;
      case GROUP.FIBRE_FORWARD: result = this.scoreFibreForward(normalized); break;
      case GROUP.PROTEIN_TRADEOFF: result = this.scoreProteinTradeoff(normalized); break;
      case GROUP.STRICT_DENSITY: result = this.scoreStrictDensity(normalized); break;
      case GROUP.GENERAL:
      default: result = this.scoreGeneral(normalized); break;
    }

    const badnessRatio = result.maxNegative > 0 ? result.negativePoints / result.maxNegative : 0;
    const goodnessRatio = result.maxPositive > 0 ? result.positivePoints / result.maxPositive : 0;

    // Credit capped at half the badness scale — see nutrition-context-engine.js
    // history: an uncapped 1:1 offset let a maxed reward axis fully cancel a
    // maxed violation (e.g. a high-protein, high-sat-fat, high-sodium cheese
    // scoring a perfect "A"). Preserved unchanged in this consolidation.
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

  // normalized is optional — omit it to self-normalize via the Kernel.
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

// ---------------------------------------------------------------------------
// NutriScoreEngine — Facade. The recommended entry point when both engines'
// output is needed: normalizes once, calls both, keeps their outputs
// distinct (never blended into one score — see both engines' own docstrings
// and the integration directive's Section 10).
// ---------------------------------------------------------------------------

const NutriScoreEngine = {
  evaluate(product, patientProfile) {
    if (!product || !product.Nutrition) {
      throw new Error("Invalid schema: missing Nutrition object.");
    }

    const normalized = Kernel.normalizeProduct(product);
    const productId = product.Identity?.ProductID || null;
    const category = product.Classification?.NutritionCategory || null;

    const contextResult = NutritionContextEngine.evaluate(product, normalized);
    const diseaseResult = DiseaseEngine.evaluate(product, patientProfile, normalized);

    // Both engines currently share the exact same AI-003 disclaimer text —
    // take it once rather than duplicating the sentence if both fire.
    const disclaimer = contextResult.disclaimer || diseaseResult.disclaimer || "";

    return {
      productId,
      category,
      // Convenience top-level fields — matches the EVALUATE_PRODUCT
      // response shape already specified in the integration directive.
      contextScore: contextResult.Grading.ContextScore,
      healthFlags: contextResult.HealthFlags,
      diseaseAssessment: diseaseResult.diseaseAssessment,
      warnings: diseaseResult.warnings,
      // Full fidelity for anything needing the richer detail.
      context: contextResult,
      disease: diseaseResult,
      disclaimer
    };
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NutriScoreEngine, DiseaseEngine, NutritionContextEngine, Kernel };
}
