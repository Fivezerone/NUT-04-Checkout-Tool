#!/usr/bin/env node
/**
 * scripts/check-tokens.mjs
 *
 * Verifies that src/ui/src/styles/tokens.generated.css matches the latest
 * compilation of the tokens/ directory. Fails if stale.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const targetFile = resolve(root, 'src/ui/src/styles/tokens.generated.css')

if (!existsSync(targetFile)) {
  console.error(
    '[check-tokens] FAIL: tokens.generated.css does not exist. Run npm run build:tokens.',
  )
  process.exit(1)
}

const currentContent = readFileSync(targetFile, 'utf8')

// Re-generate in memory or execute script and compare
try {
  execFileSync('node', [resolve(__dirname, 'build-tokens.mjs')], { stdio: 'pipe' })
  const newContent = readFileSync(targetFile, 'utf8')
  if (currentContent !== newContent) {
    console.error('[check-tokens] FAIL: tokens.generated.css was out of date.')
    process.exit(1)
  }
  console.log('[check-tokens] PASS: tokens.generated.css is fresh and up to date.')
} catch (err) {
  console.error('[check-tokens] Error checking tokens:', err.message)
  process.exit(1)
}
