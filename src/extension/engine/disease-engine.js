/**
 * DiseaseEngine
 * Component Layer: Core Logic
 * Responsibility: Evaluate ingredient quantities against disease constraints (DR-001 to DR-006).
 */

const DiseaseEngine = {
  // Disclaimer required by AI-003 to prevent medical advice framing
  DISCLAIMER: "This information is based on standard thresholds and is not medical advice. Consult a healthcare provider.",

  evaluate(data, settings = { diabetes: true, hypertension: true, cardiovascular: true }) {
    const warnings = [];

    // DR-001: DIABETES
    if (settings.diabetes && data.sugars > 22.5) {
      warnings.push({
        disease: "Diabetes",
        condition: "High sugar linked to glucose spikes",
        triggerQuantity: `>${22.5}g`,
      });
    }

    // DR-002: HYPERTENSION
    if (settings.hypertension && data.sodium > 600) {
      warnings.push({
        disease: "Hypertension",
        condition: "High sodium linked to high BP",
        triggerQuantity: `>${600}mg`,
      });
    }

    // DR-003: CVD (Cardiovascular Disease)
    if (settings.cardiovascular && data.sat_fat > 5) {
      warnings.push({
        disease: "Heart Disease (CVD)",
        condition: "High sat fat increases LDL",
        triggerQuantity: `>${5}g`,
      });
    }

    // DR-004: CVD (Cardiovascular Disease)
    if (settings.cardiovascular && data.sodium > 400 && data.sodium <= 600) {
      warnings.push({
        disease: "Heart Disease (CVD)",
        condition: "Moderate-high sodium impacts heart",
        triggerQuantity: `>${400}mg`,
      });
    }

    // DR-005: KIDNEY — Potassium > 200 mg/100g
    if (settings.kidney && data.potassium > 200) {
      warnings.push({
        disease: "Kidney Disease",
        condition: "High potassium needs monitoring",
        triggerQuantity: `>${200}mg`,
      });
    }

    // DR-006: KIDNEY — Sodium > 600 mg/100g
    if (settings.kidney && data.sodium > 600) {
      warnings.push({
        disease: "Kidney Disease",
        condition: "High sodium strains compromised kidneys",
        triggerQuantity: `>${600}mg`,
      });
    }

    return {
      warnings: warnings,
      disclaimer: warnings.length > 0 ? this.DISCLAIMER : ""
    };
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { DiseaseEngine };
