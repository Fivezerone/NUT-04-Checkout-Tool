#!/usr/bin/env node
/**
 * scripts/purge-mocks.mjs
 *
 * Purge Mock Accounts & CI Release Gate Check (Phase 7)
 *
 * Usage:
 *   node scripts/purge-mocks.mjs                # Purges all mock data from local instance
 *   node scripts/purge-mocks.mjs --check-clean  # CI gate: exits 1 if any mock data exists
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// Simple .env loader
function loadEnv() {
  const envPath = resolve(REPO_ROOT, '.env')
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim()
        const val = trimmed
          .slice(idx + 1)
          .trim()
          .replace(/^["']|["']$/g, '')
        if (!process.env[key]) {
          process.env[key] = val
        }
      }
    }
  }
}

loadEnv()

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const isCheckCleanOnly = process.argv.includes('--check-clean')

// ----------------------------------------------------------------------------
// Safety Gate: Refuse any non-local or production environment (unless --check-clean)
// ----------------------------------------------------------------------------
const isLocal =
  SUPABASE_URL.includes('127.0.0.1') ||
  SUPABASE_URL.includes('localhost') ||
  SUPABASE_URL.includes('0.0.0.0')

if (!isCheckCleanOnly && (!isLocal || process.env.NODE_ENV === 'production')) {
  console.error(
    '\n❌ REFUSING TO RUN: purge-mocks.mjs may only execute write operations against a LOCAL Supabase instance.',
  )
  console.error(`Target URL was: ${SUPABASE_URL}`)
  process.exit(1)
}

if (!SERVICE_ROLE_KEY) {
  console.error('\n❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable.')
  process.exit(1)
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const MOCK_CLINIC_ID = '11111111-2222-3333-4444-555555555555'

async function run() {
  console.log(`[purge-mocks] Connecting to Supabase at: ${SUPABASE_URL}`)

  // 1. Find all mock auth users
  const { data: userList, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })

  if (listErr) {
    throw new Error(`Failed to list auth users: ${listErr.message}`)
  }

  const mockUsers = (userList?.users || []).filter(
    (u) => u.email && (u.email.endsWith('.test') || u.email.includes('@clinic.test')),
  )

  // 2. Check if mock tenant exists
  const { data: mockTenant } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .eq('id', MOCK_CLINIC_ID)
    .maybeSingle()

  if (isCheckCleanOnly) {
    console.log('[purge-mocks] Running CI Release Gate Check (--check-clean)...')
    if (mockUsers.length > 0 || mockTenant) {
      console.error(
        `\n❌ CI RELEASE GATE FAILED: Found ${mockUsers.length} mock user(s) and mock tenant (${mockTenant ? 'present' : 'none'}).`,
      )
      console.error(
        'Mock .test accounts must never exist in a release/staging/production database.',
      )
      process.exit(1)
    }
    console.log('✅ CI RELEASE GATE PASSED: Zero mock users or mock tenant records found.')
    process.exit(0)
  }

  console.log(`\nFound ${mockUsers.length} mock user(s) to purge.`)

  for (const user of mockUsers) {
    console.log(`Purging mock user: ${user.email} (${user.id})...`)

    // Delete child dependencies in order
    await supabaseAdmin.from('consents').delete().eq('patient_id', user.id)
    await supabaseAdmin
      .from('patient_links')
      .delete()
      .or(`patient_id.eq.${user.id},clinician_id.eq.${user.id}`)
    await supabaseAdmin
      .from('targets')
      .delete()
      .or(`patient_id.eq.${user.id},prescribed_by.eq.${user.id}`)
    await supabaseAdmin.from('consumption_diary').delete().eq('user_id', user.id)
    await supabaseAdmin.from('tenant_members').delete().eq('user_id', user.id)
    await supabaseAdmin.from('users').delete().eq('id', user.id)
    await supabaseAdmin.rpc('remove_platform_member', { p_user_id: user.id })

    // Delete from auth.users
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user.id)
    if (delErr) {
      console.warn(`   ⚠️ Warning deleting auth user ${user.id}: ${delErr.message}`)
    } else {
      console.log(`   ✓ Auth user deleted: ${user.email}`)
    }
  }

  // Delete mock tenant
  if (mockTenant) {
    console.log(`Deleting mock tenant: ${mockTenant.name} (${mockTenant.id})...`)
    await supabaseAdmin.from('health_mode_rules').delete().eq('tenant_id', MOCK_CLINIC_ID)
    await supabaseAdmin.from('health_modes').delete().eq('tenant_id', MOCK_CLINIC_ID)
    await supabaseAdmin.from('tenants').delete().eq('id', MOCK_CLINIC_ID)
    console.log('   ✓ Mock tenant deleted.')
  }

  // Remove .mock-credentials.json if exists
  const credsPath = resolve(REPO_ROOT, '.mock-credentials.json')
  if (existsSync(credsPath)) {
    unlinkSync(credsPath)
    console.log(`   ✓ Deleted ${credsPath}`)
  }

  console.log('\n✅ Mock identity purge complete. Database is clean.')
}

run().catch((err) => {
  if (
    err?.cause?.code === 'ECONNREFUSED' ||
    err?.message?.includes('fetch failed') ||
    err?.message?.includes('connect ECONNREFUSED')
  ) {
    console.error('\n❌ CONNECTION REFUSED: Could not reach Supabase at ' + SUPABASE_URL)
    console.error('The local Supabase Docker containers are not currently running.')
    console.error('Make sure Docker Desktop is started and run: npx supabase start\n')
  } else {
    console.error('Fatal error during mock purge:', err)
  }
  process.exit(1)
})
