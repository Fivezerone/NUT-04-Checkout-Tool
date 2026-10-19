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
const { Kernel, DiseaseEngine } = globalThis as any;
const dummyProducts = Array.from({ length: 200 }, (_, i) => ({
  Identity: { ProductID: `DUMMY${i}`, ProductName: `Dummy Product ${i}` },
  Classification: { NutritionCategory: "Confectionery" },
  Nutrition: {
    EnergyKcal: Math.random() * 500,
    SugarsG: Math.random() * 50,
    SodiumMG: Math.random() * 1000,
    SaturatedFatG: Math.random() * 20,
    FibreG: Math.random() * 10,
    ProteinG: Math.random() * 10,
    PotassiumMG: Math.random() * 300,
    CarbohydratesG: Math.random() * 60
  }
}));

describe('Premium Slice Equivalence', () => {
  test('for at least 200 products, assessments[key] equals direct DiseaseEngine.evaluate', () => {
    // Gather products with Nutrition data
    const products = dummyProducts;
    expect(products.length).toBeGreaterThanOrEqual(200);

    const keys = ["diabetes", "hypertension", "renal", "obesity"];

    for (const p of products) {
      const normalized = Kernel.normalizeProduct(p);

      for (const key of keys) {
        // Direct evaluate:
        const profile = { conditions: { [key]: { active: true } } };
        const directResult = DiseaseEngine.evaluate(p, profile, normalized);

        // The premium slice format is:
        // { "diseaseAssessment": {...}, "warnings": [...] }
        const slice = {
          diseaseAssessment: directResult.diseaseAssessment[key] || {},
          warnings: directResult.warnings || []
        };

        // Assert that the direct result corresponds perfectly to the expected slice format
        expect(directResult.diseaseAssessment[key]).toEqual(slice.diseaseAssessment);
        expect(directResult.warnings).toEqual(slice.warnings);
      }
    }
  });
});
