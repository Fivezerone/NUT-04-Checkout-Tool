#!/usr/bin/env node
/**
 * scripts/check-no-silent-fallbacks.mjs
 *
 * Scans src/ for fail-open fallbacks and empty catch blocks (§5.4 / D-32).
 * Enforces NUT-04 fail-closed principles:
 * 1. Grades must never default to favorable or arbitrary grades (e.g. || 'C', || 'B').
 * 2. Medical conditions must never default to condition diagnoses (e.g. || 'diabetes').
 * 3. catch {} blocks must never be completely empty without logging or handling.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

// Data paths defined by NUT-04 architecture (data flow, storage, auth, scoring, and UI)
const DATA_PATHS = [
  'src/ui/src',
  'src/shared',
  'src/extension/db.js',
  'src/extension/engine',
  'src/extension/catalog-sync.js',
  'src/extension/observed-orders-sync.js',
  'src/extension/entitlement.js',
]

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs'])

const FORBIDDEN_FALLBACKS = [
  {
    regex: /(?:\|\||\?\?)\s*['"](A|B|C|D|E)['"]/g,
    description: 'Forbidden hardcoded grade fallback in expression',
  },
  {
    regex: /(?:\|\||\?\?)\s*['"](?:diabetes|hypertension|renal|kidney|cardio)['"]/gi,
    description: 'Forbidden hardcoded clinical condition fallback in expression',
  },
]

// Empty catch block regex: catch (...) { } with optional whitespace or comments only
const EMPTY_CATCH_REGEX = /catch\s*(?:\([^)]*\))?\s*\{(?:\s*|\s*\/\/[^\n]*\s*)\}/g

let violationCount = 0

function scanFile(filePath) {
  // Exclude test files
  if (
    filePath.includes('__tests__') ||
    filePath.endsWith('.test.ts') ||
    filePath.endsWith('.test.tsx') ||
    filePath.endsWith('.spec.ts') ||
    filePath.endsWith('.spec.tsx')
  ) {
    return
  }

  let content
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    return
  }

  const relPath = relative(rootDir, filePath).replace(/\\/g, '/')
  const lines = content.split('\n')

  // Check forbidden fallbacks line by line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Ignore comments
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue

    for (const rule of FORBIDDEN_FALLBACKS) {
      if (rule.regex.test(line)) {
        // Reset regex state
        rule.regex.lastIndex = 0
        console.error(
          `\x1b[31m[FAIL-OPEN FALLBACK]\x1b[0m ${relPath}:${i + 1} - ${rule.description}:\n  ${line.trim()}`,
        )
        violationCount++
      }
    }
  }

  // Check empty catch blocks across entire file
  let match
  while ((match = EMPTY_CATCH_REGEX.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split('\n').length
    console.error(
      `\x1b[31m[EMPTY CATCH BLOCK]\x1b[0m ${relPath}:${lineNum} - Silent error swallowing is prohibited:\n  ${match[0]}`,
    )
    violationCount++
  }
}

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
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
      if (
        entry === 'node_modules' ||
        entry === '.git' ||
        entry === 'dist' ||
        entry === 'coverage'
      ) {
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

console.log('Running fail-closed and silent-fallback safety audit on data paths...')
for (const relPath of DATA_PATHS) {
  const fullPath = resolve(rootDir, relPath)
  let stat
  try {
    stat = statSync(fullPath)
  } catch {
    continue
  }
  if (stat.isDirectory()) {
    walk(fullPath)
  } else {
    scanFile(fullPath)
  }
}

if (violationCount > 0) {
  console.error(
    `\x1b[31mFAIL: Found ${violationCount} silent fallback or empty catch violation(s).\x1b[0m`,
  )
  process.exit(1)
} else {
  console.log(
    '\x1b[32mPASS: Zero silent fallbacks or empty catch blocks found. Fail-closed invariants enforced.\x1b[0m',
  )
  process.exit(0)
}
