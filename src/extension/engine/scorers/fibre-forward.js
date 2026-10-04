// engine/scorers/fibre-forward.js
// Extracted for SMELL-001

const ScorerFibreForward = {
  score(normalized) {
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
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { ScorerFibreForward };
if (typeof globalThis !== "undefined") globalThis.ScorerFibreForward = ScorerFibreForward;
if (typeof self !== "undefined") self.ScorerFibreForward = ScorerFibreForward;
