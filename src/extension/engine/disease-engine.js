/**
 * DiseaseEngine (NUT-04)
 * Evaluates a product's per-100g nutrition against condition-specific clinical
 * benchmarks (DR-001, DR-002, DR-005/006) and produces:
 *   - diseaseAssessment: composite weighted severity per active condition
 *     (score/level/dataConfidence) — internal/analytical, drives badge severity.
 *   - warnings: one shopper-facing alert per individual nutrient that crossed
 *     its own per-100g threshold — the { disease, condition, triggerQuantity }
 *     shape, generated from live data instead of hardcoded thresholds.
 *
 * Orthogonal to FSA-NPS. Cardiovascular disease has been removed from this
 * model. Kidney disease is tracked internally as "renal" (DR-005/006) but
 * displayed to shoppers as "Kidney" since that's the term they recognize.
 */

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

// Internal keys stay stable/clinical; display names can diverge for readability.
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

// Array of tuples instead of "condA_condB" string keys — avoids relying on
// split("_"), which would silently break if a condition name ever contains one.
const INTERACTIONS = [
  { conditions: ["diabetes", "obesity"], sharedDrivers: ["SugarsG", "EnergyKcal"], coefficient: 0.20 },
  { conditions: ["hypertension", "renal"], sharedDrivers: ["SodiumMG"], coefficient: 0.25 },
  { conditions: ["hypertension", "obesity"], sharedDrivers: ["SaturatedFatG"], coefficient: 0.10 }
];

const DiseaseEngine = {
  // Disclaimer required by AI-003
  DISCLAIMER: "This information assesses dietary composition against standard benchmarks. It is not a prediction of disease probability or medical advice.",

  clamp(val, min = 0, max = 100) {
    return Math.min(Math.max(val, min), max);
  },

  getSeverityLevel(score) {
    if (score >= 80) return "very_high";
    if (score >= 60) return "high";
    if (score >= 40) return "moderate";
    if (score >= 20) return "low";
    return "minimal";
  },

  // Missing !== zero. Negative values are physically impossible for a nutrient
  // (a residual data-cleaning error) and are treated as missing rather than
  // silently pulling the weighted burden down.
  parseNutrient(value) {
    if (value === null || value === undefined || isNaN(value) || value < 0) {
      return { value: null, status: "missing" };
    }
    return { value: Number(value), status: "present" };
  },

  calculateExposures(nutrition, rules) {
    const exposures = {};

    for (const [nutrient, benchmark] of Object.entries(rules.thresholds)) {
      const parsed = this.parseNutrient(nutrition[nutrient]);
      exposures[nutrient] = parsed.status === "present"
        ? { ratio: parsed.value / benchmark, actual: parsed.value, status: "present" }
        : { ratio: null, actual: null, status: "missing" };
    }

    for (const [nutrient, benchmark] of Object.entries(rules.protective || {})) {
      const parsed = this.parseNutrient(nutrition[nutrient]);
      exposures[nutrient] = parsed.status === "present"
        ? { ratio: parsed.value / benchmark, actual: parsed.value, status: "present" }
        : { ratio: null, actual: null, status: "missing" };
    }

    return exposures;
  },

  evaluateCondition(condition, nutrition) {
    const rules = DISEASE_RULES[condition];
    const exposures = this.calculateExposures(nutrition, rules);

    // The true dominant driver for THIS rule, computed up front — fixes the
    // earlier bug where "highestWeightMissing" was compared against a running
    // counter seeded at 0, so any missing driver (regardless of its actual
    // weight) always won and "degraded" confidence was unreachable.
    const harmfulWeights = Object.values(rules.weights.harmful);
    const trueMaxWeight = harmfulWeights.length ? Math.max(...harmfulWeights) : 0;

    let rawBurden = 0;
    let highestWeightMissing = false;
    const missingDrivers = [];
    const triggeredFactors = []; // individual per-nutrient breaches -> user-facing alerts

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
        // Benefit strictly capped at 1.0 (100% of benchmark)
        const boundedProtection = Math.min(exp.ratio, 1);
        rawBurden -= boundedProtection * weight;
      }
    }

    // 1.0 raw burden = 60 score (high severity boundary). Floor is 0.
    const finalScore = this.clamp(Math.round(rawBurden * 60));

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
      // Defensive: only proceed if both sides were actually evaluated.
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

  // One shopper-facing alert per nutrient that exceeded its own per-100g
  // threshold for this condition — independent of the composite score, so a
  // single dominant nutrient still surfaces even if other nutrients pull the
  // weighted average down into "moderate".
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

  evaluate(product, patientProfile) {
    if (!product || !product.Nutrition) {
      throw new Error("Invalid schema: missing Nutrition object.");
    }

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

    // Computed once per condition (previously duplicated: once for the public
    // payload, once again just to recover `exposures` for interaction math).
    const rawAssessments = {};
    const diseaseAssessment = {};
    const warnings = [];

    for (const condition of activeConditions) {
      if (!DISEASE_RULES[condition]) continue;

      const assessment = this.evaluateCondition(condition, product.Nutrition);
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DiseaseEngine };
}
