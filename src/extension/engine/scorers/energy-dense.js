// engine/scorers/energy-dense.js
// Extracted for SMELL-001

const ScorerEnergyDense = {
  score(normalized) {
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

    const energy = normalized.values.EnergyKcal;
    if (energy.status === "present") {
      let pts = 0;
      if (energy.value > 800) pts = 4;
      else if (energy.value > 500) pts = 2;
      negativePoints += pts;
      breakdown.push({ criterion: "energy_density", actualKcal: energy.value, points: pts, maxPoints: 4 });
    } else {
      breakdown.push({ criterion: "energy_density", points: 0, maxPoints: 4, status: "not_evaluated", reason: "missing_data" });
    }

    return { score: negativePoints, breakdown };
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { ScorerEnergyDense };
if (typeof globalThis !== "undefined") globalThis.ScorerEnergyDense = ScorerEnergyDense;
if (typeof self !== "undefined") self.ScorerEnergyDense = ScorerEnergyDense;
