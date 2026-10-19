#!/usr/bin/env node
/**
 * scripts/publish-catalog.mjs
 *
 * Publish the NUT-04 product catalog to Supabase.
 *
 * USAGE:
 *   node scripts/publish-catalog.mjs [options]
 *
 * OPTIONS:
 *   --carrefour <path>   Path to carrefour_products.json  (default: src/extension/data/carrefour_products.json)
 *   --naivas   <path>    Path to naivas_products.json     (default: src/extension/data/naivas_products.json)
 *   --quickmart <path>   Path to quickmart_products.json  (default: src/extension/data/quickmart_products.json)
 *   --commit             Actually write to Supabase (default: dry run)
 *   --allow-dedupe       Required to proceed when expected duplicates are found
 *   --force-count-change Allow >10% change in retailer product count
 *
 * ENV:
 *   SUPABASE_URL             Required for --commit
 *   SUPABASE_SERVICE_ROLE_KEY Required for --commit
 *   CATALOG_SIGNING_KEY      JWK (private, ES256) — required for --commit
 *
 * EXIT CODES:
 *   0  success
 *   1  validation / dedupe / count guard / hash mismatch abort
 *   2  env/config error
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { webcrypto } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ─── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}

const CARREFOUR_PATH = opt('--carrefour', join(ROOT, 'src/extension/data/carrefour_products.json'))
const NAIVAS_PATH = opt('--naivas', join(ROOT, 'src/extension/data/naivas_products.json'))
const QUICKMART_PATH = opt('--quickmart', join(ROOT, 'src/extension/data/quickmart_products.json'))
const COMMIT = flag('--commit')
const ALLOW_DEDUPE = flag('--allow-dedupe')
const FORCE_COUNT = flag('--force-count-change')

// ─── Imports ─────────────────────────────────────────────────────────────────
const { subtle } = webcrypto

// Load canonical helpers (ESM)
const { stableStringify, sha256Hex, recordHash, computeCatalogHash } =
  await import('../src/shared/canonical.mjs')

// Load engine modules (CJS via require — loaded in dependency order)
const require = createRequire(import.meta.url)
require('../src/extension/engine/health-flags.js')
require('../src/extension/engine/scorers/energy-dense.js')
require('../src/extension/engine/scorers/fibre-forward.js')
require('../src/extension/engine/scorers/protein-tradeoff.js')
require('../src/extension/engine/scorers/strict-density.js')
require('../src/extension/engine/scorers/general.js')
const diseaseEngineModule = require('../src/extension/pipeline/disease-engine.js')
const DiseaseEngine = diseaseEngineModule.DiseaseEngine || globalThis.DiseaseEngine

// ─── Helpers ─────────────────────────────────────────────────────────────────
function die(msg, code = 1) {
  console.error('✗', msg)
  process.exit(code)
}
function info(msg) {
  console.log('·', msg)
}

const REVIEW_STATE_RANK = {
  REJECTED: 0,
  UNVERIFIED: 1,
  ESTIMATED: 2,
  VERIFIED: 3,
  HIGH_CONFIDENCE: 4,
}
const VALID_REVIEW_STATES = new Set(Object.keys(REVIEW_STATE_RANK))

// Plausibility bounds
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
            // Only keep warnings for this condition's key
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

// ─── Step 0: Load data ───────────────────────────────────────────────────────
info('Loading data files...')
if (!existsSync(CARREFOUR_PATH)) die(`Carrefour file not found: ${CARREFOUR_PATH}`)
if (!existsSync(NAIVAS_PATH)) die(`Naivas file not found: ${NAIVAS_PATH}`)

const carrefourRaw = JSON.parse(readFileSync(CARREFOUR_PATH, 'utf8'))
const naivasRaw = JSON.parse(readFileSync(NAIVAS_PATH, 'utf8'))
const quickmartRaw = existsSync(QUICKMART_PATH)
  ? JSON.parse(readFileSync(QUICKMART_PATH, 'utf8'))
  : null

info(
  `Loaded Carrefour: ${carrefourRaw.length}, Naivas: ${naivasRaw.length}${quickmartRaw ? `, Quickmart: ${quickmartRaw.length}` : ''}`,
)

// ─── Step 1: Validate each record ────────────────────────────────────────────
info('Validating records...')
const REQUIRED_BLOCKS = [
  'Identity',
  'Classification',
  'Packaging',
  'Nutrition',
  'NutritionProvenance',
  'Validation',
  'Price',
]
const report = { discarded: [], validationErrors: [], deduped: [] }

function validateRecord(p, retailer) {
  const errors = []
  for (const block of REQUIRED_BLOCKS) {
    if (!p[block] || typeof p[block] !== 'object') errors.push(`Missing block: ${block}`)
  }
  if (p.Identity?.Retailer && p.Identity.Retailer !== retailer) {
    errors.push(
      `Identity.Retailer="${p.Identity.Retailer}" does not match file retailer="${retailer}"`,
    )
  }
  const rs = p.Validation?.ReviewState
  if (rs && !VALID_REVIEW_STATES.has(rs)) {
    errors.push(`Invalid ReviewState: ${rs}`)
  }
  errors.push(...plausibilityErrors(p))
  return errors
}

let carrefourValid = [],
  naivasValid = [],
  quickmartValid = []
for (const p of carrefourRaw) {
  const errs = validateRecord(p, 'CARREFOUR')
  if (errs.length) {
    report.validationErrors.push({ id: p.Identity?.ProductID, retailer: 'CARREFOUR', errors: errs })
  } else carrefourValid.push(p)
}
for (const p of naivasRaw) {
  const errs = validateRecord(p, 'NAIVAS')
  if (errs.length) {
    report.validationErrors.push({ id: p.Identity?.ProductID, retailer: 'NAIVAS', errors: errs })
  } else naivasValid.push(p)
}
if (quickmartRaw) {
  for (const p of quickmartRaw) {
    const errs = validateRecord(p, 'QUICKMART')
    if (errs.length) {
      report.validationErrors.push({
        id: p.Identity?.ProductID,
        retailer: 'QUICKMART',
        errors: errs,
      })
    } else quickmartValid.push(p)
  }
}
if (report.validationErrors.length) {
  info(`Validation errors: ${report.validationErrors.length} records skipped`)
}

// ─── Step 2: Deduplicate ─────────────────────────────────────────────────────
info('Deduplicating...')
const EXPECTED_DUPES = new Set(['28347', '28356', '28357', '28358', '28360'])

function dedup(records, retailer) {
  const byId = new Map()
  for (const p of records) {
    const id = String(p.Identity?.ProductID ?? '')
    if (!byId.has(id)) {
      byId.set(id, p)
      continue
    }
    // Conflict: apply tie-break rule
    const existing = byId.get(id)
    const existingRank = REVIEW_STATE_RANK[existing.Validation?.ReviewState] ?? -1
    const challengerRank = REVIEW_STATE_RANK[p.Validation?.ReviewState] ?? -1
    const existingNullCount = Object.values(existing.Nutrition || {}).filter(
      (v) => v == null,
    ).length
    const challengerNullCount = Object.values(p.Nutrition || {}).filter((v) => v == null).length
    const existingUrl = existing.Identity?.RetailerProductUrl ?? ''
    const challengerUrl = p.Identity?.RetailerProductUrl ?? ''

    let winner = existing,
      loser = p
    if (challengerRank > existingRank) {
      winner = p
      loser = existing
    } else if (challengerRank === existingRank) {
      if (challengerNullCount < existingNullCount) {
        winner = p
        loser = existing
      } else if (challengerNullCount === existingNullCount && challengerUrl < existingUrl) {
        winner = p
        loser = existing
      }
    }
    byId.set(id, winner)
    report.deduped.push({
      retailer,
      product_id: id,
      kept: winner.Identity?.RetailerProductUrl,
      discarded: loser.Identity?.RetailerProductUrl,
    })
  }
  return [...byId.values()]
}

carrefourValid = dedup(carrefourValid, 'CARREFOUR')
naivasValid = dedup(naivasValid, 'NAIVAS')
if (quickmartRaw) {
  quickmartValid = dedup(quickmartValid, 'QUICKMART')
}

const dupIds = report.deduped.map((d) => d.product_id)
const unexpectedDups = dupIds.filter((id) => !EXPECTED_DUPES.has(id))
if (unexpectedDups.length) {
  die(`Unexpected duplicates (not in spec): ${unexpectedDups.join(',')}. Aborting.`)
}
if (dupIds.length > 0 && !ALLOW_DEDUPE) {
  die(
    `Found ${dupIds.length} duplicate(s) (${dupIds.join(',')}). Re-run with --allow-dedupe after checking publish-report.json`,
  )
}
info(
  `After dedupe — Carrefour: ${carrefourValid.length}, Naivas: ${naivasValid.length}${quickmartRaw ? `, Quickmart: ${quickmartValid.length}` : ''}`,
)

// ─── Step 3: Count guard ─────────────────────────────────────────────────────
// In dry-run we cannot query the live catalog_releases; skip count guard.
// In commit mode, the Supabase client (below) will compare.
const COUNT_GUARD_ENABLED = COMMIT

// ─── Step 4: Compute hashes and assessments ───────────────────────────────────
info('Computing hashes and assessments...')

const allRows = [
  ...carrefourValid.map((p) => ({
    retailer: 'CARREFOUR',
    product_id: String(p.Identity.ProductID),
    record: p,
  })),
  ...naivasValid.map((p) => ({
    retailer: 'NAIVAS',
    product_id: String(p.Identity.ProductID),
    record: p,
  })),
  ...(quickmartRaw
    ? quickmartValid.map((p) => ({
        retailer: 'QUICKMART',
        product_id: String(p.Identity.ProductID),
        record: p,
      }))
    : []),
]

// Compute record hashes
const productRows = []
const premiumRows = []

for (const row of allRows) {
  const hash = await recordHash(row.record)
  const assessments = computeAssessments(row.record)
  const premHash = await recordHash(assessments)
  productRows.push({
    ...row,
    record_hash: hash,
    review_state: row.record.Validation?.ReviewState ?? null,
  })
  premiumRows.push({
    retailer: row.retailer,
    product_id: row.product_id,
    assessments,
    record_hash: premHash,
  })
}

// Compute catalog hashes
const catalogHash = await computeCatalogHash(
  productRows.map((r) => ({
    retailer: r.retailer,
    product_id: r.product_id,
    record_hash: r.record_hash,
  })),
)
const premiumHash = await computeCatalogHash(
  premiumRows.map((r) => ({
    retailer: r.retailer,
    product_id: r.product_id,
    record_hash: r.record_hash,
  })),
)

info(`catalog_hash: ${catalogHash}`)
info(`premium_hash: ${premiumHash}`)

// ─── Build manifest (unsigned) ────────────────────────────────────────────────
const gitSha = (() => {
  try {
    const { execSync } = require('node:child_process')
    return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  } catch {
    return 'unknown'
  }
})()

// F-21: version must be unique per publish so a same-day hotfix is visible
// to clients that already synced that day (client checks meta.version !== manifest.version).
// nextVersion() uses minute-resolution and appends .N on collision.
const pad = (n) => String(n).padStart(2, '0')
function nextVersion(now, currentVersion) {
  const base = `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
  if (currentVersion !== base && !(currentVersion ?? '').startsWith(base + '.')) return base
  const n = currentVersion === base ? 1 : Number(currentVersion.slice(base.length + 1)) + 1
  return `${base}.${n}`
}
const now = new Date()
// version is resolved in COMMIT mode after we fetch currentRelease (see below).
// In DRY-RUN mode we use a preview label — it is never stored.
const dryRunVersion = `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())}-preview`

const manifest = {
  version: dryRunVersion, // replaced with nextVersion() in COMMIT mode after currentRelease fetch
  scoring_version: 'v4',
  engine_version: typeof gitSha === 'string' ? gitSha : 'unknown',
  min_client_version: '2.0.0',
  max_seq: null, // filled in on commit after DB writes
  counts: {
    CARREFOUR: carrefourValid.length,
    NAIVAS: naivasValid.length,
    ...(quickmartRaw ? { QUICKMART: quickmartValid.length } : {}),
  },
  catalog_hash: catalogHash,
  premium_hash: premiumHash,
  disclaimer:
    'NutriScore grades are for informational purposes only. Consult a healthcare professional for dietary advice.',
}

// ─── Write publish report ─────────────────────────────────────────────────────
const reportPath = join(ROOT, 'publish-report.json')
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      dryRun: !COMMIT,
      timestamp: now.toISOString(),
      counts: manifest.counts,
      deduped: report.deduped,
      validationErrors: report.validationErrors,
      manifest: { ...manifest, max_seq: '(pending)' },
      catalogHash,
      premiumHash,
    },
    null,
    2,
  ),
)
info(`Report written to publish-report.json`)

if (!COMMIT) {
  console.log('')
  console.log('✓ DRY RUN complete — no data written to Supabase.')
  console.log(`  Carrefour products: ${carrefourValid.length}`)
  console.log(`  Naivas products:    ${naivasValid.length}`)
  if (quickmartRaw) {
    console.log(`  Quickmart products: ${quickmartValid.length}`)
  }
  console.log(`  Duplicates found:   ${report.deduped.length} (${dupIds.join(',') || 'none'})`)
  console.log(`  catalog_hash:       ${catalogHash}`)
  console.log(`  premium_hash:       ${premiumHash}`)
  console.log('')
  console.log('  To commit, re-run with: --commit --allow-dedupe')
  process.exit(0)
}

// ─── COMMIT mode ─────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SIGNING_JWK = process.env.CATALOG_SIGNING_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) die('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set', 2)
if (!SIGNING_JWK) die('CATALOG_SIGNING_KEY must be set (JWK JSON string)', 2)

// Verify public key files exist
const catalogPubKeyPath = join(ROOT, 'config/public-keys/catalog.jwks.json')
if (!existsSync(catalogPubKeyPath))
  die('config/public-keys/catalog.jwks.json missing — run scripts/gen-keys.mjs first', 2)

const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Step 3 (commit): Count guard vs. current release
const { data: currentRelease } = await supabase
  .from('catalog_releases')
  .select('manifest')
  .eq('is_current', true)
  .single()

// F-21: resolve the unique version now that we know what is currently published.
manifest.version = nextVersion(now, currentRelease?.manifest?.version ?? null)
info(`Version: ${manifest.version} (previous: ${currentRelease?.manifest?.version ?? 'none'})`)

if (currentRelease && !FORCE_COUNT) {
  const prev = currentRelease.manifest.counts ?? {}
  const retailersToCheck = ['CARREFOUR', 'NAIVAS', ...(quickmartRaw ? ['QUICKMART'] : [])]
  for (const retailer of retailersToCheck) {
    const prevCount = prev[retailer] ?? 0
    const newCount = manifest.counts[retailer] ?? 0
    if (prevCount > 0 && Math.abs(newCount - prevCount) / prevCount > 0.1) {
      die(
        `Count change for ${retailer} exceeds 10%: ${prevCount} → ${newCount}. Use --force-count-change to override.`,
      )
    }
  }
}

// Step 5: Upsert in batches of 500
const BATCH = 500
info(`Upserting ${productRows.length} product rows...`)
for (let i = 0; i < productRows.length; i += BATCH) {
  const batch = productRows.slice(i, i + BATCH).map((r) => ({
    retailer: r.retailer,
    product_id: r.product_id,
    record: r.record,
    record_hash: r.record_hash,
    review_state: r.review_state,
  }))
  const { error } = await supabase.rpc('catalog_upsert', { p_rows: batch })
  if (error) die(`catalog_upsert batch ${i / BATCH + 1} failed: ${error.message}`)
  info(`  Products ${i + 1}–${Math.min(i + BATCH, productRows.length)} upserted`)
}

info(`Upserting ${premiumRows.length} premium rows...`)
for (let i = 0; i < premiumRows.length; i += BATCH) {
  const batch = premiumRows.slice(i, i + BATCH).map((r) => ({
    retailer: r.retailer,
    product_id: r.product_id,
    assessments: r.assessments,
    record_hash: r.record_hash,
  }))
  const { error } = await supabase.rpc('catalog_premium_upsert', { p_rows: batch })
  if (error) die(`catalog_premium_upsert batch ${i / BATCH + 1} failed: ${error.message}`)
  info(`  Premium ${i + 1}–${Math.min(i + BATCH, premiumRows.length)} upserted`)
}

// Tombstone removed rows
const keepCarrefour = carrefourValid.map((p) => String(p.Identity.ProductID))
const keepNaivas = naivasValid.map((p) => String(p.Identity.ProductID))
const { data: tc } = await supabase.rpc('catalog_tombstone_missing', {
  p_retailer: 'CARREFOUR',
  p_keep: keepCarrefour,
})
const { data: tn } = await supabase.rpc('catalog_tombstone_missing', {
  p_retailer: 'NAIVAS',
  p_keep: keepNaivas,
})
info(`Tombstoned: CARREFOUR=${tc}, NAIVAS=${tn}`)
await supabase.rpc('catalog_premium_tombstone_missing', {
  p_retailer: 'CARREFOUR',
  p_keep: keepCarrefour,
})
await supabase.rpc('catalog_premium_tombstone_missing', {
  p_retailer: 'NAIVAS',
  p_keep: keepNaivas,
})

if (quickmartRaw) {
  const keepQuickmart = quickmartValid.map((p) => String(p.Identity.ProductID))
  const { data: tq } = await supabase.rpc('catalog_tombstone_missing', {
    p_retailer: 'QUICKMART',
    p_keep: keepQuickmart,
  })
  info(`Tombstoned: QUICKMART=${tq}`)
  await supabase.rpc('catalog_premium_tombstone_missing', {
    p_retailer: 'QUICKMART',
    p_keep: keepQuickmart,
  })
}

// Get max_seq after writes
const { data: seqData } = await supabase
  .from('catalog_products')
  .select('seq')
  .order('seq', { ascending: false })
  .limit(1)
  .single()
const { data: seqData2 } = await supabase
  .from('catalog_premium')
  .select('seq')
  .order('seq', { ascending: false })
  .limit(1)
  .single()
manifest.max_seq = Math.max(seqData?.seq ?? 0, seqData2?.seq ?? 0)

// Step 6: Verify catalog_hash from DB
// PostgREST returns at most 1000 rows per request by default.
// Paginate to ensure we read ALL rows regardless of catalog size.
// F-22: ORDER BY retailer, product_id makes pagination stable across pages.
// Without an ORDER BY, Postgres gives no guarantee of row order and .range()
// can skip or duplicate rows across page boundaries, causing false hash mismatches.
async function fetchAllRows(table, columns) {
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('deleted', false)
      .order('retailer', { ascending: true })
      .order('product_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) die(`${table} fetch failed: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

info('Verifying catalog_hash from DB...')
const dbProductRows = await fetchAllRows('catalog_products', 'retailer,product_id,record_hash')
const dbPremiumRows = await fetchAllRows('catalog_premium', 'retailer,product_id,record_hash')
info(`DB rows fetched: products=${dbProductRows.length}, premium=${dbPremiumRows.length}`)

const dbCatalogHash = await computeCatalogHash(dbProductRows)
const dbPremiumHash = await computeCatalogHash(dbPremiumRows)

if (dbCatalogHash !== catalogHash)
  die(`catalog_hash mismatch! local=${catalogHash} db=${dbCatalogHash}`)
if (dbPremiumHash !== premiumHash)
  die(`premium_hash mismatch! local=${premiumHash} db=${dbPremiumHash}`)
info('Hashes verified ✓')

// Sign the manifest
const privateJwk = JSON.parse(SIGNING_JWK)
const pubJwks = JSON.parse(readFileSync(catalogPubKeyPath, 'utf8'))
const kid = pubJwks.keys[0]?.kid ?? 'catalog-v1'

const signingKey = await subtle.importKey(
  'jwk',
  privateJwk,
  { name: 'ECDSA', namedCurve: 'P-256' },
  false,
  ['sign'],
)
const manifestBytes = new TextEncoder().encode(stableStringify(manifest))
const sigRaw = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, manifestBytes)
const signature = Buffer.from(sigRaw).toString('base64url')

// Publish
const { data: releaseId, error: pubErr } = await supabase.rpc('catalog_release_publish', {
  p_manifest: manifest,
  p_signature: signature,
  p_key_id: kid,
})
if (pubErr) die(`catalog_release_publish failed: ${pubErr.message}`)
info(`Release published: id=${releaseId}`)

console.log('')
console.log('✓ COMMIT complete.')
console.log(`  Release ID:  ${releaseId}`)
console.log(`  max_seq:     ${manifest.max_seq}`)
console.log(`  catalog_hash: ${catalogHash}`)
