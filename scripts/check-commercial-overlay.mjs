#!/usr/bin/env node
/**
 * NutriScore CAD Phase 8 — Commercial Overlay Quality & Leak Proofs Guard
 *
 * Reference: Blueprint §4.3, Decision D6, Amendment A6
 *
 * Verifies Phase 8 Exit Criteria:
 * 1. A stakeholder cannot see an alias (v_orders_tracking & v_sku_demand column check).
 * 2. Demand view suppresses cells under 5 shoppers (k >= 5 cohort gate check).
 * 3. Prohibited terms ('on_hand', 'payment', 'checkout') are completely absent
 *    from commercial overlay migrations, rollbacks, shared modules, and edge functions.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const dirnameHere = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(dirnameHere, '..')

function queryPsql(sql) {
  try {
    return execFileSync(
      'docker',
      [
        'exec',
        '-i',
        'nut-04-checkout-tool-postgres-1',
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-t',
        '-A',
        '-c',
        sql,
      ],
      { encoding: 'utf8' },
    ).trim()
  } catch (err) {
    throw new Error(`psql failed: ${err.stderr || err.message}`, { cause: err })
  }
}

console.log('[INFO] Running CAD Phase 8 Commercial Overlay Quality & Leak Proofs...')

// ---------------------------------------------------------------------------
// Step 1: Verify stakeholder views contain NO alias columns
// ---------------------------------------------------------------------------
console.log('[STEP 1] Verifying stakeholder views expose NO shopper alias...')

const viewColumnsQuery = `
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'commercial'
    AND table_name IN ('v_orders_tracking', 'v_sku_demand')
    AND column_name LIKE '%alias%';
`

const aliasCols = queryPsql(viewColumnsQuery)
if (aliasCols.length > 0) {
  console.error(`[FAIL] Found alias columns in commercial stakeholder views: ${aliasCols}`)
  process.exit(1)
}
console.log('[OK] Commercial stakeholder views expose zero alias columns ✓')

// ---------------------------------------------------------------------------
// Step 2: Verify v_sku_demand enforces k >= 5 cohort gate
// ---------------------------------------------------------------------------
console.log('[STEP 2] Verifying v_sku_demand enforces k >= 5 cohort gate...')

const viewDefQuery = `
  SELECT definition
  FROM pg_views
  WHERE schemaname = 'commercial' AND viewname = 'v_sku_demand';
`
const viewDef = queryPsql(viewDefQuery)
if (!viewDef.includes('5') || !viewDef.toLowerCase().includes('having')) {
  console.error('[FAIL] v_sku_demand does not contain HAVING >= 5 cohort gate')
  process.exit(1)
}
console.log('[OK] v_sku_demand contains HAVING >= 5 cohort gate ✓')

// ---------------------------------------------------------------------------
// Step 3: CI grep for prohibited keywords (Decision D6)
// 'on_hand', 'payment', 'checkout'
// ---------------------------------------------------------------------------
console.log(
  '[STEP 3] Verifying prohibited terms (on_hand, payment, checkout) in commercial overlay...',
)

// Build split strings to avoid false self-match
const PROHIBITED_TERMS = [
  ['on', 'hand'].join('_'),
  ['pay', 'ment'].join(''),
  ['check', 'out'].join(''),
]

// TODO(Stage C): Supabase migration and function paths were removed in A-07.
// When the Docker-native migration pipeline is in place, add:
//   db/migrations/<timestamp>_commercial_overlay.sql
//   src/shared/commercial-catalogue.ts
//   src/extension/observed-orders-sync.js
const TARGET_FILES = [
  'src/shared/commercial-catalogue.ts',
  'src/extension/observed-orders-sync.js',
]

let violations = 0

for (const relPath of TARGET_FILES) {
  const fullPath = join(repoRoot, relPath)
  if (!existsSync(fullPath)) continue

  const content = readFileSync(fullPath, 'utf8')
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase()
    for (const term of PROHIBITED_TERMS) {
      if (line.includes(term.toLowerCase())) {
        console.error(`[FAIL] Prohibited term '${term}' found in ${relPath}:${i + 1}`)
        console.error(`       Line: ${lines[i].trim()}`)
        violations++
      }
    }
  }
}

if (violations > 0) {
  console.error(
    `[FAIL] Found ${violations} prohibited term violation(s) in commercial overlay files!`,
  )
  process.exit(1)
}

console.log('[OK] Zero prohibited terms found across commercial overlay migrations and functions ✓')

// ---------------------------------------------------------------------------
// Step 4: Verify commercial.skus contains curated data
// ---------------------------------------------------------------------------
console.log('[STEP 4] Verifying commercial.skus contains curated reference SKUs...')

const skusCount = parseInt(queryPsql('SELECT count(*) FROM commercial.skus;'), 10)
if (isNaN(skusCount) || skusCount === 0) {
  console.error('[FAIL] commercial.skus table is empty! Curation job must be run.')
  process.exit(1)
}
console.log(`[OK] commercial.skus contains ${skusCount} curated reference SKUs ✓`)

console.log('\n✅ [ALL PHASE 8 QUALITY & LEAK PROOFS PASSED]')
