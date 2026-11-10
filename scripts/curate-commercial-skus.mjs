#!/usr/bin/env node
/**
 * NutriScore CAD Blueprint Phase 8 — Commercial SKU Curation Job
 *
 * Reference: Blueprint §4.3, Decision D6, Amendment A6
 *
 * Ingestion job that curates reference SKUs into commercial.skus from
 * existing Naivas, Carrefour Kenya, and Quickmart Kenya datasets.
 * Preserves review_state ('REJECTED','UNVERIFIED','ESTIMATED','VERIFIED','HIGH_CONFIDENCE').
 * This platform job is the only writer to commercial.skus.
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
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        sql,
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    )
  } catch (err) {
    throw new Error(`psql command failed: ${err.stderr || err.message}`, { cause: err })
  }
}

const VALID_REVIEW_STATES = new Set([
  'REJECTED',
  'UNVERIFIED',
  'ESTIMATED',
  'VERIFIED',
  'HIGH_CONFIDENCE',
])

export function normalizeProductToSku(p, retailer) {
  const identity = p.Identity || p.identity || {}
  const classification = p.Classification || p.classification || {}
  const validation = p.Validation || p.validation || {}
  const nutrition = p.Nutrition || p.nutrition || {}

  const retailerProductId = String(
    identity.ProductID || identity.product_id || p.product_id || p.id || '',
  ).trim()
  if (!retailerProductId) return null

  const name = String(
    identity.ProductName || identity.product_name || p.name || 'Unnamed Product',
  ).trim()
  const brand = identity.BrandName || identity.brand_name || p.brand || null
  const categoryKfct =
    classification.NutritionCategory || classification.category || p.category || null

  let nova = classification.NOVA?.Level ?? classification.nova ?? null
  if (nova !== null) {
    nova = Number(nova)
    if (isNaN(nova) || nova < 1 || nova > 4) {
      nova = null
    }
  }

  let reviewState = String(
    validation.ReviewState || validation.review_state || p.review_state || 'VERIFIED',
  ).toUpperCase()
  if (!VALID_REVIEW_STATES.has(reviewState)) {
    reviewState = 'UNVERIFIED'
  }

  // Nutrition per 100g
  const per100g = {
    energy_kcal: nutrition.EnergyKcal ?? null,
    energy_kj: nutrition.EnergyKJ ?? null,
    sugars_g: nutrition.SugarsG ?? null,
    carbs_g: nutrition.CarbohydratesG ?? null,
    fat_g: nutrition.FatG ?? null,
    satfat_g: nutrition.SaturatedFatG ?? null,
    fibre_g: nutrition.FibreG ?? null,
    protein_g: nutrition.ProteinG ?? null,
    sodium_mg: nutrition.SodiumMG ?? null,
    salt_g: nutrition.SaltG ?? null,
  }

  return {
    retailer,
    retailer_product_id: retailerProductId,
    name,
    brand,
    category_kfct: categoryKfct,
    nova,
    per_100g: per100g,
    review_state: reviewState,
    active: true,
  }
}

export function loadRetailerDatasets(limitPerRetailer = 500) {
  const skus = []

  // 1. Carrefour Kenya
  const carrefourPath = join(repoRoot, 'src', 'extension', 'data', 'carrefour_products.json')
  if (existsSync(carrefourPath)) {
    const raw = JSON.parse(readFileSync(carrefourPath, 'utf8'))
    const list = Array.isArray(raw) ? raw : Object.values(raw)
    const slice = limitPerRetailer > 0 ? list.slice(0, limitPerRetailer) : list
    for (const item of slice) {
      const sku = normalizeProductToSku(item, 'carrefour_ke')
      if (sku) skus.push(sku)
    }
  }

  // 2. Naivas Kenya
  const naivasPath = join(repoRoot, 'src', 'extension', 'data', 'naivas_products.json')
  if (existsSync(naivasPath)) {
    const raw = JSON.parse(readFileSync(naivasPath, 'utf8'))
    const list = Array.isArray(raw) ? raw : Object.values(raw)
    const slice = limitPerRetailer > 0 ? list.slice(0, limitPerRetailer) : list
    for (const item of slice) {
      const sku = normalizeProductToSku(item, 'naivas')
      if (sku) skus.push(sku)
    }
  }

  // 3. Quickmart Kenya
  // TODO(Stage C): quickmart_catalog_payload.json was in supabase/snippets/ (deleted A-07).
  // Source this from src/extension/data/ or a Docker-native fixture path once ingestion
  // pipeline is set up. File existence check below is a safe guard – skips silently.
  const quickmartPath = join(repoRoot, 'src', 'extension', 'data', 'quickmart_catalog_payload.json')
  if (existsSync(quickmartPath)) {
    const raw = JSON.parse(readFileSync(quickmartPath, 'utf8'))
    const list = raw.productRows || (Array.isArray(raw) ? raw : [])
    const slice = limitPerRetailer > 0 ? list.slice(0, limitPerRetailer) : list
    for (const item of slice) {
      const record = item.record || item
      const sku = normalizeProductToSku(record, 'quickmart_ke')
      if (sku) skus.push(sku)
    }
  }

  return skus
}

export async function curateSkus(options = {}) {
  const limit = options.limit ?? 250
  const dryRun = options.dryRun ?? false

  const skus = loadRetailerDatasets(limit)
  console.log(`[curation] Loaded ${skus.length} normalized reference SKUs across retailers`)

  if (dryRun) {
    console.log('[curation] Dry run complete. No database changes made.')
    return { count: skus.length, inserted: 0 }
  }

  // Escape SQL string helper
  const esc = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`)

  // Batch insert in chunks of 50
  const chunkSize = 50
  let inserted = 0

  for (let i = 0; i < skus.length; i += chunkSize) {
    const chunk = skus.slice(i, i + chunkSize)
    const values = chunk
      .map((s) => {
        const per100gStr = esc(JSON.stringify(s.per_100g))
        const novaStr = s.nova === null ? 'NULL' : s.nova
        return `(${esc(s.retailer)}, ${esc(s.retailer_product_id)}, ${esc(s.name)}, ${esc(s.brand)}, ${esc(s.category_kfct)}, ${novaStr}, ${per100gStr}::jsonb, ${esc(s.review_state)}, ${s.active})`
      })
      .join(',\n')

    const sql = `
      INSERT INTO commercial.skus (
        retailer, retailer_product_id, name, brand, category_kfct,
        nova, per_100g, review_state, active
      ) VALUES
      ${values}
      ON CONFLICT (retailer, retailer_product_id) DO UPDATE SET
        name = EXCLUDED.name,
        brand = EXCLUDED.brand,
        category_kfct = EXCLUDED.category_kfct,
        nova = EXCLUDED.nova,
        per_100g = EXCLUDED.per_100g,
        review_state = EXCLUDED.review_state,
        active = EXCLUDED.active,
        updated_at = now();
    `

    queryPsql(sql)
    inserted += chunk.length
  }

  console.log(`[curation] Successfully curated ${inserted} SKUs into commercial.skus`)
  return { count: skus.length, inserted }
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dryRun = process.argv.includes('--dry-run')
  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 250

  curateSkus({ limit, dryRun })
    .then((res) => {
      console.log(`[curation] Job finished: ${res.inserted} SKUs curated.`)
      process.exit(0)
    })
    .catch((err) => {
      console.error('[curation] Job failed:', err)
      process.exit(1)
    })
}
