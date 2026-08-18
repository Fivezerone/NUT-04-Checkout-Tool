/**
 * ScoreEngine
 * Component Layer: Core Logic
 * Responsibility: Implements FSA-NPS-2023 scoring paths.
 */

const ScoreEngine = {
  score(data, fsaCategoryCode) {
    if (data.is_raw_food) {
      return {
        LetterGrade: "A",
        NumericScore: -15,
        FSACategoryUsed: fsaCategoryCode,
        AlgorithmVersion: "FSA-NPS-2023",
        breakdown: { N_Points: 0, P_Points: 15, msg: "Raw/Fresh Bypass" }
      };
    }

    const { energy, sugars, sat_fat, sodium, fiber, protein, fruits_veg_pct } = data;

    if (energy == null && sugars == null && sat_fat == null && sodium == null) {
      return {
        LetterGrade: "UNKNOWN",
        NumericScore: null,
        FSACategoryUsed: fsaCategoryCode,
        AlgorithmVersion: "FSA-NPS-2023",
        breakdown: null
      };
    }

    const safeNum = (val) => (val == null ? 0 : val);
    const eVal = safeNum(energy);
    const sugVal = safeNum(sugars);
    const satVal = safeNum(sat_fat);
    const sodVal = safeNum(sodium);

    // N-Points (Negative Points)
    // 2023 Base Max: Energy (10), Sugars (15), SatFat (10), Sodium (20)
    let nEnergy = Math.min(Math.floor(eVal / 335), 10);
    // Sugar Ib scale: max 15 points, ~3.4g per point
    let nSugars = Math.min(Math.floor(sugVal / 3.4), 15);
    let nSatFat = Math.min(Math.floor(satVal / 1), 10);
    // Salt: max 20 points, ~80mg sodium (0.2g salt) per point
    let nSodium = Math.min(Math.floor(sodVal / 80), 20);

    // Adjusted for 2023 FSA-NPS BEVERAGE path
    if (fsaCategoryCode === "BEVERAGE") {
      nEnergy = eVal <= 0 ? 0 : Math.min(Math.floor(eVal / 30) + 1, 10);
      nSugars = sugVal <= 0 ? 0 : Math.min(Math.floor(sugVal / 1.5) + 1, 15);
    }

    // Adjusted for 2023 FSA-NPS ADDED_FAT path (Ratio of sat fat to total fat)
    if (fsaCategoryCode === "ADDED_FAT") {
      const totVal = (data.total_fat != null) ? data.total_fat : (satVal * 1.5); // Fallback assumption
      const fatRatio = totVal > 0 ? (satVal / totVal) * 100 : 0;
      nSatFat = Math.min(Math.floor(fatRatio / 10), 10);
    }

    const nPoints = nEnergy + nSugars + nSatFat + nSodium;

    // P-Points (Positive Points)
    // Fibre: max 5
    let pFiber = Math.min(Math.floor(safeNum(fiber) / 0.9), 5);
    // Protein: max 7 points (2023 scale)
    let pProtein = Math.min(Math.floor(safeNum(protein) / 2.4), 7);

    // RED_MEAT penalty (2023 constraint - max protein score is capped to prevent artificially elevating red meat scores)
    if (fsaCategoryCode === "RED_MEAT") {
      pProtein = Math.min(pProtein, 2);
    }

    let pFVL = 0;
    if (fruits_veg_pct > 80) pFVL = 5;
    else if (fruits_veg_pct > 60) pFVL = 2;
    else if (fruits_veg_pct > 40) pFVL = 1;

    let pPoints = pFiber + pProtein + pFVL;

    // Score Combining Rule
    let finalScore;
    if (fsaCategoryCode === "CHEESE") {
      finalScore = nPoints - pPoints; // Cheese always deducts protein
    } else if (nPoints >= 11 && pFVL < 5) {
      finalScore = nPoints - pFiber - pFVL; // Protein ignored if N is high and FVL is low
    } else {
      finalScore = nPoints - pPoints;
    }

    // Grade assignment
    let grade = 'C';
    if (fsaCategoryCode === "BEVERAGE") {
      const isWater = data.name && /pure water|still water|spring water|purified water|mineral water|^water$/i.test(data.name.trim());
      if (isWater) grade = 'A';
      else if (finalScore <= 1) grade = 'B';
      else if (finalScore <= 5) grade = 'C';
      else if (finalScore <= 9) grade = 'D';
      else grade = 'E';
    } else {
      if (finalScore <= -1) grade = 'A';
      else if (finalScore <= 2) grade = 'B';
      else if (finalScore <= 10) grade = 'C';
      else if (finalScore <= 18) grade = 'D';
      else grade = 'E';
    }

    return {
      LetterGrade: grade,
      NumericScore: finalScore,
      FSACategoryUsed: fsaCategoryCode,
      AlgorithmVersion: "FSA-NPS-2023",
      breakdown: { N_Points: nPoints, P_Points: pPoints }
    };
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { ScoreEngine };
