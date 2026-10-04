// engine/scorers/strict-density.js
// Extracted for SMELL-001

const ScorerStrictDensity = {
  score(normalized) {
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
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { ScorerStrictDensity };
if (typeof globalThis !== "undefined") globalThis.ScorerStrictDensity = ScorerStrictDensity;
if (typeof self !== "undefined") self.ScorerStrictDensity = ScorerStrictDensity;
