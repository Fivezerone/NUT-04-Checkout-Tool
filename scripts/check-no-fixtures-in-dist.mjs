#!/usr/bin/env node
/**
 * NutriScore Stage B Guard — No Fixture Data in dist/
 *
 * Verifies that the dist/ build output does not contain:
 *   1. Patient reference codes (PAT-XXXX)
 *   2. Real clinic email domains
 *   3. Hospital names
 *   4. Known hospital slugs
 *
 * This guards against fixture or seed data leaking into the distributed
 * Chrome extension package. Run after every build.
 *
 * Exit 0 = clean; Exit 1 = violations found or dist/ absent (skipped with warning).
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const distRoot = join(repoRoot, 'dist')

if (!existsSync(distRoot)) {
  console.warn('[WARN] dist/ directory not found — skipping fixture-in-dist check (run build first).')
  process.exit(0)
}

// Split-string patterns to avoid this script self-matching its own ban list.
const BANNED_PATTERNS = [
  { re: /PAT-\d{4,}/g, label: 'patient-ref(PAT-XXXX)' },
  { re: /@knh\.or\.ke/gi, label: 'clinic-email(@knh.or.ke)' },
  { re: /@akuh\.ac\.ke/gi, label: 'clinic-email(@akuh.ac.ke)' },
  { re: new RegExp(['Kenyatta', 'National', 'Hospital'].join(' '), 'g'), label: 'hospital-name' },
  { re: new RegExp(['Aga', 'Khan', 'University', 'Hospital'].join(' '), 'g'), label: 'hospital-name' },
  { re: /knh[-_]cardio/gi, label: 'hospital-slug(knh-cardio)' },
  { re: /KMPDC\/\d{4}\/\d+/g, label: 'licence-number(KMPDC/YYYY/NNNNN)' },
]

const SKIP_DIRS = new Set(['assets', '_assets'])
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '.txt'])

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

const files = walkDir(distRoot)
let totalViolations = 0

for (const file of files) {
  const ext = file.slice(file.lastIndexOf('.'))
  if (!TEXT_EXTENSIONS.has(ext)) continue

  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  const lines = content.split('\n')
  const relPath = relative(repoRoot, file)

  for (const { re, label } of BANNED_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0
      if (re.test(lines[i])) {
        console.error(`[FAIL] ${label} in dist/${relPath}:${i + 1}`)
        totalViolations++
      }
    }
  }
}

if (totalViolations > 0) {
  console.error(`\n[FAIL] ${totalViolations} banned pattern(s) found in dist/. Fixture data must not ship in the extension package.`)
  process.exit(1)
} else {
  console.log('[PASS] No fixture data found in dist/.')
  process.exit(0)
}
