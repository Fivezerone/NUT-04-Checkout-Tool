#!/usr/bin/env node
/**
 * NutriScore CI Guard — No Placeholders or Local Endpoints in dist/
 *
 * Verifies that the dist/ build output does not contain:
 *   1. Unreplaced environment placeholders (__VITE_*)
 *   2. Hardcoded local IP endpoints (127.0.0.1)
 *   3. Localhost references (localhost)
 *   4. Sandbox / test domains (sandbox.safaricom)
 *
 * This guards against development configurations or un-injected env vars
 * leaking into distributed Chrome extension or production artifacts.
 *
 * Exit 0 = clean (or dist/ absent); Exit 1 = violations found.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const distRoot = join(repoRoot, 'dist')

if (!existsSync(distRoot)) {
  console.warn('[WARN] dist/ directory not found — skipping check-dist check (run build first).')
  process.exit(0)
}

const BANNED_PATTERNS = [
  { pattern: '__VITE_', label: 'unreplaced-vite-placeholder(__VITE_)' },
  { pattern: '127.0.0.1', label: 'hardcoded-loopback-ip(127.0.0.1)' },
  { pattern: 'localhost', label: 'localhost-endpoint(localhost)' },
  { pattern: 'sandbox.safaricom', label: 'sandbox-domain(sandbox.safaricom)' },
]

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.zip',
  '.tar',
  '.gz',
])

function walkDir(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walkDir(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

const files = walkDir(distRoot)
let totalViolations = 0

for (const file of files) {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  if (BINARY_EXTENSIONS.has(ext)) continue

  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  const lines = content.split('\n')
  const relPath = relative(repoRoot, file).replace(/\\/g, '/')

  for (const { pattern, label } of BANNED_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) {
        console.error(`[FAIL] ${label} in ${relPath}:${i + 1}`)
        totalViolations++
      }
    }
  }
}

if (totalViolations > 0) {
  console.error(`\n[check-dist] Total violations found: ${totalViolations}`)
  process.exit(1)
} else {
  console.log('[check-dist] OK — dist/ is clean of placeholders and local endpoints.')
  process.exit(0)
}
