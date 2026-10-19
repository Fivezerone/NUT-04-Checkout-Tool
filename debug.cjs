const fs = require('fs')
const vm = require('vm')

const code = fs.readFileSync('./src/extension/engine/nutri-score-engine.js', 'utf8')
const sandbox = { module: { exports: {} }, console: console }
vm.createContext(sandbox)
vm.runInContext(code, sandbox)
const { DiseaseEngine } = sandbox.module.exports

const patientProfile = { conditions: { hypertension: { active: true } } }
const saltProduct = { Identity: { ProductID: '6' }, Nutrition: { SaltG: 2, SaturatedFatG: 2 } }

try {
  const r6 = DiseaseEngine.evaluate(saltProduct, patientProfile)
  console.log(JSON.stringify(r6, null, 2))
} catch (e) {
  console.error('Error:', e)
}
