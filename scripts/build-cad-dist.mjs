#!/usr/bin/env node
/**
 * scripts/build-cad-dist.mjs
 *
 * Prepares the separate CAD static hosting bundle in `dist-ui/cad`.
 * - Ensures `cad.html` in `dist-ui/cad` is available as `index.html`.
 * - Verifies zero CAD bundles leaked into `dist/extension/assets`.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const cadDistDir = resolve(root, 'dist-ui/cad')
const extDir = resolve(root, 'dist/extension')

mkdirSync(cadDistDir, { recursive: true })

// 1. In dist-ui/cad, copy cad.html to index.html if needed
const cadHtml = resolve(cadDistDir, 'cad.html')
const cadIndex = resolve(cadDistDir, 'index.html')

if (existsSync(cadHtml)) {
  copyFileSync(cadHtml, cadIndex)
  console.log('[build-cad-dist] Prepared dist-ui/cad/index.html from cad.html')
} else if (!existsSync(cadIndex)) {
  console.warn('[build-cad-dist] Neither cad.html nor index.html found in dist-ui/cad.')
}

// 2. Safeguard: Clean up any accidentally placed cad.html in dist/extension
const extCadHtml = resolve(extDir, 'cad.html')
if (existsSync(extCadHtml)) {
  rmSync(extCadHtml, { force: true })
  console.log('[build-cad-dist] Removed accidental cad.html from extension package.')
}

// 3. Verify zero CAD chunks in dist/extension/assets
const extAssetsDir = resolve(extDir, 'assets')
if (existsSync(extAssetsDir)) {
  const leakedCadFiles = readdirSync(extAssetsDir).filter((file) => /^cad[-.]/i.test(file))
  if (leakedCadFiles.length > 0) {
    console.error(
      '[build-cad-dist] VIOLATION: CAD files leaked into extension assets:',
      leakedCadFiles,
    )
    leakedCadFiles.forEach((file) => rmSync(resolve(extAssetsDir, file), { force: true }))
    console.log('[build-cad-dist] Purged leaked CAD assets from extension distribution.')
  } else {
    console.log('[build-cad-dist] Verification passed: Zero CAD assets in extension bundle.')
  }
}
