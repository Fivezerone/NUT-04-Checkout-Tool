#!/usr/bin/env node
/**
 * scripts/build-cad-dist.mjs
 *
 * Prepares the separate CAD static hosting bundle in `dist-ui/cad`.
 * Copies Vite-compiled `cad.html` -> `dist-ui/cad/index.html`
 * and syncs `assets/` -> `dist-ui/cad/assets/`.
 * Removes `cad.html` from the extension package (D-21).
 */

import { existsSync, mkdirSync, copyFileSync, cpSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const cadDistDir = resolve(root, 'dist-ui/cad')
const extDir = resolve(root, 'dist/extension')
const distDir = resolve(root, 'dist')

mkdirSync(cadDistDir, { recursive: true })

// Check dist/extension/cad.html first, then fallback to dist/cad.html
const cadHtmlSrc = existsSync(resolve(extDir, 'cad.html'))
  ? resolve(extDir, 'cad.html')
  : resolve(distDir, 'cad.html')
const cadIndexDst = resolve(cadDistDir, 'index.html')

if (existsSync(cadHtmlSrc)) {
  copyFileSync(cadHtmlSrc, cadIndexDst)
  console.log('[build-cad-dist] Copied cad.html -> dist-ui/cad/index.html')
  // Clean up cad.html from extension build so CAD is not bundled into shopper extension
  if (cadHtmlSrc.startsWith(extDir)) {
    rmSync(cadHtmlSrc, { force: true })
    console.log('[build-cad-dist] Removed cad.html from extension distribution.')
  }
} else {
  console.warn('[build-cad-dist] cad.html not found. Run vite build first.')
}

const assetsSrc = existsSync(resolve(extDir, 'assets'))
  ? resolve(extDir, 'assets')
  : resolve(distDir, 'assets')
const assetsDst = resolve(cadDistDir, 'assets')

if (existsSync(assetsSrc)) {
  cpSync(assetsSrc, assetsDst, { recursive: true })
  console.log('[build-cad-dist] Synced assets/ -> dist-ui/cad/assets/')
} else {
  console.warn('[build-cad-dist] assets not found. Run vite build first.')
}
