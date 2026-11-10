#!/usr/bin/env node
/** Prevent security regressions that the CAD blueprint explicitly bans. */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readdirSync, readFileSync, statSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const forbidden = [
  {
    label: 'numeric-rank authorization',
    pattern: 'callerRank|targetRank|ROLE_HIERARCHY|ROLE_RANK|Rank\\(',
  },
  { label: 'legacy far-future ban value', pattern: '3000-01-01' },
  {
    label: 'raw application role JWT reads',
    pattern:
      "auth\\.jwt\\(\\)\\s*->>'role'|app_metadata\\??\\.role|app_metadata\\.role|appMeta\\.role|json\\.role",
  },
]

const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.sql'])
const SCAN_DIRS = ['src', 'scripts']

/** Portable Node.js fallback: walk directories and grep with RegExp. */
function grepFallback(pattern, dirs, rootDir) {
  const re = new RegExp(pattern)
  const hits = []
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = resolve(dir, entry)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
        walk(full)
      } else if (
        SCAN_EXTS.has('.' + entry.split('.').pop()) &&
        entry !== 'check-cad-security.mjs'
      ) {
        let text
        try {
          text = readFileSync(full, 'utf8')
        } catch {
          continue
        }
        text.split('\n').forEach((line, i) => {
          if (re.test(line))
            hits.push(
              `${full.replace(rootDir + '\\', '').replace(rootDir + '/', '')}:${i + 1}:${line}`,
            )
        })
      }
    }
  }
  for (const d of dirs) walk(resolve(rootDir, d))
  return hits.join('\n')
}

for (const check of forbidden) {
  let output
  let usedFallback = false
  try {
    output = execFileSync(
      'rg',
      [
        '-n',
        '--glob',
        '*.{ts,tsx,js,mjs,sql}',
        '--glob',
        '!check-cad-security.mjs',
        '-e',
        check.pattern,
        'src',
        'scripts',
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } catch (error) {
    // Exit 1 from rg means no matches — that is the success case.
    if (error && typeof error === 'object' && 'status' in error && error.status === 1) continue
    // rg not on PATH (ENOENT / status null): use portable Node.js fallback.
    if (
      error &&
      typeof error === 'object' &&
      ('code' in error ? error.code === 'ENOENT' : !('status' in error) || error.status === null)
    ) {
      usedFallback = true
      output = grepFallback(check.pattern, SCAN_DIRS, root)
    } else {
      throw error
    }
  }
  if (output && output.trim()) {
    if (usedFallback) console.warn('[cad-security] rg not on PATH; used Node.js grep fallback.')
    console.error(`❌ [cad-security] ${check.label} found:\n${output}`)
    process.exit(1)
  }
}

console.log(
  '✅ [cad-security] no rank authorization, legacy ban value, or raw application-role reads found.',
)
