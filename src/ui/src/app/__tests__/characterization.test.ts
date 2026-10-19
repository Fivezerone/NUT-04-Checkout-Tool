import { describe, test, expect } from 'vitest';
import { computeGradeFromProduct, interpretProduct, calculateAnalytics } from '../lib/db';
import { resolveTimeframe } from '../lib/db/analytics';
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
const { NutritionContextEngine, DiseaseEngine, Kernel } = globalThis as any;
const dummyProducts = [
  {
    "Identity": { "ProductID": "DUMMY1", "ProductName": "Dummy Biscuit" },
    "Classification": { "NutritionCategory": "Confectionery" },
    "Validation": { "ReviewState": "reviewed" },
    "NutritionInformation": {
      "EnergyKcal": 450,
      "SugarsG": 30,
      "SodiumMG": 150,
      "SaturatedFatG": 15,
      "FibreG": 2,
      "ProteinG": 5,
      "PotassiumMG": 100
    },
    "Nutrition": {
      "EnergyKcal": 450,
      "SugarsG": 30,
      "SodiumMG": 150,
      "SaturatedFatG": 15,
      "FibreG": 2,
      "ProteinG": 5,
      "PotassiumMG": 100
    }
  }
];

describe('Characterization Tests', () => {
  test('interpretProduct and computeGradeFromProduct snapshot for sample products', () => {
    const sampleProducts = [];
    const categories = new Set();
    const states = new Set();

    dummyProducts.forEach(p => {
        const cat = p.Classification?.NutritionCategory;
        const state = p.Validation?.ReviewState;
        if (cat && !categories.has(cat)) {
            categories.add(cat);
            sampleProducts.push(p);
        }
        if (state && !states.has(state)) {
            states.add(state);
            sampleProducts.push(p);
        }
    });

    const interpreted = sampleProducts.map(p => interpretProduct(p));
    expect(interpreted).toMatchSnapshot();

    const graded = sampleProducts.map(p => {
        const interpretation = interpretProduct(p);
        if (interpretation.grade_computed_fsa_nps !== null) return interpretation.grade_computed_fsa_nps;
        return computeGradeFromProduct(p);
    });
    expect(graded).toMatchSnapshot();
  });

  test('NutritionContextEngine / DiseaseEngine scorers', () => {
      const p1 = dummyProducts[0];
      if (p1 && NutritionContextEngine) {
          const normalized = Kernel.normalizeProduct(p1);
          const res1 = NutritionContextEngine.buildHealthFlags(p1, normalized);
          expect(res1).toMatchSnapshot();
          if (DiseaseEngine) {
              const profile = { conditions: { diabetes: { active: true }, hypertension: { active: true } } };
              const interaction = DiseaseEngine.evaluate(p1, profile, normalized);
              expect(interaction).toMatchSnapshot();
          }
      }
  });

  test('calculateAnalytics snapshot', () => {
    const dummyLedger = [
      {
        id: '1',
        createdAt: new Date('2026-09-01T12:00:00Z'),
        cartItems: [
          { productData: dummyProducts[0], quantity: 1, price: 100 },
          { productData: dummyProducts[0], quantity: 2, price: 50 },
        ]
      }
    ];
    const tf = resolveTimeframe('week', new Date('2026-09-08T12:00:00Z').getTime());
    const analytics = calculateAnalytics(dummyLedger, 1, tf);
    expect(analytics).toMatchSnapshot();
  });
});
