#!/usr/bin/env node
/**
 * scripts/check-tokens.mjs
 *
 * Verifies that generated token files match the latest
 * compilation of the tokens/ directory. Fails if stale.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const targetFiles = [
  resolve(root, 'src/ui/src/styles/tokens.generated.css'),
  resolve(root, 'src/ui/src/styles/tokens.theme.css'),
  resolve(root, 'src/extension/styles/portal-tokens.css'),
]

for (const targetFile of targetFiles) {
  if (!existsSync(targetFile)) {
    console.error(`[check-tokens] FAIL: ${targetFile} does not exist. Run npm run build:tokens.`)
    process.exit(1)
  }
}

const beforeContents = targetFiles.map((f) => readFileSync(f, 'utf8'))

try {
  execFileSync('node', [resolve(__dirname, 'build-tokens.mjs')], { stdio: 'pipe' })
  for (let i = 0; i < targetFiles.length; i++) {
    const after = readFileSync(targetFiles[i], 'utf8')
    if (beforeContents[i] !== after) {
      console.error(`[check-tokens] FAIL: ${targetFiles[i]} was out of date.`)
      process.exit(1)
    }
  }
  console.log('[check-tokens] PASS: All generated tokens are fresh and up to date.')
} catch (err) {
  console.error('[check-tokens] Error checking tokens:', err.message)
  process.exit(1)
}
