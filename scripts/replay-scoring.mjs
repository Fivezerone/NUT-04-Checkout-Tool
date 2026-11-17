/**
 * @license SPDX-License-Identifier: Apache-2.0
 * scripts/replay-scoring.mjs — Catalogue Scoring Replay and Parity Benchmark.
 * Reference: Blueprint §2.1 (E-01..E-07, Decision D-9, Invariant T20)
 *
 * Runs both legacy v4 (energy-only Gate 2 with safePos) and v5 (pure FSA-NPS with strict completeness)
 * across all seed product records, generating an invariant verification report.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
require('../src/extension/db.js')
const NutriScoreDB = globalThis.NutriScoreDB
const { evaluateItem } = NutriScoreDB

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const CATALOG_FILES = [
  { name: 'Carrefour', path: 'src/extension/data/carrefour_products.json' },
  { name: 'Naivas', path: 'src/extension/data/naivas_products.json' },
  { name: 'Quickmart', path: 'src/extension/data/quickmart_products.json' },
]

console.log('═'.repeat(70))
console.log('  NUT-04 SCORING REPLAY BENCHMARK (v4 Legacy vs v5 Strict)')
console.log('═'.repeat(70))

let grandTotal = 0
let grandV4Computable = 0
let grandV5Computable = 0
let grandViolations = 0

const missingBreakdown = {
  energy: 0,
  sugars: 0,
  saturated_fat: 0,
  sodium_or_salt: 0,
}

for (const cat of CATALOG_FILES) {
  const fullPath = resolve(ROOT, cat.path)
  if (!existsSync(fullPath)) {
    console.warn(`[SKIP] Missing file: ${cat.path}`)
    continue
  }

  const raw = JSON.parse(readFileSync(fullPath, 'utf8'))
  const products = Array.isArray(raw) ? raw : raw.products || raw.items || []
  const total = products.length
  grandTotal += total

  let v4Count = 0
  let v5Count = 0
  let catViolations = 0

  for (const p of products) {
    // 1. v4 legacy scoring (scoringVersion = undefined / v4)
    const v4Interp = NutriScoreDB.interpretProduct(p, { scoringVersion: 'v4' })
    const v4Grade = v4Interp.canDisplayGrade
      ? NutriScoreDB.computeGradeFromProduct(p, { scoringVersion: 'v4' })
      : null
    const v4Computable = v4Grade && v4Grade.status === 'computed'
    if (v4Computable) v4Count++

    // 2. v5 strict scoring
    const v5Eval = evaluateItem(p, null, { scoringVersion: 'v5', bypassCache: true })
    const v5Computable =
      v5Eval.status === 'COMPUTED_CONFIRMED' || v5Eval.status === 'COMPUTED_PROVISIONAL'
    if (v5Computable) v5Count++

    // Invariant check: if v5 refused a record that v4 scored, v5 MUST list missing nutrients
    if (v4Computable && !v5Computable) {
      if (!v5Eval.missing || v5Eval.missing.length === 0) {
        catViolations++
      }
    }

    if (!v5Computable && v5Eval.missing) {
      for (const m of v5Eval.missing) {
        if (m in missingBreakdown) missingBreakdown[m]++
      }
    }
  }

  grandV4Computable += v4Count
  grandV5Computable += v5Count
  grandViolations += catViolations

  const v4Pct = ((v4Count / total) * 100).toFixed(2)
  const v5Pct = ((v5Count / total) * 100).toFixed(2)
  console.log(`\nCatalogue: ${cat.name} (${total} SKUs)`)
  console.log(`  v4 Legacy Graded : ${v4Count.toString().padStart(6)} (${v4Pct}%)`)
  console.log(`  v5 Strict Graded : ${v5Count.toString().padStart(6)} (${v5Pct}%)`)
  console.log(`  Completeness Invariant Violations: ${catViolations}`)
}

console.log('\n' + '─'.repeat(70))
console.log('TOTAL SUMMARY:')
console.log(`  Total SKUs Evaluated : ${grandTotal}`)
console.log(
  `  Total v4 Computable  : ${grandV4Computable} (${((grandV4Computable / grandTotal) * 100).toFixed(2)}%)`,
)
console.log(
  `  Total v5 Computable  : ${grandV5Computable} (${((grandV5Computable / grandTotal) * 100).toFixed(2)}%)`,
)
console.log(`  Total Invariant Violations: ${grandViolations}`)
console.log('\nMissing Component Breakdown (on Incomputable SKUs):')
console.log(`  Energy          : ${missingBreakdown.energy}`)
console.log(`  Sugars          : ${missingBreakdown.sugars}`)
console.log(`  Saturated Fat   : ${missingBreakdown.saturated_fat}`)
console.log(`  Sodium / Salt   : ${missingBreakdown.sodium_or_salt}`)
console.log('═'.repeat(70))

if (grandViolations > 0) {
  console.error(`\n[FAIL] Found ${grandViolations} invariant violations!`)
  process.exit(1)
} else {
  console.log('\n[PASS] 100% of v4-to-v5 divergences explained by missing mandatory nutrients.')
  process.exit(0)
}
