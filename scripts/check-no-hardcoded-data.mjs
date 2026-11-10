#!/usr/bin/env node
/**
 * NutriScore Stage B Guard — No Hardcoded Patient / Clinic Data
 *
 * Scans src/ for banned patterns that must not appear in committed source:
 *   - Patient reference codes (PAT-[0-9]+)
 *   - Real clinic email domains (@knh.or.ke, @akuh.ac.ke)
 *   - Known hospital names (Kenyatta National Hospital, Aga Khan University Hospital)
 *   - Known hospital slug / shortcode (knh-cardio, knh_cardio, AKUH)
 *   - KMPDC licence numbers matching the real format (KMPDC/[0-9]+/[0-9]+)
 *
 * Files allowlisted:
 *   - Markdown docs (*.md) — may reference hospital names in context/planning text
 *   - This script itself — to avoid self-match on ban strings
 *   - DELETION_LEDGER.md and HARDCODED_DATA_LEDGER.md — ledger records are OK
 *
 * Exit 0 = clean; Exit 1 = violations found.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

// Build split-string patterns to avoid this script self-matching its own ban list.
const BANNED_PATTERNS = [
  // Patient reference codes (PAT-XXXX, pat-anon-XXXX)
  { re: /(?:PAT-\d{4,}|pat-anon-\d+)/gi, label: 'patient-ref' },
  // Clinician identifiers
  { re: /usr-(?:dr|diet)-[a-z]+/gi, label: 'clinician-id' },
  // Real Kenyan phone numbers (2547XXXXXXXX)
  { re: /(?:254|\+254)[17]\d{8}/g, label: 'kenya-phone-number' },
  // Real clinic email domains
  { re: /@knh\.or\.ke/gi, label: 'clinic-email(@knh.or.ke)' },
  { re: /@akuh\.ac\.ke/gi, label: 'clinic-email(@akuh.ac.ke)' },
  // Hospital names (split to avoid this script self-matching)
  {
    re: new RegExp(['Kenyatta', 'National', 'Hospital'].join(' '), 'g'),
    label: 'hospital-name(Kenyatta National Hospital)',
  },
  {
    re: new RegExp(['Aga', 'Khan', 'University', 'Hospital'].join(' '), 'g'),
    label: 'hospital-name(Aga Khan University Hospital)',
  },
  // Hospital slug / shortcode
  { re: /knh[-_]cardio/gi, label: 'hospital-slug(knh-cardio)' },
  // KMPDC licence number format: KMPDC/YYYY/NNNNN
  { re: /KMPDC\/\d{4}\/\d+/g, label: 'licence-number(KMPDC/YYYY/NNNNN)' },
]

/** Files / directories to skip entirely */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo'])
const SKIP_EXTENSIONS = new Set([
  '.md',
  '.lock',
  '.png',
  '.jpg',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
])
const SKIP_FILES = new Set([
  resolve(__dirname, 'check-no-hardcoded-data.mjs'),
  resolve(repoRoot, 'docs', 'cleanup', 'DELETION_LEDGER.md'),
  resolve(repoRoot, 'docs', 'cleanup', 'HARDCODED_DATA_LEDGER.md'),
])

function walkDir(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walkDir(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

const srcRoot = join(repoRoot, 'src')
const files = walkDir(srcRoot)

let totalViolations = 0

for (const file of files) {
  if (SKIP_FILES.has(file)) continue
  const ext = file.slice(file.lastIndexOf('.'))
  if (SKIP_EXTENSIONS.has(ext)) continue

  const content = readFileSync(file, 'utf8')
  const lines = content.split('\n')
  const relPath = relative(repoRoot, file)

  for (const { re, label } of BANNED_PATTERNS) {
    re.lastIndex = 0 // reset global regex
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0
      if (re.test(lines[i])) {
        console.error(`[FAIL] ${label} in ${relPath}:${i + 1}`)
        console.error(`       ${lines[i].trim()}`)
        totalViolations++
      }
    }
  }
}

if (totalViolations > 0) {
  console.error(
    `\n[FAIL] ${totalViolations} violation(s) found. Remove hardcoded patient/clinic data before committing.`,
  )
  process.exit(1)
} else {
  console.log('[PASS] No hardcoded patient or clinic-specific data found in src/.')
  process.exit(0)
}
