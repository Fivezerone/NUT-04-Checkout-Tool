// health-flags.js
// Extracted from NutritionContextEngine for SMELL-001

const HealthFlags = {
  isEnergyDensePredicate(energy, liquid, thresholds) {
    if (energy.status !== "present") {
      return { flag: null, detail: { reason: "missing_energy_data" } };
    }
    const threshold = liquid ? thresholds.energyDense.liquidKcal : thresholds.energyDense.solidKcal;
    return {
      flag: energy.value > threshold,
      detail: { basis: liquid ? "per_100ml" : "per_100g", threshold, actual: energy.value }
    };
  },

  isHighSodiumPredicate(sodium, thresholds) {
    if (sodium.value !== null) {
      return {
        flag: sodium.value > thresholds.highSodiumMg,
        detail: { threshold: thresholds.highSodiumMg, actual: sodium.value, derivedFromSalt: sodium.derived }
      };
    }
    return { flag: null, detail: { reason: "missing_sodium_and_salt_data" } };
  },

  isDiabeticFriendlyPredicate(sugar, fibre, liquid, thresholds) {
    if (sugar.status === "present" && fibre.status === "present") {
      const sugarThreshold = liquid ? thresholds.highSugar.liquidG : thresholds.highSugar.solidG;
      const highSugar = sugar.value > sugarThreshold;
      const lowFibre = fibre.value < thresholds.lowFibreG;
      return {
        flag: !(highSugar || lowFibre),
        detail: { highSugar, lowFibre, sugarThreshold, fibreThreshold: thresholds.lowFibreG }
      };
    }
    return { flag: null, detail: { reason: "missing_sugar_or_fibre_data" } };
  },

  isRenalSafePredicate(normalized, servingGrams, servingBasis, servingConfidence, thresholds) {
    const sodium = normalized.sodiumMg;
    const potassium = normalized.values.PotassiumMG;
    const phosphorus = normalized.values.PhosphorusMG;
    const protein = normalized.values.ProteinG;

    if (sodium.value === null && potassium.status !== "present" && phosphorus.status !== "present" && protein.status !== "present") {
      return { flag: null, detail: { reason: "insufficient_data: no renal-relevant nutrients available" } };
    }

    const scale = servingGrams / 100;
    const sodiumPerServing = sodium.value !== null ? sodium.value * scale : null;
    const potassiumPerServing = potassium.status === "present" ? potassium.value * scale : null;
    const phosphorusPerServing = phosphorus.status === "present" ? phosphorus.value * scale : null;
    const proteinPerServing = protein.status === "present" ? protein.value * scale : null;

    const breaches = [];
    if (sodiumPerServing !== null && sodiumPerServing > thresholds.renalPerServing.sodiumMg) breaches.push("sodium");
    if (potassiumPerServing !== null && potassiumPerServing > thresholds.renalPerServing.potassiumMg) breaches.push("potassium");
    if (phosphorusPerServing !== null && phosphorusPerServing > thresholds.renalPerServing.phosphorusMg) breaches.push("phosphorus");
    if (proteinPerServing !== null && proteinPerServing > thresholds.renalProteinPerMealG) breaches.push("protein");

    const missingCriteria = [];
    if (potassium.status !== "present") missingCriteria.push("PotassiumMG");
    if (phosphorus.status !== "present") missingCriteria.push("PhosphorusMG");

    return {
      flag: breaches.length > 0 ? false : (missingCriteria.length > 0 ? null : true),
      detail: {
        servingBasis,
        servingConfidence,
        breaches,
        missingCriteria
      }
    };
  },

  buildHealthFlags(normalized, servingGrams, servingBasis, servingConfidence, thresholds) {
    const energyRes = this.isEnergyDensePredicate(normalized.values.EnergyKcal, normalized.liquid, thresholds);
    const sodiumRes = this.isHighSodiumPredicate(normalized.sodiumMg, thresholds);
    const diabeticRes = this.isDiabeticFriendlyPredicate(normalized.values.SugarsG, normalized.values.FibreG, normalized.liquid, thresholds);
    const renalRes = this.isRenalSafePredicate(normalized, servingGrams, servingBasis, servingConfidence, thresholds);

    return {
      flags: {
        IsEnergyDense: energyRes.flag,
        IsHighSodium: sodiumRes.flag,
        DiabeticFriendly: diabeticRes.flag,
        RenalSafe: renalRes.flag
      },
      detail: {
        IsEnergyDense: energyRes.detail,
        IsHighSodium: sodiumRes.detail,
        DiabeticFriendly: diabeticRes.detail,
        RenalSafe: renalRes.detail
      }
    };
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { HealthFlags };
}

if (typeof globalThis !== "undefined") {
  globalThis.HealthFlags = HealthFlags;
}

if (typeof self !== "undefined") {
  self.HealthFlags = HealthFlags;
}
