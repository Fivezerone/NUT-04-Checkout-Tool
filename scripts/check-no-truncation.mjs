#!/usr/bin/env node
/**
 * scripts/check-no-truncation.mjs
 *
 * Scans src/ and dist-ui/ for CSS truncation utilities (truncate, text-ellipsis).
 * Enforces NUT-04 design principle (§5.3 / D-32): clinical thresholds, patient
 * names, nutrients, and financial metrics must wrap or use accessible tooltips.
 * Only opaque hashes, IDs, and token strings (explicitly styled or annotated)
 * are permitted to truncate.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

const SCAN_DIRS = ['src']
if (existsSync(resolve(rootDir, 'dist-ui'))) {
  SCAN_DIRS.push('dist-ui')
}

const EXTENSIONS = new Set(['.tsx', '.jsx', '.html', '.vue', '.svelte'])

// Whitelist patterns for elements permitted to truncate (opaque IDs, transaction hashes, token digests)
const ALLOWED_CONTEXT_PATTERNS = [
  /hash/i,
  /uuid/i,
  /digest/i,
  /txid/i,
  /trace_id/i,
  /token/i,
  /font-mono/,
  /overflow-wrap:\s*anywhere/,
  /data-allow-truncate/,
]

const TRUNCATE_REGEX = /\b(truncate|text-ellipsis)\b/

let violationCount = 0

function scanFile(filePath) {
  let content
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (err) {
    return
  }

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (TRUNCATE_REGEX.test(line)) {
      // Check surrounding context (current line plus previous 2 lines)
      const context = lines.slice(Math.max(0, i - 2), i + 3).join(' ')
      const isAllowed = ALLOWED_CONTEXT_PATTERNS.some((pat) => pat.test(context))

      if (!isAllowed) {
        const relPath = relative(rootDir, filePath).replace(/\\/g, '/')
        console.error(
          `\x1b[31m[TRUNCATION VIOLATION]\x1b[0m ${relPath}:${i + 1} uses truncation on a non-hash element:\n  ${line.trim()}`,
        )
        console.error(
          '  -> Clinical thresholds, nutrients, patient identifiers, and currency values must wrap or use tooltips.\n' +
            '  -> Only opaque hashes/tokens (with font-mono or data-allow-truncate) may truncate.\n',
        )
        violationCount++
      }
    }
  }
}

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch (err) {
    return
  }

  for (const entry of entries) {
    const fullPath = resolve(dir, entry)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'coverage') {
        continue
      }
      walk(fullPath)
    } else {
      const ext = entry.slice(entry.lastIndexOf('.'))
      if (EXTENSIONS.has(ext)) {
        scanFile(fullPath)
      }
    }
  }
}

console.log('Running truncation safety audit across UI sources...')
for (const dir of SCAN_DIRS) {
  const fullDir = resolve(rootDir, dir)
  if (existsSync(fullDir)) {
    walk(fullDir)
  }
}

if (violationCount > 0) {
  console.error(`\x1b[31mFAIL: Found ${violationCount} disallowed truncation instance(s).\x1b[0m`)
  process.exit(1)
} else {
  console.log(
    '\x1b[32mPASS: Zero disallowed truncation utilities found. All clinical and numeric fields wrap safely.\x1b[0m',
  )
  process.exit(0)
}
