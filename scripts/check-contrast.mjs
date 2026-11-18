#!/usr/bin/env node
/**
 * scripts/check-contrast.mjs
 *
 * Implements contrast ratio validation and cascade duplication detection
 * according to WCAG 2.2 AA standards and the Phase 1 specifications.
 *
 * Floors:
 *   - Normal text against surface: >= 4.5:1
 *   - Non-text border-control against surface: >= 3.0:1
 *   - Focus ring against surface: >= 3.0:1
 *   - Grade fills against on-colour: >= 4.5:1
 *   - Status text against subtle tint: >= 4.5:1
 *
 * Usage:
 *   node scripts/check-contrast.mjs [--enforce]
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const isEnforce = process.argv.includes('--enforce')

// Helper: convert hex to sRGB luminance
function hexToLuminance(hex) {
  let clean = hex.replace('#', '').trim()
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const r = parseInt(clean.substring(0, 2), 16) / 255
  const g = parseInt(clean.substring(2, 4), 16) / 255
  const b = parseInt(clean.substring(4, 6), 16) / 255

  const toLinear = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const R = toLinear(r)
  const G = toLinear(g)
  const B = toLinear(b)

  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

function contrastRatio(hex1, hex2) {
  const l1 = hexToLuminance(hex1)
  const l2 = hexToLuminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// 1. Detect duplicate custom properties in :root across imported CSS
const indexCssPath = resolve(ROOT, 'src/ui/src/styles/index.css')
const indexCss = readFileSync(indexCssPath, 'utf8')

// Collect imported CSS files in order
const importMatches = indexCss.matchAll(/@import\s+['"]([^'"]+)['"]/g)
const importedFiles = []
for (const m of importMatches) {
  importedFiles.push(resolve(ROOT, 'src/ui/src/styles', m[1]))
}

const rootDeclarations = new Map() // varName -> [{ file, value }]

for (const f of importedFiles) {
  if (!existsSync(f)) continue
  const content = readFileSync(f, 'utf8')
  // Match :root blocks
  const rootBlocks = content.matchAll(/:root\s*\{([^}]+)\}/g)
  for (const block of rootBlocks) {
    const decls = block[1].matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g)
    for (const d of decls) {
      const varName = d[1].trim()
      const val = d[2].trim()
      if (!rootDeclarations.has(varName)) {
        rootDeclarations.set(varName, [])
      }
      rootDeclarations.get(varName).push({
        file: f.replace(ROOT + '/', '').replace(ROOT + '\\', ''),
        value: val,
      })
    }
  }
}

const duplicates = []
for (const [varName, occurrences] of rootDeclarations.entries()) {
  if (occurrences.length > 1) {
    const uniqueValues = new Set(occurrences.map((o) => o.value))
    if (uniqueValues.size > 1) {
      duplicates.push({ varName, occurrences })
    }
  }
}

console.log('========================================================')
console.log('CONTRAST & CASCADE CHECK')
console.log('========================================================\n')

console.log(`--- 1. CASCADE DUPLICATION CHECK ---`)
console.log(`Custom properties declared in :root: ${rootDeclarations.size}`)
console.log(`Properties declared multiple times with conflicting values: ${duplicates.length}`)

if (duplicates.length > 0) {
  console.log('\nTop overridden properties (later imports win):')
  for (const d of duplicates.slice(0, 15)) {
    console.log(`  - ${d.varName.padEnd(25)}:`)
    for (const occ of d.occurrences) {
      console.log(`      ${occ.file}: ${occ.value}`)
    }
  }
  if (duplicates.length > 15) {
    console.log(`  ... and ${duplicates.length - 15} more overridden properties.`)
  }
}

// 2. Contrast evaluation of key pairs
console.log(`\n--- 2. CONTRAST EVALUATION ---`)

const PAIRS = [
  // Light Mode
  { name: 'Light text on canvas', fg: '#234B5A', bg: '#F5F9FA', floor: 4.5 },
  { name: 'Light text-strong on white card', fg: '#073A4B', bg: '#FFFFFF', floor: 4.5 },
  { name: 'Light text-muted on canvas', fg: '#46636F', bg: '#F5F9FA', floor: 4.5 },
  { name: 'Light text-muted on white card', fg: '#46636F', bg: '#FFFFFF', floor: 4.5 },
  { name: 'Light border-control on white card', fg: '#6B8794', bg: '#FFFFFF', floor: 3.0 },
  { name: 'Light focus ring on white card', fg: '#0B6E91', bg: '#FFFFFF', floor: 3.0 },
  // Status Light
  { name: 'Light status success on tint', fg: '#04785A', bg: '#E6FBF4', floor: 4.5 },
  { name: 'Light status critical on tint', fg: '#9F1239', bg: '#FFF1F4', floor: 4.5 },
  { name: 'Light status warning on tint', fg: '#9A3412', bg: '#FFF0EA', floor: 4.5 },
  { name: 'Light status info on tint', fg: '#0A5A77', bg: '#E5F4F9', floor: 4.5 },
  // Dark Mode
  { name: 'Dark text on dark canvas', fg: '#CCE2E8', bg: '#04222D', floor: 4.5 },
  { name: 'Dark text-strong on dark surface', fg: '#E6F2F5', bg: '#072C3A', floor: 4.5 },
  { name: 'Dark text-muted on dark canvas', fg: '#A9C3CC', bg: '#04222D', floor: 4.5 },
  { name: 'Dark border-control on dark surface', fg: '#5E8190', bg: '#072C3A', floor: 3.0 },
  { name: 'Dark focus ring on dark surface', fg: '#6CC6E3', bg: '#072C3A', floor: 3.0 },
  // NutriScore Grades
  { name: 'Grade A on-colour (white on green)', fg: '#FFFFFF', bg: '#038141', floor: 4.5 },
  { name: 'Grade B on-colour (--ns-on-grade-b on B)', fg: '#14320A', bg: '#85BB2F', floor: 4.5 },
  {
    name: 'Grade B (Legacy white text on B) [AUDIT FAIL]',
    fg: '#FFFFFF',
    bg: '#85BB2F',
    floor: 4.5,
  },
  { name: 'Grade C on-colour (dark text on C)', fg: '#3A2E00', bg: '#FECB02', floor: 4.5 },
  {
    name: 'Grade C (Sidepanel white text on C) [AUDIT FAIL]',
    fg: '#FFFFFF',
    bg: '#FECB02',
    floor: 4.5,
  },
  { name: 'Grade D on-colour (--ns-on-grade-d on D)', fg: '#331C00', bg: '#EE8100', floor: 4.5 },
  {
    name: 'Grade D (Legacy white text on D) [AUDIT FAIL]',
    fg: '#FFFFFF',
    bg: '#EE8100',
    floor: 4.5,
  },
]

console.log(
  '| Pair                                            | Measured Ratio | Required Floor | Result |',
)
console.log(
  '|-------------------------------------------------|----------------|----------------|--------|',
)

let contrastFails = 0
for (const p of PAIRS) {
  const ratio = Number(contrastRatio(p.fg, p.bg).toFixed(2))
  const passed = ratio >= p.floor
  if (!passed) contrastFails++
  console.log(
    `| ${p.name.padEnd(47)} | ${(ratio + ':1').padEnd(14)} | ${(p.floor + ':1').padEnd(14)} | ${(passed ? 'PASS' : 'FAIL').padEnd(6)} |`,
  )
}

console.log('\n--------------------------------------------------------')
if ((duplicates.length > 0 || contrastFails > 0) && isEnforce) {
  console.error(
    `[FAIL] Contrast & cascade validation failed (${duplicates.length} duplicate overrides, ${contrastFails} contrast fails).`,
  )
  process.exit(1)
} else {
  console.log(
    `[REPORT ONLY] Contrast analysis complete (${duplicates.length} duplicate overrides detected in :root).`,
  )
}
