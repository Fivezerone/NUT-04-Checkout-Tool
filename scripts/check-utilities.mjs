#!/usr/bin/env node
/**
 * scripts/check-utilities.mjs
 *
 * Implements Appendix B: Utility Class Resolution Checker.
 * Verifies that colour and semantic utility classes used in TSX/JS sources
 * actually exist as generated CSS selectors in the built stylesheets.
 *
 * Usage:
 *   node scripts/check-utilities.mjs [--enforce]
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const isEnforce = process.argv.includes('--enforce')

// 1. Gather all built CSS files
const cssDirs = [resolve(ROOT, 'dist/extension/assets'), resolve(ROOT, 'dist-ui/cad/assets')]

const cssFiles = []
for (const dir of cssDirs) {
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.css')) cssFiles.push(join(dir, f))
    }
  }
}

if (cssFiles.length === 0) {
  console.error('[check:utilities] No built CSS files found. Run npm run build first.')
  process.exit(1)
}

// 2. Parse all selectors from CSS and extract class names
const cssClasses = new Set()

function extractClassesFromSelector(selector) {
  // Regex to extract unescaped class names from selector
  // e.g. .bg-surface, .hover\:bg-surface:hover, .\!text-strong, .border-border-control\/20
  const classMatches = selector.match(/\.((?:[a-zA-Z0-9_\-\u00a0-\uffff]|\\.)+)/g) || []
  for (const match of classMatches) {
    const raw = match.slice(1) // remove leading '.'
    const unescaped = raw.replace(/\\(.)/g, '$1')
    cssClasses.add(unescaped)
  }
}

for (const cssFile of cssFiles) {
  const css = readFileSync(cssFile, 'utf8')
  const root = postcss.parse(css)
  root.walkRules((rule) => {
    extractClassesFromSelector(rule.selector)
  })
}

// 3. Scan TSX / JS files in src/ui/src
function walkDir(dir, files = []) {
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['__tests__', 'node_modules'].includes(entry.name)) {
        walkDir(full, files)
      }
    } else if (
      /\.(tsx|ts|jsx|js)$/.test(entry.name) &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('.d.ts')
    ) {
      files.push(full)
    }
  }
  return files
}

const sourceFiles = walkDir(resolve(ROOT, 'src/ui/src'))

// Utility prefixes to inspect
const utilityPrefixes = [
  'bg',
  'text',
  'border',
  'ring',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
  'divide',
  'outline',
  'decoration',
  'accent',
  'caret',
  'placeholder',
]

// Allow-list for non-colour utilities that share these prefixes
const ALLOW_LIST = new Set([
  // Typography sizing & alignment
  'text-xs',
  'text-sm',
  'text-base',
  'text-md',
  'text-lg',
  'text-xl',
  'text-2xl',
  'text-3xl',
  'text-4xl',
  'text-left',
  'text-center',
  'text-right',
  'text-justify',
  'text-start',
  'text-end',
  'text-wrap',
  'text-nowrap',
  'text-balance',
  'text-pretty',
  // Borders
  'border-t',
  'border-b',
  'border-l',
  'border-r',
  'border-x',
  'border-y',
  'border-0',
  'border',
  'border-2',
  'border-4',
  'border-8',
  'border-solid',
  'border-dashed',
  'border-dotted',
  'border-double',
  'border-none',
  'border-collapse',
  'border-separate',
  // Ring widths & styles
  'ring-0',
  'ring-1',
  'ring-2',
  'ring-4',
  'ring-8',
  'ring',
  'ring-inset',
  // Divide
  'divide-x',
  'divide-y',
  'divide-x-0',
  'divide-y-0',
  'divide-x-2',
  'divide-y-2',
  'divide-solid',
  'divide-dashed',
  'divide-dotted',
  'divide-double',
  'divide-none',
  // Background positions, sizes, repeats
  'bg-auto',
  'bg-cover',
  'bg-contain',
  'bg-bottom',
  'bg-top',
  'bg-center',
  'bg-left',
  'bg-right',
  'bg-repeat',
  'bg-no-repeat',
  'bg-repeat-x',
  'bg-repeat-y',
  // Base keyword colors that Tailwind handles intrinsically
  'bg-transparent',
  'bg-current',
  'text-transparent',
  'text-current',
  'border-transparent',
  'border-current',
  'ring-transparent',
  'ring-current',
  // Native Tailwind v4 built-in keyword values
  'text-inherit',
  'text-clip',
  'text-ellipsis',
  // Arbitrary pixel / rem values: handled if compiled
])

const unresolved = new Map() // token -> Set(filePaths)
let totalColourTokens = 0
const inspectedTokens = new Set()

const classStringRegex =
  /(?:className|class)\s*=\s*(?:\{`([^`]+)`\}|["']([^"']+)["']|\{\s*clsx\(([^)]+)\)\s*\}|\{\s*cn\(([^)]+)\)\s*\})/g

for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8')
  // Match string literals
  const stringLiterals = content.match(/['"`]([^'"`\n]+)['"`]/g) || []

  for (const rawStr of stringLiterals) {
    const str = rawStr.slice(1, -1)
    const tokens = str.split(/\s+/).filter(Boolean)

    for (const rawToken of tokens) {
      // Strip variant prefixes like hover:, sm:, dark:, @[640px]:, group-hover:, etc.
      const parts = rawToken.split(':')
      const baseToken = parts[parts.length - 1]

      // Check if it matches a prefix
      const prefixMatch = baseToken.match(/^([a-z]+)-(.+)$/)
      if (!prefixMatch) continue

      const [, prefix, rest] = prefixMatch
      if (!utilityPrefixes.includes(prefix)) continue

      // Ignore arbitrary values like text-[12px] or bg-[#fff] or border-border-control/20 (we check base)
      if (baseToken.includes('[') && baseToken.includes(']')) continue
      if (baseToken.includes('${') || baseToken.includes('{') || baseToken.includes('}')) continue
      if (ALLOW_LIST.has(baseToken)) continue

      // Strip opacity modifier like /20, /50
      const baseWithoutOpacity = baseToken.split('/')[0]
      if (ALLOW_LIST.has(baseWithoutOpacity)) continue

      inspectedTokens.add(rawToken)
      totalColourTokens++

      // Check if rawToken or un-prefixed token or un-opacity token exists in CSS
      const candidateTokens = [rawToken, baseToken, baseWithoutOpacity]

      const isResolved = candidateTokens.some((cand) => cssClasses.has(cand))

      if (!isResolved) {
        if (!unresolved.has(rawToken)) {
          unresolved.set(rawToken, new Set())
        }
        unresolved.get(rawToken).add(file.replace(ROOT + '/', '').replace(ROOT + '\\', ''))
      }
    }
  }
}

console.log('========================================================')
console.log('UTILITY CLASS RESOLUTION CHECK (Appendix B)')
console.log('========================================================')
console.log(`Inspected files: ${sourceFiles.length} TSX/JS files`)
console.log(`Built CSS classes indexed: ${cssClasses.size}`)
console.log(`Colour/semantic utility tokens inspected: ${inspectedTokens.size} distinct`)
console.log(`Unresolved colour utilities: ${unresolved.size}`)
console.log('--------------------------------------------------------')

if (unresolved.size > 0) {
  console.log('Unresolved utility classes and usage counts:')
  const sorted = [...unresolved.entries()].sort((a, b) => b[1].size - a[1].size)
  for (const [token, files] of sorted.slice(0, 35)) {
    console.log(
      `  - ${token.padEnd(30)} in ${files.size} files (e.g. ${[...files].slice(0, 2).join(', ')})`,
    )
  }
  if (sorted.length > 35) {
    console.log(`  ... and ${sorted.length - 35} more unresolved tokens.`)
  }

  if (isEnforce) {
    console.error(`\n[FAIL] check:utilities found ${unresolved.size} unresolved utility classes.`)
    process.exit(1)
  } else {
    console.log(
      `\n[REPORT ONLY] ${unresolved.size} unresolved utilities reported (enforcement disabled).`,
    )
  }
} else {
  console.log('[PASS] All inspected colour utilities successfully resolve in the built CSS!')
}
