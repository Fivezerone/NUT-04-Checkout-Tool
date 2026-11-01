#!/usr/bin/env node
/** Prevent security regressions that the CAD blueprint explicitly bans. */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

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
      "auth\\.jwt\\(\\)\\s*->>\\s*'role'|app_metadata\\??\\.role|app_metadata\\.role|appMeta\\.role|json\\.role",
  },
]

for (const check of forbidden) {
  try {
    const output = execFileSync(
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
        'supabase',
        'scripts',
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    if (output.trim()) {
      console.error(`❌ [cad-security] ${check.label} found:\n${output}`)
      process.exit(1)
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 1) continue
    throw error
  }
}

console.log(
  '✅ [cad-security] no rank authorization, legacy ban value, or raw application-role reads found.',
)
