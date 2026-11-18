#!/usr/bin/env node
/**
 * scripts/check-budget.mjs
 *
 * Implements Appendix B: Eager Gzip Payload Budget Checker.
 * Measures static entry payload (HTML + statically linked JS & CSS, gzipped at level 9)
 * against the agreed institutional budgets:
 *   - Popup:      <= 40 KB
 *   - Side panel: <= 60 KB
 *   - Dashboard:  <= 70 KB
 *   - CAD:        <= 110 KB
 *   - Options:    Report only
 *
 * Usage:
 *   node scripts/check-budget.mjs [--enforce]
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const isEnforce = process.argv.includes('--enforce')

const BUDGETS_KB = {
  popup: 40,
  sidepanel: 60,
  dashboard: 70,
  cad: 110,
}

const ENTRIES = [
  {
    name: 'popup',
    html: resolve(ROOT, 'dist/extension/popup.html'),
    dir: resolve(ROOT, 'dist/extension'),
  },
  {
    name: 'sidepanel',
    html: resolve(ROOT, 'dist/extension/sidepanel.html'),
    dir: resolve(ROOT, 'dist/extension'),
  },
  {
    name: 'dashboard',
    html: resolve(ROOT, 'dist/extension/dashboard.html'),
    dir: resolve(ROOT, 'dist/extension'),
  },
  {
    name: 'options',
    html: resolve(ROOT, 'dist/extension/options.html'),
    dir: resolve(ROOT, 'dist/extension'),
  },
  { name: 'cad', html: resolve(ROOT, 'dist-ui/cad/index.html'), dir: resolve(ROOT, 'dist-ui/cad') },
]

function getGzipSize(filePath) {
  if (!existsSync(filePath)) return 0
  const buffer = readFileSync(filePath)
  return gzipSync(buffer, { level: 9 }).length
}

// Simple JS static import follower
function findStaticImports(jsPath, baseDir, visited = new Set()) {
  if (!existsSync(jsPath) || visited.has(jsPath)) return visited
  visited.add(jsPath)

  const content = readFileSync(jsPath, 'utf8')
  // Match static ES imports: e.g. import ... from "./asset-xxx.js" or import "./asset-xxx.js"
  const importMatches = content.matchAll(
    /(?:import|export)\s*(?:[^'"]*from\s*)?['"](\.[^'"]+\.js)['"]/g,
  )
  for (const match of importMatches) {
    const rel = match[1]
    const resolved = resolve(dirname(jsPath), rel)
    findStaticImports(resolved, baseDir, visited)
  }
  return visited
}

console.log('========================================================')
console.log('EAGER GZIP PAYLOAD BUDGET CHECK (Appendix B)')
console.log('========================================================\n')

let anyFailed = false
const results = []

for (const entry of ENTRIES) {
  if (!existsSync(entry.html)) {
    console.warn(`[WARN] HTML entry not found: ${entry.html}`)
    continue
  }

  const htmlContent = readFileSync(entry.html, 'utf8')
  const entryFiles = new Set()

  // Find linked scripts and stylesheets
  const scriptMatches = htmlContent.matchAll(
    /src=["'](\.[^'"]+|\/[^'"]+|[a-zA-Z0-9_./-]+\.js)["']/g,
  )
  for (const m of scriptMatches) {
    let p = m[1]
    if (p.startsWith('/')) p = '.' + p
    const full = resolve(entry.dir, p)
    if (existsSync(full)) {
      findStaticImports(full, entry.dir, entryFiles)
    }
  }

  const cssMatches = htmlContent.matchAll(/href=["'](\.[^'"]+|\/[^'"]+|[a-zA-Z0-9_./-]+\.css)["']/g)
  for (const m of cssMatches) {
    let p = m[1]
    if (p.startsWith('/')) p = '.' + p
    const full = resolve(entry.dir, p)
    if (existsSync(full)) {
      entryFiles.add(full)
    }
  }

  // Calculate total gzip size including HTML
  let totalBytes = getGzipSize(entry.html)
  for (const f of entryFiles) {
    totalBytes += getGzipSize(f)
  }

  const totalKb = Number((totalBytes / 1024).toFixed(2))
  const budget = BUDGETS_KB[entry.name]
  const passed = budget ? totalKb <= budget : true

  if (budget && !passed) {
    anyFailed = true
  }

  results.push({
    name: entry.name,
    sizeKb: totalKb,
    budgetKb: budget || 'none',
    status: budget ? (passed ? 'PASS' : 'FAIL') : 'REPORT',
    files: [entry.html, ...entryFiles].map((f) =>
      f.replace(ROOT + '/', '').replace(ROOT + '\\', ''),
    ),
  })
}

console.log('| Surface     | Measured (KB gz) | Budget (KB gz) | Status  |')
console.log('|-------------|-------------------|----------------|---------|')
for (const r of results) {
  console.log(
    `| ${r.name.padEnd(11)} | ${String(r.sizeKb).padEnd(17)} | ${String(r.budgetKb).padEnd(14)} | ${r.status.padEnd(7)} |`,
  )
}

console.log('\n--------------------------------------------------------')
if (anyFailed && isEnforce) {
  console.error('[FAIL] One or more surfaces exceeded their eager gzip budget.')
  process.exit(1)
} else {
  console.log(
    `[PASS] Budget report generated.${isEnforce ? ' All active budgets passed.' : ' (Enforcement disabled)'}`,
  )
}
