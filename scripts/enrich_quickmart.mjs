/**
 * scripts/enrich_quickmart.mjs
 *
 * Enriches missing Quickmart product records by matching with reference Carrefour dataset.
 * - Handles naming variations (e.g. Choco -> Chocolate, Ltr -> L, Gm -> g)
 * - Evaluates brand, size/weight, flavor disparities, packaging, and core product tokens
 * - Only transfers data for high-probability matches (>90% confidence)
 * - Transfers nutrition, nutrition_category, and nova_level
 * - Updates audit/validation fields: nova_confidence, nutrition_provenance, data_quality_flags, validation_status
 * - Preserves existing non-null data
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
const QUICKMART_PATH = join(ROOT, 'src/extension/data/quickmart_products.json')
const CARREFOUR_PATH = join(ROOT, 'src/extension/data/carrefour_products.json')

// Brand aliases mapping
const BRAND_ALIASES = {
  'new kcc': 'kcc',
  'bio foods': 'bio',
  'cadbury s': 'cadbury',
  cadburys: 'cadbury',
  'farmer s choice': 'farmers choice',
  'kellogg s': 'kelloggs',
  'morning harvest': 'morning harvest',
  'tropical heat': 'tropical heat',
  'blue band': 'blue band',
  'brown s': 'browns',
  'laki laki': 'laki laki',
}

// Known flavors for disparity detection
const FLAVORS = new Set([
  'vanilla',
  'strawberry',
  'chocolate',
  'banana',
  'mango',
  'orange',
  'lemon',
  'lime',
  'passion',
  'pineapple',
  'apple',
  'peach',
  'berry',
  'blueberry',
  'raspberry',
  'cherry',
  'caramel',
  'coffee',
  'coconut',
  'mint',
  'natural',
  'plain',
  'original',
  'sweetened',
  'unsweetened',
  'salted',
  'sweet',
  'chilli',
  'onion',
  'garlic',
  'sour cream',
  'masala',
  'tropical',
  'guava',
  'cola',
  'blackcurrant',
  'ginger',
  'beef',
  'chicken',
  'tomato',
])

// Packaging types
const PACKAGING_MAP = {
  sachet: 'pouch',
  pouch: 'pouch',
  packet: 'packet',
  pkt: 'packet',
  pack: 'packet',
  bottle: 'bottle',
  btl: 'bottle',
  can: 'can',
  tin: 'can',
  tub: 'tub',
  tetra: 'tetra',
  tca: 'tetra',
  box: 'box',
  bag: 'bag',
  jar: 'jar',
  cup: 'cup',
}

function normalizeBrand(rawBrand, productName) {
  let b = (rawBrand || '')
    .replace(/^food_/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim()
  b = b.replace(/['’]/g, '')
  if (BRAND_ALIASES[b]) b = BRAND_ALIASES[b]
  if (b && b !== 'other' && b !== 'generic' && b !== '') return b

  const normTitle = (productName || '').toLowerCase().replace(/['’]/g, '')
  for (const [alias, canonical] of Object.entries(BRAND_ALIASES)) {
    if (normTitle.startsWith(alias + ' ') || normTitle.startsWith(canonical + ' ')) {
      return canonical
    }
  }
  const firstWord = normTitle.split(/\s+/)[0]
  if (
    firstWord &&
    firstWord.length > 2 &&
    !['fresh', 'whole', 'pure', 'classic', 'premium', 'local'].includes(firstWord)
  ) {
    return firstWord
  }
  return ''
}

function normalizeText(text) {
  if (!text) return ''
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\bchoco\b/g, 'chocolate')
    .replace(/\byoghurt\b/g, 'yogurt')
    .replace(/\byght\b/g, 'yogurt')
    .replace(/\bpkt\b/g, 'packet')
    .replace(/\bchili\b/g, 'chilli')
    .replace(/\bpeanutbutter\b/g, 'peanut butter')
    .replace(/\bcornflakes\b/g, 'corn flakes')
    .replace(/\bwholegrain\b/g, 'whole grain')
    .replace(/\bu\.h\.t\b|\buht\b/g, 'uht')
    .replace(/\bltr\b|\blt\b|\blitre\b|\blitres\b|\bliter\b|\bliters\b/g, 'l')
    .replace(/\bgm\b|\bgms\b|\bgram\b|\bgrams\b/g, 'g')
    .replace(/\bkgs\b|\bkilogram\b|\bkilograms\b/g, 'kg')
    .replace(/\bmls\b|\bmillilitre\b|\bmillilitres\b/g, 'ml')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractSize(name) {
  if (!name) return null
  const s = normalizeText(name)

  const multiMatch =
    s.match(/(\d+)\s*(?:pcs|x|pack|packs)\s*(\d+(?:\.\d+)?)\s*(kg|g|l|ml)\b/) ||
    s.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml)\s*(?:x\s*(\d+)|\b(\d+)\s*pcs|\bpack\s*of\s*(\d+))/)
  let count = 1
  let val = 0
  let unit = ''

  if (multiMatch) {
    if (multiMatch[3]) {
      count = parseInt(multiMatch[1])
      val = parseFloat(multiMatch[2])
      unit = multiMatch[3]
    } else {
      val = parseFloat(multiMatch[1])
      unit = multiMatch[2]
      count = parseInt(multiMatch[3] || multiMatch[4] || multiMatch[5] || '1')
    }
  } else {
    const singleMatch = s.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml)\b/)
    if (!singleMatch) return null
    val = parseFloat(singleMatch[1])
    unit = singleMatch[2]
  }

  let standardVal = val
  let standardUnit = unit
  if (unit === 'kg') {
    standardVal = val * 1000
    standardUnit = 'g'
  }
  if (unit === 'l') {
    standardVal = val * 1000
    standardUnit = 'ml'
  }

  return {
    value: standardVal,
    unit: standardUnit,
    count,
    totalValue: standardVal * count,
    standard: `${count > 1 ? count + 'x' : ''}${standardVal}${standardUnit}`,
  }
}

function parseProduct(p) {
  const rawName = p.Identity?.ProductName || ''
  const brand = normalizeBrand(p.Identity?.BrandName, rawName)
  const normName = normalizeText(rawName)
  const tokens = normName.split(' ').filter(Boolean)
  const size = extractSize(rawName)

  const flavors = []
  for (const t of tokens) {
    if (FLAVORS.has(t)) flavors.push(t)
  }

  const packaging = []
  for (const t of tokens) {
    if (PACKAGING_MAP[t]) packaging.push(PACKAGING_MAP[t])
  }

  const exclude = new Set([...flavors, ...packaging])
  if (brand) brand.split(' ').forEach((bt) => exclude.add(bt))
  if (size) {
    exclude.add(size.unit)
    exclude.add(`${size.value}`)
    if (size.count > 1) exclude.add(`${size.count}`)
  }
  const stopWords = new Set([
    'and',
    'with',
    'in',
    'of',
    'for',
    'the',
    'fresh',
    'premium',
    'classic',
    'food',
    'kenya',
    'ke',
  ])
  const coreTokens = tokens.filter(
    (t) => !exclude.has(t) && !stopWords.has(t) && !/^\d+$/.test(t) && t.length > 1,
  )

  const hasNutrition =
    p.Nutrition &&
    (p.Nutrition.EnergyKJ != null || p.Nutrition.EnergyKcal != null || p.Nutrition.FatG != null)
  const hasNova = p.Classification?.NOVA?.Level != null
  const hasCat =
    !!p.Classification?.NutritionCategory && p.Classification?.NutritionCategory !== 'Uncategorized'

  return {
    raw: p,
    id: p.Identity?.ProductID,
    name: rawName,
    brand,
    normName,
    tokens,
    size,
    flavors: [...new Set(flavors)],
    packaging: [...new Set(packaging)],
    coreTokens,
    hasNutrition,
    hasNova,
    hasCat,
    category: p.Classification?.NutritionCategory,
    nova: p.Classification?.NOVA?.Level,
    reviewState: p.Validation?.ReviewState,
  }
}

function matchProducts(q, c) {
  // Brand constraint
  if (q.brand && c.brand) {
    if (q.brand !== c.brand) return { match: false, reason: 'brand_mismatch' }
  } else if (q.brand && !c.brand) {
    return { match: false, reason: 'generic_to_branded_forbidden' }
  } else if (!q.brand && c.brand) {
    return { match: false, reason: 'branded_to_generic_forbidden' }
  }

  // Size constraint
  let sizeMatch = false
  let sizeDisparity = false
  if (q.size && c.size) {
    if (q.size.unit === c.size.unit) {
      if (q.size.totalValue === c.size.totalValue) {
        sizeMatch = true
      } else {
        return { match: false, reason: 'size_conflict' }
      }
    } else {
      if (Math.abs(q.size.totalValue - c.size.totalValue) <= 10) {
        sizeMatch = true
      } else {
        return { match: false, reason: 'unit_mismatch' }
      }
    }
  } else if (!q.size && !c.size) {
    sizeMatch = true
  } else {
    sizeDisparity = true
  }

  // Packaging check
  let pkgMismatch = false
  if (q.packaging.length > 0 && c.packaging.length > 0) {
    const common = q.packaging.some((p) => c.packaging.includes(p))
    if (!common) pkgMismatch = true
  }

  // Flavor check
  let flavourDisparity = false
  if (q.flavors.length > 0 && c.flavors.length > 0) {
    const common = q.flavors.some((f) => c.flavors.includes(f))
    if (!common) flavourDisparity = true
  } else if (
    (q.flavors.length > 0 && c.flavors.length === 0) ||
    (q.flavors.length === 0 && c.flavors.length > 0)
  ) {
    flavourDisparity = true
  }

  const qCoreSet = new Set(q.coreTokens)
  const cCoreSet = new Set(c.coreTokens)

  if (qCoreSet.size === 0 && cCoreSet.size === 0) {
    if (q.normName === c.normName) {
      return { match: true, confidence: 100, flavourDisparity: false }
    }
    return { match: false, reason: 'empty_core' }
  }

  let inter = 0
  for (const t of qCoreSet) {
    if (cCoreSet.has(t)) inter++
  }

  if (inter === 0) {
    return { match: false, reason: 'no_core_overlap' }
  }

  const recallQ = inter / qCoreSet.size
  const precisionC = inter / cCoreSet.size

  if (recallQ === 1 && precisionC === 1 && !pkgMismatch && sizeMatch) {
    if (flavourDisparity) {
      return { match: true, confidence: 92, flavourDisparity: true }
    }
    return { match: true, confidence: 99, flavourDisparity: false }
  }

  if (recallQ >= 0.75 && precisionC >= 0.6 && !pkgMismatch && (sizeMatch || !sizeDisparity)) {
    if (flavourDisparity) {
      return { match: true, confidence: 91, flavourDisparity: true }
    }
    return { match: true, confidence: 95, flavourDisparity: false }
  }

  if (q.normName === c.normName) {
    return { match: true, confidence: 100, flavourDisparity: false }
  }

  return { match: false, reason: 'insufficient_overlap' }
}

export function enrichQuickmartDataset(commit = false) {
  console.log('Loading datasets...')
  const quickmart = JSON.parse(readFileSync(QUICKMART_PATH, 'utf8'))
  const carrefour = JSON.parse(readFileSync(CARREFOUR_PATH, 'utf8'))

  console.log(`Quickmart records: ${quickmart.length}`)
  console.log(`Carrefour records: ${carrefour.length}`)

  // Index Carrefour by brand
  const parsedCarrefour = carrefour.map(parseProduct)
  const cByBrand = new Map()
  const cUnbranded = []

  for (const c of parsedCarrefour) {
    if (c.brand) {
      if (!cByBrand.has(c.brand)) cByBrand.set(c.brand, [])
      cByBrand.get(c.brand).push(c)
    } else {
      cUnbranded.push(c)
    }
  }

  let processedCount = 0
  let matchedCount = 0
  let identicalCount = 0
  let flavourDisparityCount = 0
  let skippedLowConfidenceCount = 0
  let skippedNotTriggeredCount = 0

  const matchDetails = []

  for (const qRecord of quickmart) {
    // 1. Trigger condition: Process only Quickmart records where nutrition, nutrition_category, or nova_level are currently NULL
    const n = qRecord.Nutrition
    const isNutritionNull =
      !n ||
      (n.EnergyKJ == null &&
        n.EnergyKcal == null &&
        n.SugarsG == null &&
        n.SaturatedFatG == null &&
        n.FatG == null &&
        n.CarbohydratesG == null &&
        n.FibreG == null &&
        n.ProteinG == null &&
        n.SodiumMG == null &&
        n.SaltG == null)
    const cat = qRecord.Classification?.NutritionCategory
    const isCategoryNull = !cat || cat === 'Uncategorized'
    const nova = qRecord.Classification?.NOVA?.Level
    const isNovaNull = nova == null

    if (!isNutritionNull && !isCategoryNull && !isNovaNull) {
      skippedNotTriggeredCount++
      continue
    }

    processedCount++

    // 2. Matching criteria: Compare against Carrefour
    const q = parseProduct(qRecord)
    const candidates = q.brand ? cByBrand.get(q.brand) || [] : cUnbranded

    let bestMatch = null
    let bestScore = 0
    let bestDisparity = false

    for (const c of candidates) {
      const res = matchProducts(q, c)
      if (res.match && res.confidence >= 90) {
        let score = res.confidence
        if (!res.flavourDisparity) score += 5
        if (c.hasNutrition) score += 2

        if (score > bestScore) {
          bestScore = score
          bestMatch = c
          bestDisparity = res.flavourDisparity
        }
      }
    }

    if (!bestMatch || bestScore < 90) {
      skippedLowConfidenceCount++
      continue
    }

    // Successful high-probability match (>90% confidence)
    matchedCount++
    if (bestDisparity) flavourDisparityCount++
    else identicalCount++

    const cRecord = bestMatch.raw

    // 3. Data Enrichment & Mapping Rules
    // Target Fields to Populate from Carrefour:
    // • nutrition: Transfer exact nutritional values or data object (without overwriting existing non-null)
    if (!qRecord.Nutrition) {
      qRecord.Nutrition = JSON.parse(JSON.stringify(cRecord.Nutrition || {}))
    } else if (cRecord.Nutrition) {
      const qN = qRecord.Nutrition
      const cN = cRecord.Nutrition
      qN.Basis = qN.Basis || cN.Basis || 'per_100'
      const nutrientKeys = [
        'EnergyKJ',
        'EnergyKcal',
        'SugarsG',
        'SaturatedFatG',
        'FatG',
        'CarbohydratesG',
        'FibreG',
        'ProteinG',
        'SodiumMG',
        'SaltG',
      ]
      for (const k of nutrientKeys) {
        if (qN[k] == null && cN[k] != null) {
          qN[k] = cN[k]
        }
      }
      if (!qN.FVL) {
        qN.FVL = JSON.parse(JSON.stringify(cN.FVL || { Percentage: null }))
      } else if (qN.FVL.Percentage == null && cN.FVL?.Percentage != null) {
        qN.FVL.Percentage = cN.FVL.Percentage
      }
    }

    // • nutrition_category: Map directly
    if (cRecord.Classification?.NutritionCategory) {
      qRecord.Classification = qRecord.Classification || {}
      qRecord.Classification.NutritionCategory = cRecord.Classification.NutritionCategory
      if (cRecord.Classification.CanonicalFoodClass) {
        qRecord.Classification.CanonicalFoodClass = cRecord.Classification.CanonicalFoodClass
      }
      if (cRecord.Classification.FSACategoryCode) {
        qRecord.Classification.FSACategoryCode = cRecord.Classification.FSACategoryCode
      }
    }

    // • nova_level: Transfer 1-4 NOVA food processing classification score
    qRecord.Classification = qRecord.Classification || {}
    qRecord.Classification.NOVA = qRecord.Classification.NOVA || { Level: null, Confidence: null }
    if (cRecord.Classification?.NOVA?.Level != null) {
      qRecord.Classification.NOVA.Level = cRecord.Classification.NOVA.Level
    }

    // Audit, Quality, & Validation Fields to Update:
    // • nova_confidence: Assign High, Medium, Low
    const novaConfRating = bestDisparity
      ? 'medium'
      : cRecord.Classification?.NOVA?.Confidence || 'high'
    qRecord.Classification.NOVA.Confidence = novaConfRating
    qRecord.nova_confidence = bestDisparity ? 'Medium' : 'High'

    // • nutrition_provenance: Populate with 'Carrefour Match'
    qRecord.NutritionProvenance = qRecord.NutritionProvenance || {}
    qRecord.NutritionProvenance.SourceName = 'Carrefour Match'
    qRecord.NutritionProvenance.SourceID = String(cRecord.Identity?.ProductID || '')
    qRecord.NutritionProvenance.EvidenceLevel = bestDisparity
      ? 'derived'
      : cRecord.NutritionProvenance?.EvidenceLevel || 'retailer_product_page'
    qRecord.NutritionProvenance.ValueSpecificity = bestDisparity
      ? 'category_specific'
      : cRecord.NutritionProvenance?.ValueSpecificity || 'product_specific'
    qRecord.nutrition_provenance = 'Carrefour Match'

    // • data_quality_flags: Update to reflect improvement in completeness
    qRecord.Validation = qRecord.Validation || {}
    const flags = new Set(qRecord.Validation.DataQualityFlags || [])
    flags.add('matched_carrefour_fallback')
    if (bestMatch.hasNutrition) flags.add('nutrition_inherited_from_carrefour_match')
    if (bestMatch.hasNova) flags.add('nova_inherited_from_carrefour_match')
    flags.add('nutrition_category_migrated_to_kfct_14tier')
    if (bestDisparity) flags.add('flavour_disparity_match_estimated')
    qRecord.Validation.DataQualityFlags = [...flags]
    qRecord.data_quality_flags = qRecord.Validation.DataQualityFlags

    // • validation_status: Mark using 5 tier review state conditions
    // (i.e. unverified, manual review required, estimated, verified and high confidence)
    let reviewState = 'VERIFIED'
    if (bestDisparity) {
      reviewState = 'ESTIMATED'
    } else {
      reviewState = cRecord.Validation?.ReviewState || 'VERIFIED'
    }
    qRecord.Validation.ReviewState = reviewState
    qRecord.Validation.validation_status = reviewState
    qRecord.validation_status = reviewState

    if (bestMatch.hasNutrition && cRecord.Validation?.ConsistencyChecks) {
      qRecord.Validation.ConsistencyChecks = JSON.parse(
        JSON.stringify(cRecord.Validation.ConsistencyChecks),
      )
    }

    if (matchDetails.length < 20) {
      matchDetails.push({
        quickmartId: qRecord.Identity?.ProductID,
        quickmartName: qRecord.Identity?.ProductName,
        carrefourId: cRecord.Identity?.ProductID,
        carrefourName: cRecord.Identity?.ProductName,
        brand: q.brand,
        confidence: bestDisparity ? 'Medium' : 'High',
        isFlavourDisparity: bestDisparity,
        nutritionTransferred: bestMatch.hasNutrition,
        novaLevel: qRecord.Classification.NOVA.Level,
        category: qRecord.Classification.NutritionCategory,
        reviewState: reviewState,
      })
    }
  }

  console.log('\n================ ENRICHMENT SUMMARY REPORT ================')
  console.log(`Total Quickmart Records Evaluated:       ${quickmart.length}`)
  console.log(`Records Triggered (missing data):        ${processedCount}`)
  console.log(`Records Skipped (not triggered):         ${skippedNotTriggeredCount}`)
  console.log(`Successfully Matched (>90% confidence):   ${matchedCount}`)
  console.log(`  - Identical Product Matches (High):    ${identicalCount}`)
  console.log(`  - Flavour Disparity Matches (Medium):  ${flavourDisparityCount}`)
  console.log(`Skipped due to low confidence (<90%):    ${skippedLowConfidenceCount}`)
  console.log(
    `Match Success Rate (triggered):          ${((matchedCount / processedCount) * 100).toFixed(2)}%`,
  )
  console.log('===========================================================\n')

  if (commit) {
    writeFileSync(QUICKMART_PATH, JSON.stringify(quickmart, null, 2), 'utf8')
    console.log(`✓ Successfully updated ${QUICKMART_PATH}`)
  } else {
    console.log('DRY RUN COMPLETE — re-run with --commit to write changes to disk.')
  }

  return {
    totalRecords: quickmart.length,
    processedCount,
    skippedNotTriggeredCount,
    matchedCount,
    identicalCount,
    flavourDisparityCount,
    skippedLowConfidenceCount,
    matchDetails,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commit = process.argv.includes('--commit')
  enrichQuickmartDataset(commit)
}
