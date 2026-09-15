const fs = require('fs');
const vm = require('vm');

const runTests = () => {
  const code = fs.readFileSync('./src/extension/engine/disease-engine.js', 'utf8');
  
  // Create a mock module object
  const sandbox = {
    module: { exports: {} },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  
  const DiseaseEngine = sandbox.module.exports.DiseaseEngine;

  const patientProfile = {
    conditions: {
      diabetes: { active: true },
      hypertension: { active: true },
      renal: { active: true }
    }
  };

  console.log("--- Test 1: Full Data Product ---");
  const fullProduct = {
    Identity: { ProductID: "1" },
    Nutrition: {
      SugarsG: 30,           // above 22.5, triggers diabetes
      CarbohydratesG: 70,
      EnergyKcal: 450,
      FibreG: 8,
      SodiumMG: 650,         // above 600, triggers hypertension/renal
      SaturatedFatG: 6,
      PotassiumMG: 250,      // above 200, triggers renal
      ProteinG: 20
    }
  };
  const r1 = DiseaseEngine.evaluate(fullProduct, patientProfile);
  console.log("Warnings:", r1.warnings.length);
  console.log("Diabetes Assessment:", r1.diseaseAssessment.diabetes?.dataConfidence);

  console.log("\n--- Test 2: Missing Major Nutrient ---");
  const missMajorProduct = {
    Identity: { ProductID: "2" },
    Nutrition: {
      CarbohydratesG: 70,
      EnergyKcal: 450,
      FibreG: 8,
      SodiumMG: 650,
      SaturatedFatG: 6,
      PotassiumMG: 250,
      ProteinG: 20
    }
  };
  const r2 = DiseaseEngine.evaluate(missMajorProduct, patientProfile);
  console.log("Diabetes Confidence (expect low):", r2.diseaseAssessment.diabetes?.dataConfidence);

  console.log("\n--- Test 3: Missing Minor Nutrient ---");
  const missMinorProduct = {
    Identity: { ProductID: "3" },
    Nutrition: {
      SugarsG: 30,
      EnergyKcal: 450,
      FibreG: 8,
      SodiumMG: 650,
      SaturatedFatG: 6,
      PotassiumMG: 250,
      ProteinG: 20
    }
  };
  const r3 = DiseaseEngine.evaluate(missMinorProduct, patientProfile);
  console.log("Diabetes Confidence (expect degraded):", r3.diseaseAssessment.diabetes?.dataConfidence);

  console.log("\n--- Test 4: Malformed Product ---");
  try {
    DiseaseEngine.evaluate({}, patientProfile);
    console.log("FAILED: Did not throw");
  } catch (e) {
    console.log("PASSED: Threw error -", e.message);
  }

  console.log("\n--- Test 5: Negative Values ---");
  const negProduct = {
    Identity: { ProductID: "5" },
    Nutrition: {
      SugarsG: 30,
      CarbohydratesG: -5,
      EnergyKcal: 450,
      FibreG: 8,
      SodiumMG: 650,
      SaturatedFatG: 6,
      PotassiumMG: 250,
      ProteinG: 20
    }
  };
  const r5 = DiseaseEngine.evaluate(negProduct, patientProfile);
  console.log("Diabetes Confidence (expect degraded):", r5.diseaseAssessment.diabetes?.dataConfidence);
  
};

runTests();
