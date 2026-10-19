// engine/scorers/general.js
// Extracted for SMELL-001

const ScorerGeneral = {
  score(normalized) {
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
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { ScorerGeneral };
if (typeof globalThis !== "undefined") globalThis.ScorerGeneral = ScorerGeneral;
if (typeof self !== "undefined") self.ScorerGeneral = ScorerGeneral;
