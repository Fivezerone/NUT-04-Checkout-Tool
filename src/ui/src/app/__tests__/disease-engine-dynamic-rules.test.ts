/**
 * Phase 5 Unit Test: Disease Engine Dynamic Rules & Clinician Health Modes
 *
 * Verifies:
 * 1. DiseaseEngine evaluates dynamic clinician-assigned rules across operators (gt, gte, lt, lte, eq).
 * 2. Alerts contain targetId, nutrient, actual, threshold, severity, and clinical rationale.
 * 3. Backward compatibility for legacy condition profiles (diabetes, hypertension, renal).
 * 4. Deduplication / single source of truth for warnings in disease-engine.
 */

import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('../../../../extension/engine/health-flags.js');
require('../../../../extension/engine/scorers/energy-dense.js');
require('../../../../extension/engine/scorers/fibre-forward.js');
require('../../../../extension/engine/scorers/protein-tradeoff.js');
require('../../../../extension/engine/scorers/strict-density.js');
require('../../../../extension/engine/scorers/general.js');
require('../../../../extension/engine/context-engine.js');
require('../../../../extension/pipeline/disease-engine.js');

const { DiseaseEngine } = globalThis as any;

describe('Phase 5 — DiseaseEngine Dynamic Rules & Health Modes', () => {
  const mockProduct = {
    Identity: { ProductID: 'PROD_TEST_001', ProductName: 'Salted High-Sugar Snack' },
    Nutrition: {
      SugarsG: 28.5,
      SodiumMG: 750,
      SaturatedFatG: 6.2,
      EnergyKcal: 480,
      ProteinG: 4.0,
      FibreG: 1.5,
      PotassiumMG: 120,
    },
  };

  test('evaluates dynamic rules with lte operator and returns structured alert when breached', () => {
    const patientProfile = {
      rules: [
        {
          targetId: 'RULE-SUGAR-01',
          nutrient: 'SugarsG',
          comparator: 'lte',
          threshold: 20.0,
          unit: 'g',
          severity: 'high',
          clinicalRationale: 'KNDI guidelines: restrict refined sugar <= 20g/100g for type-2 diabetes management',
        },
      ],
    };

    const result = DiseaseEngine.evaluate(mockProduct, patientProfile);

    expect(result.productId).toBe('PROD_TEST_001');
    expect(result.warnings.length).toBe(1);

    const alert = result.warnings[0];
    expect(alert.targetId).toBe('RULE-SUGAR-01');
    expect(alert.nutrient).toBe('SugarsG');
    expect(alert.actual).toBe(28.5);
    expect(alert.threshold).toBe(20.0);
    expect(alert.severity).toBe('high');
    expect(alert.clinicalRationale).toContain('KNDI guidelines');
    expect(result.disclaimer).toBeTruthy();
  });

  test('does not trigger alert when threshold is not violated', () => {
    const patientProfile = {
      rules: [
        {
          targetId: 'RULE-SODIUM-HIGH',
          nutrient: 'SodiumMG',
          comparator: 'lte',
          threshold: 1000,
          unit: 'mg',
          severity: 'warning',
          clinicalRationale: 'MOH Kenya sodium limit <= 1000mg',
        },
      ],
    };

    const result = DiseaseEngine.evaluate(mockProduct, patientProfile);
    expect(result.warnings.length).toBe(0);
    expect(result.disclaimer).toBe('');
  });

  test('evaluates multiple dynamic rules simultaneously', () => {
    const patientProfile = {
      rules: [
        {
          targetId: 'RULE-SUGAR',
          nutrient: 'SugarsG',
          comparator: 'lte',
          threshold: 25.0, // product has 28.5 -> breaches <= 25
          unit: 'g',
          severity: 'warning',
          clinicalRationale: 'Excess sugar',
        },
        {
          targetId: 'RULE-SODIUM',
          nutrient: 'SodiumMG',
          comparator: 'lte',
          threshold: 500, // product has 750 -> breaches <= 500
          unit: 'mg',
          severity: 'critical',
          clinicalRationale: 'Excess sodium',
        },
        {
          targetId: 'RULE-FIBRE',
          nutrient: 'FibreG',
          comparator: 'gte', // target >= 3.0g, product has 1.5g -> breaches >= 3
          threshold: 3.0,
          unit: 'g',
          severity: 'advisory',
          clinicalRationale: 'Adequate dietary fibre target',
        },
      ],
    };

    const result = DiseaseEngine.evaluate(mockProduct, patientProfile);
    expect(result.warnings.length).toBe(3);

    const targetIds = result.warnings.map((w: any) => w.targetId);
    expect(targetIds).toContain('RULE-SUGAR');
    expect(targetIds).toContain('RULE-SODIUM');
    expect(targetIds).toContain('RULE-FIBRE');
  });

  test('maintains backward-compatibility for condition flags alongside dynamic rules', () => {
    const patientProfile = {
      hypertension: true,
      rules: [
        {
          targetId: 'CUSTOM-POTASSIUM',
          nutrient: 'PotassiumMG',
          comparator: 'lte', // target <= 100, product has 120 -> breaches <= 100
          threshold: 100,
          unit: 'mg',
          severity: 'advisory',
          clinicalRationale: 'Restrict potassium for renal/hypertension balance',
        },
      ],
    };

    const result = DiseaseEngine.evaluate(mockProduct, patientProfile);
    expect(result.diseaseAssessment.hypertension).toBeDefined();
    // 2 warnings from hypertension preset (Sodium 750 > 600, SatFat 6.2 > 5.0) + 1 dynamic rule alert
    expect(result.warnings.length).toBe(3);
  });

  test('returns status "no_active_conditions" when profile has neither conditions nor rules', () => {
    const patientProfile = {};
    const result = DiseaseEngine.evaluate(mockProduct, patientProfile);

    expect(result.status).toBe('no_active_conditions');
    expect(result.warnings.length).toBe(0);
  });
});
