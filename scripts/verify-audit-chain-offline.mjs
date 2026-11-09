#!/usr/bin/env node
/**
 * NutriScore CAD Phase 5 — Offline Audit Chain Verifier CLI
 *
 * Standalone offline verifier that needs only:
 *   - A JSON export produced by:  node scripts/verify-audit-chain.mjs --export-only=<file>
 *   - No DB connection required
 *
 * Usage:
 *   node scripts/verify-audit-chain-offline.mjs --export=<json-file> [--chain-id=<uuid>]
 *
 * This is a thin wrapper that delegates to verify-audit-chain.mjs in offline mode.
 * Blueprint ref: §4.5 (offline verification path)
 */

import { argv } from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const verifier = resolve(__dirname, 'verify-audit-chain.mjs')

// Forward all args plus --mode=offline
const forwardedArgs = argv.slice(2).filter((a) => !a.startsWith('--mode='))

const result = spawnSync(process.execPath, [verifier, '--mode=offline', ...forwardedArgs], {
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
