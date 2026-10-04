// engine/scorers/protein-tradeoff.js
// Extracted for SMELL-001

const ScorerProteinTradeoff = {
  score(normalized) {
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
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { ScorerProteinTradeoff };
if (typeof globalThis !== "undefined") globalThis.ScorerProteinTradeoff = ScorerProteinTradeoff;
if (typeof self !== "undefined") self.ScorerProteinTradeoff = ScorerProteinTradeoff;
