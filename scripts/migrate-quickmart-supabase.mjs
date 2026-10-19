#!/usr/bin/env node
/**
 * scripts/migrate-quickmart-supabase.mjs
 *
 * Migrates the Quickmart dataset into Supabase in the exact same schema structure
 * as Carrefour and Naivas:
 *
 * 1. public.retailers:
 *    Registers 'QUICKMART' with hosts and display name to satisfy FK constraints.
 *
 * 2. public.catalog_products:
 *    Upserts full pipeline records with sha256 record_hash, review_state, and seq.
 *
 * 3. public.catalog_premium:
 *    Upserts precomputed disease assessments (diabetes, hypertension, renal, obesity)
 *    evaluated via DiseaseEngine with sha256 record_hash.
 *
 * 4. public.products (legacy table):
 *    Optionally upserts flattened product nutrient rows for legacy compatibility.
 *
 * USAGE:
 *   node scripts/migrate-quickmart-supabase.mjs [options]
 *
 * OPTIONS:
 *   --commit          Directly connect and upsert to Supabase (requires env variables)
 *   --sql             Generate standalone SQL snippet in supabase/snippets/migrate_quickmart.sql (default: true)
 *   --quickmart <path> Path to quickmart_products.json (default: src/extension/data/quickmart_products.json)
 *
 * ENV (for --commit):
 *   SUPABASE_URL              Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Supabase service role key (bypasses RLS)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}

const QUICKMART_PATH = opt('--quickmart', join(ROOT, 'src/extension/data/quickmart_products.json'))
const COMMIT = flag('--commit')
const CLI_URL = opt('--url', null)
const CLI_KEY = opt('--key', null)

// Auto-load .env if present
const envPath = join(ROOT, '.env')
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
  }
}

// Load canonical helpers
const { stableStringify, sha256Hex, recordHash } = await import('../src/shared/canonical.mjs')

// Load engine modules for precomputed premium disease assessments
const require = createRequire(import.meta.url)
require('../src/extension/engine/health-flags.js')
require('../src/extension/engine/scorers/energy-dense.js')
require('../src/extension/engine/scorers/fibre-forward.js')
require('../src/extension/engine/scorers/protein-tradeoff.js')
require('../src/extension/engine/scorers/strict-density.js')
require('../src/extension/engine/scorers/general.js')
const diseaseEngineModule = require('../src/extension/pipeline/disease-engine.js')
const DiseaseEngine = diseaseEngineModule.DiseaseEngine || globalThis.DiseaseEngine

function computeAssessments(product) {
  const conditions = {
    diabetes: { active: true },
    hypertension: { active: true },
    renal: { active: true },
    obesity: { active: true },
  }
  const assessments = {}
  for (const [key, cond] of Object.entries(conditions)) {
    try {
      const result = DiseaseEngine.evaluate(product, { conditions: { [key]: cond } })
      assessments[key] = {
        diseaseAssessment: result.diseaseAssessment?.[key] ?? {},
        warnings: (result.warnings ?? []).filter(
          (w) =>
            w.condition === key ||
            w.disease?.toLowerCase().includes(key.split('_')[0]) ||
            (key === 'renal' && w.disease?.toLowerCase().includes('kidney')),
        ),
      }
    } catch (e) {
      assessments[key] = { diseaseAssessment: {}, warnings: [], error: e.message }
    }
  }
  return assessments
}

// Plausibility bounds per NUT-04 catalog specification
function plausibilityErrors(p) {
  const n = p.Nutrition || {}
  const errors = []
  const chk = (field, val, min, max) => {
    if (val == null) return
    const v = parseFloat(val)
    if (isNaN(v) || v < min || v > max) errors.push(`${field}=${v} outside [${min},${max}]`)
  }
  chk('FatG', n.FatG, 0, 100)
  chk('SaturatedFatG', n.SaturatedFatG, 0, 100)
  chk('CarbohydratesG', n.CarbohydratesG, 0, 100)
  chk('SugarsG', n.SugarsG, 0, 100)
  chk('FibreG', n.FibreG, 0, 100)
  chk('ProteinG', n.ProteinG, 0, 100)
  chk('EnergyKcal', n.EnergyKcal, 0, 900)
  chk('EnergyKJ', n.EnergyKJ, 0, 3800)
  chk('SodiumMG', n.SodiumMG, 0, 40000)
  if (
    n.SaturatedFatG != null &&
    n.FatG != null &&
    parseFloat(n.SaturatedFatG) > parseFloat(n.FatG) + 0.1
  ) {
    errors.push(`SaturatedFatG(${n.SaturatedFatG}) > FatG(${n.FatG})`)
  }
  return errors
}

const REQUIRED_BLOCKS = [
  'Identity',
  'Classification',
  'Packaging',
  'Nutrition',
  'NutritionProvenance',
  'Validation',
  'Price',
]
const VALID_REVIEW_STATES = new Set([
  'REJECTED',
  'UNVERIFIED',
  'ESTIMATED',
  'VERIFIED',
  'HIGH_CONFIDENCE',
])

function validateRecord(p) {
  const errors = []
  for (const block of REQUIRED_BLOCKS) {
    if (!p[block] || typeof p[block] !== 'object') errors.push(`Missing block: ${block}`)
  }
  if (p.Identity?.Retailer && p.Identity.Retailer !== 'QUICKMART') {
    errors.push(`Identity.Retailer="${p.Identity.Retailer}" does not match 'QUICKMART'`)
  }
  const rs = p.Validation?.ReviewState
  if (rs && !VALID_REVIEW_STATES.has(rs)) {
    errors.push(`Invalid ReviewState: ${rs}`)
  }
  errors.push(...plausibilityErrors(p))
  return errors
}

async function main() {
  console.log('================ QUICKMART SUPABASE MIGRATION ================')
  console.log(`Loading Quickmart dataset from: ${QUICKMART_PATH}`)

  if (!existsSync(QUICKMART_PATH)) {
    console.error(`✗ Quickmart data file not found: ${QUICKMART_PATH}`)
    process.exit(1)
  }

  const rawProducts = JSON.parse(readFileSync(QUICKMART_PATH, 'utf8'))
  console.log(`Loaded ${rawProducts.length} raw Quickmart records.`)

  // Validate records
  const validProducts = []
  const invalidRecords = []
  for (const p of rawProducts) {
    const errs = validateRecord(p)
    if (errs.length > 0) {
      invalidRecords.push({ id: p.Identity?.ProductID, name: p.Identity?.ProductName, errs })
    } else {
      validProducts.push(p)
    }
  }

  console.log(`Valid records: ${validProducts.length}`)
  if (invalidRecords.length > 0) {
    console.warn(`Skipped ${invalidRecords.length} records due to validation/plausibility errors:`)
    invalidRecords.forEach((r) => console.warn(`  - ID ${r.id}: ${r.errs.join(', ')}`))
  }

  // Deduplicate
  const byId = new Map()
  for (const p of validProducts) {
    const id = String(p.Identity?.ProductID)
    byId.set(id, p)
  }
  const dedupedProducts = [...byId.values()]
  console.log(`Records after deduplication: ${dedupedProducts.length}`)

  // Compute hashes and assessments
  console.log('Computing canonical record hashes and disease assessments...')
  const productRows = []
  const premiumRows = []

  for (const p of dedupedProducts) {
    const pId = String(p.Identity?.ProductID)
    const hash = await recordHash(p)
    const assessments = computeAssessments(p)
    const premHash = await recordHash(assessments)

    productRows.push({
      retailer: 'QUICKMART',
      product_id: pId,
      record: p,
      record_hash: hash,
      review_state: p.Validation?.ReviewState || 'UNVERIFIED',
    })

    premiumRows.push({
      retailer: 'QUICKMART',
      product_id: pId,
      assessments,
      record_hash: premHash,
    })
  }

  // Also build rows for legacy public.products table
  const legacyRows = []
  for (const p of dedupedProducts) {
    const identity = p.Identity || {}
    const classification = p.Classification || {}
    const packaging = p.Packaging || {}
    const nutrition = p.Nutrition || {}

    const sodiumMg = nutrition.SodiumMG != null ? Number(nutrition.SodiumMG) : null
    let saltG = nutrition.SaltG != null ? Number(nutrition.SaltG) : null
    if (saltG === null && sodiumMg !== null) {
      saltG = Number(((sodiumMg / 1000) * 2.5).toFixed(4))
    }

    legacyRows.push({
      retailer_product_id: String(identity.ProductID || ''),
      retailer: 'QUICKMART',
      product_name: identity.ProductName || null,
      product_url: identity.RetailerProductUrl || null,
      normalized_name: identity.NormalizedName || null,
      brand_name: identity.BrandName || null,
      nutrition_category: classification.NutritionCategory || null,
      pack_size_unit: packaging.PackSizeUnit || null,
      energy_kj: nutrition.EnergyKJ != null ? Number(nutrition.EnergyKJ) : null,
      energy_kcal: nutrition.EnergyKcal != null ? Number(nutrition.EnergyKcal) : null,
      sugars_g: nutrition.SugarsG != null ? Number(nutrition.SugarsG) : null,
      sat_fat_g: nutrition.SaturatedFatG != null ? Number(nutrition.SaturatedFatG) : null,
      fat_g: nutrition.FatG != null ? Number(nutrition.FatG) : null,
      carbohydrates_g: nutrition.CarbohydratesG != null ? Number(nutrition.CarbohydratesG) : null,
      fibre_g: nutrition.FibreG != null ? Number(nutrition.FibreG) : null,
      sodium_mg: sodiumMg,
      salt_g: saltG,
      protein_g: nutrition.ProteinG != null ? Number(nutrition.ProteinG) : null,
      base_nutriscore_grade: classification.NutriScore || null,
    })
  }

  // Generate SQL migration snippet
  console.log('Generating standalone Supabase migration snippet...')
  const snippetsDir = join(ROOT, 'supabase', 'snippets')
  if (!existsSync(snippetsDir)) mkdirSync(snippetsDir, { recursive: true })

  const sqlFilePath = join(snippetsDir, 'migrate_quickmart.sql')
  const sqlChunks = []

  sqlChunks.push(`-- ====================================================================`)
  sqlChunks.push(`-- Migration: Quickmart Schema & Dataset Deployment to Supabase`)
  sqlChunks.push(`-- Matches exact structure of Naivas and Carrefour`)
  sqlChunks.push(`-- ====================================================================\n`)
  sqlChunks.push(`-- 1. Ensure Quickmart is registered in public.retailers`)
  sqlChunks.push(`INSERT INTO public.retailers (id, display_name, hosts) VALUES`)
  sqlChunks.push(`  ('QUICKMART', 'Quickmart', ARRAY['quickmart.co.ke'])`)
  sqlChunks.push(`ON CONFLICT (id) DO UPDATE SET`)
  sqlChunks.push(`  display_name = EXCLUDED.display_name,`)
  sqlChunks.push(`  hosts = EXCLUDED.hosts;\n`)

  // SQL function call to upsert via catalog_upsert in JSON chunks
  sqlChunks.push(`-- 2. Upsert Quickmart products into public.catalog_products`)
  sqlChunks.push(`-- Invokes public.catalog_upsert in batches of 500\n`)

  const BATCH_SIZE = 500
  for (let i = 0; i < productRows.length; i += BATCH_SIZE) {
    const chunk = productRows.slice(i, i + BATCH_SIZE)
    const jsonLiteral = JSON.stringify(chunk).replace(/'/g, "''")
    sqlChunks.push(`SELECT public.catalog_upsert('${jsonLiteral}'::jsonb);`)
  }

  sqlChunks.push(`\n-- 3. Upsert Quickmart assessments into public.catalog_premium`)
  sqlChunks.push(`-- Invokes public.catalog_premium_upsert in batches of 500\n`)
  for (let i = 0; i < premiumRows.length; i += BATCH_SIZE) {
    const chunk = premiumRows.slice(i, i + BATCH_SIZE)
    const jsonLiteral = JSON.stringify(chunk).replace(/'/g, "''")
    sqlChunks.push(`SELECT public.catalog_premium_upsert('${jsonLiteral}'::jsonb);`)
  }

  writeFileSync(sqlFilePath, sqlChunks.join('\n'), 'utf8')
  console.log(`✓ Generated SQL migration file: ${sqlFilePath}`)

  // Generate legacy table SQL migration snippet
  const legacySqlFilePath = join(snippetsDir, 'migrate_quickmart_legacy_products.sql')
  const legacySqlChunks = [
    `-- ====================================================================`,
    `-- Migration: Quickmart Products (public.products legacy table)`,
    `-- Matches structure from scripts/ingest_products.ts`,
    `-- ====================================================================\n`,
  ]
  for (let i = 0; i < legacyRows.length; i += BATCH_SIZE) {
    const chunk = legacyRows.slice(i, i + BATCH_SIZE)
    legacySqlChunks.push(`INSERT INTO public.products (`)
    legacySqlChunks.push(
      `  retailer_product_id, retailer, product_name, product_url, normalized_name,`,
    )
    legacySqlChunks.push(
      `  brand_name, nutrition_category, pack_size_unit, energy_kj, energy_kcal,`,
    )
    legacySqlChunks.push(
      `  sugars_g, sat_fat_g, fat_g, carbohydrates_g, fibre_g, sodium_mg, salt_g,`,
    )
    legacySqlChunks.push(`  protein_g, base_nutriscore_grade, updated_at`)
    legacySqlChunks.push(`) VALUES`)
    const valRows = chunk.map((r) => {
      const esc = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`)
      const num = (n) => (n == null || isNaN(n) ? 'NULL' : String(n))
      return `  (${esc(r.retailer_product_id)}, ${esc(r.retailer)}, ${esc(r.product_name)}, ${esc(r.product_url)}, ${esc(r.normalized_name)}, ${esc(r.brand_name)}, ${esc(r.nutrition_category)}, ${esc(r.pack_size_unit)}, ${num(r.energy_kj)}, ${num(r.energy_kcal)}, ${num(r.sugars_g)}, ${num(r.sat_fat_g)}, ${num(r.fat_g)}, ${num(r.carbohydrates_g)}, ${num(r.fibre_g)}, ${num(r.sodium_mg)}, ${num(r.salt_g)}, ${num(r.protein_g)}, ${esc(r.base_nutriscore_grade)}, now())`
    })
    legacySqlChunks.push(
      valRows.join(',\n') + '\nON CONFLICT (retailer, retailer_product_id) DO UPDATE SET',
    )
    legacySqlChunks.push(`  product_name = EXCLUDED.product_name,`)
    legacySqlChunks.push(`  product_url = EXCLUDED.product_url,`)
    legacySqlChunks.push(`  normalized_name = EXCLUDED.normalized_name,`)
    legacySqlChunks.push(`  brand_name = EXCLUDED.brand_name,`)
    legacySqlChunks.push(`  nutrition_category = EXCLUDED.nutrition_category,`)
    legacySqlChunks.push(`  pack_size_unit = EXCLUDED.pack_size_unit,`)
    legacySqlChunks.push(`  energy_kj = EXCLUDED.energy_kj,`)
    legacySqlChunks.push(`  energy_kcal = EXCLUDED.energy_kcal,`)
    legacySqlChunks.push(`  sugars_g = EXCLUDED.sugars_g,`)
    legacySqlChunks.push(`  sat_fat_g = EXCLUDED.sat_fat_g,`)
    legacySqlChunks.push(`  fat_g = EXCLUDED.fat_g,`)
    legacySqlChunks.push(`  carbohydrates_g = EXCLUDED.carbohydrates_g,`)
    legacySqlChunks.push(`  fibre_g = EXCLUDED.fibre_g,`)
    legacySqlChunks.push(`  sodium_mg = EXCLUDED.sodium_mg,`)
    legacySqlChunks.push(`  salt_g = EXCLUDED.salt_g,`)
    legacySqlChunks.push(`  protein_g = EXCLUDED.protein_g,`)
    legacySqlChunks.push(`  base_nutriscore_grade = EXCLUDED.base_nutriscore_grade,`)
    legacySqlChunks.push(`  updated_at = now();\n`)
  }
  writeFileSync(legacySqlFilePath, legacySqlChunks.join('\n'), 'utf8')
  console.log(`✓ Generated legacy SQL migration file: ${legacySqlFilePath}`)

  // Also write an importable JSON payload for batch RPC
  const payloadPath = join(ROOT, 'supabase', 'snippets', 'quickmart_catalog_payload.json')
  writeFileSync(
    payloadPath,
    JSON.stringify(
      {
        retailer: 'QUICKMART',
        productRowsCount: productRows.length,
        premiumRowsCount: premiumRows.length,
        legacyRowsCount: legacyRows.length,
        productRows: productRows.slice(0, 10), // sample preview
      },
      null,
      2,
    ),
    'utf8',
  )

  // If --commit, perform direct Supabase upserts via @supabase/supabase-js
  if (COMMIT) {
    const SUPABASE_URL = CLI_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const SUPABASE_KEY = CLI_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.error(
        '\n✗ Direct Supabase ingestion via --commit requires SUPABASE_SERVICE_ROLE_KEY.',
      )
      console.error('  Because catalog tables enforce strict RLS and REVOKE write permissions from')
      console.error('  the public anon key, service-level writes require the Service Role Key.\n')
      console.error('  You can provide the key using ANY of the following:')
      console.error('  1. Add to .env: SUPABASE_SERVICE_ROLE_KEY=your_key_here')
      console.error(
        '  2. Pass as a flag: node scripts/migrate-quickmart-supabase.mjs --commit --key your_key_here',
      )
      console.error(
        '  3. Set in PowerShell: $env:SUPABASE_SERVICE_ROLE_KEY="your_key_here"; node scripts/migrate-quickmart-supabase.mjs --commit',
      )
      console.error('\n  Alternatively, you can run the migration WITHOUT API keys directly in the')
      console.error('  Supabase Dashboard SQL Editor by pasting:')
      console.error(`    ${sqlFilePath}\n`)
      process.exit(2)
    }

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    console.log(`Connecting to Supabase at ${SUPABASE_URL}...`)

    // 1. Ensure retailer is inserted
    const { error: retErr } = await supabase
      .from('retailers')
      .upsert([{ id: 'QUICKMART', display_name: 'Quickmart', hosts: ['quickmart.co.ke'] }], {
        onConflict: 'id',
      })
    if (retErr) console.warn('Warning updating retailers table:', retErr.message)
    else console.log('✓ Registered QUICKMART in public.retailers')

    // 2. Upsert catalog_products
    console.log(`Upserting ${productRows.length} catalog_products rows...`)
    for (let i = 0; i < productRows.length; i += BATCH_SIZE) {
      const batch = productRows.slice(i, i + BATCH_SIZE)
      const { error } = await supabase.rpc('catalog_upsert', { p_rows: batch })
      if (error) {
        console.error(`✗ catalog_upsert failed at batch ${i / BATCH_SIZE + 1}: ${error.message}`)
        process.exit(1)
      }
      console.log(`  Products ${i + 1}–${Math.min(i + BATCH_SIZE, productRows.length)} upserted`)
    }

    // 3. Upsert catalog_premium
    console.log(`Upserting ${premiumRows.length} catalog_premium rows...`)
    for (let i = 0; i < premiumRows.length; i += BATCH_SIZE) {
      const batch = premiumRows.slice(i, i + BATCH_SIZE)
      const { error } = await supabase.rpc('catalog_premium_upsert', { p_rows: batch })
      if (error) {
        console.error(
          `✗ catalog_premium_upsert failed at batch ${i / BATCH_SIZE + 1}: ${error.message}`,
        )
        process.exit(1)
      }
      console.log(`  Premium ${i + 1}–${Math.min(i + BATCH_SIZE, premiumRows.length)} upserted`)
    }

    // 4. Upsert legacy public.products
    console.log(`Upserting ${legacyRows.length} public.products rows...`)
    for (let i = 0; i < legacyRows.length; i += BATCH_SIZE) {
      const batch = legacyRows.slice(i, i + BATCH_SIZE)
      const { error } = await supabase.from('products').upsert(batch, {
        onConflict: 'retailer,retailer_product_id',
      })
      if (error) {
        console.warn(
          `Warning: public.products upsert batch ${i / BATCH_SIZE + 1} failed: ${error.message}`,
        )
      } else {
        console.log(
          `  Legacy Products ${i + 1}–${Math.min(i + BATCH_SIZE, legacyRows.length)} upserted`,
        )
      }
    }

    console.log('✓ Direct Supabase migration completed successfully!')
  } else {
    console.log('\nDRY RUN / SQL GENERATION COMPLETE.')
    console.log('  - SQL file ready at: supabase/snippets/migrate_quickmart.sql')
    console.log(
      '  - Legacy SQL file ready at: supabase/snippets/migrate_quickmart_legacy_products.sql',
    )
    console.log('  - To execute live against Supabase via API, run with:')
    console.log('    node scripts/migrate-quickmart-supabase.mjs --commit')
    console.log('    (ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in environment)')
  }

  console.log('==============================================================')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
