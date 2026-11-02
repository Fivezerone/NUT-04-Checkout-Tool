#!/usr/bin/env node
/**
 * scripts/seed-mock-users.mjs
 *
 * Seed de-identified mock identities for CAD & extension local testing.
 *
 * Rules:
 * 1. Uses reserved RFC 2606 / RFC 6761 `.test` top-level domain.
 * 2. Generates high-entropy random passwords and writes to git-ignored `.mock-credentials.json`.
 * 3. Creates only de-identified role fixtures: one fixture tenant, tenant
 *    accounts, a commercial stakeholder, and DHA/ODPC platform auditors.
 *    No names, clinical data, care links, or condition-labelled fields are
 *    written to the database, credentials file, or logs.
 * 4. Safety Gate: Aborts immediately if run against any non-local/production project.
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// Simple .env loader with .env.local override
function loadEnv() {
  for (const file of ['.env', '.env.local']) {
    const envPath = resolve(REPO_ROOT, file)
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
          process.env[key] = val
        }
      }
    }
  }
}

loadEnv()

const LOCAL_DEFAULT_URL = 'http://127.0.0.1:54321'
const LOCAL_DEFAULT_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const SUPABASE_URL = process.env.SUPABASE_URL || LOCAL_DEFAULT_URL
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_secret_')
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : LOCAL_DEFAULT_KEY

// ----------------------------------------------------------------------------
// Safety Gate: Refuse any non-local or production environment
// ----------------------------------------------------------------------------
const isLocal =
  SUPABASE_URL.includes('127.0.0.1') ||
  SUPABASE_URL.includes('localhost') ||
  SUPABASE_URL.includes('0.0.0.0')

if (!isLocal || process.env.NODE_ENV === 'production') {
  console.error(
    '\n❌ REFUSING TO RUN: seed-mock-users.mjs may only be run against a LOCAL Supabase instance.',
  )
  console.error(`Target URL was: ${SUPABASE_URL}`)
  process.exit(1)
}

if (!SERVICE_ROLE_KEY) {
  console.error('\n❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable.')
  console.error('Provide it in .env or via terminal.')
  process.exit(1)
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function generateSecurePassword(prefix = 'Test') {
  const token = randomBytes(8).toString('base64url')
  return `${prefix}!${token}#99`
}

const MOCK_CLINIC_ID = '11111111-2222-3333-4444-555555555555'

async function seed() {
  console.log('\n===========================================================')
  console.log('  NUT-04 — CAD Mock Identity Seed (Local Development)')
  console.log('===========================================================')
  console.log(`Connecting to: ${SUPABASE_URL}`)

  // 1. Ensure the single neutral fixture tenant.
  console.log('\n1. Ensuring fixture tenant...')
  const { error: tenantErr } = await supabaseAdmin.from('tenants').upsert({
    id: MOCK_CLINIC_ID,
    name: 'Fixture Clinic',
    slug: 'fixture-clinic',
    status: 'active',
    config: {
      rule_pack: 'ke_standard',
      language: 'en',
      branding: { primaryColor: '#059669', logoUrl: '' },
    },
  })

  if (tenantErr) {
    throw new Error(`Failed to create mock tenant: ${tenantErr.message}`)
  }
  console.log('   ✓ Fixture tenant ready: 11111111-2222-3333-4444-555555555555')

  // This is intentionally the complete identity fixture contract. Keep the
  // generated passwords local and git-ignored; do not add profile or clinical
  // data here. `licenceVerified` is retained only to exercise the clinical
  // role gate in local authorization tests.
  const mockDefinitions = [
    {
      key: 'tenant_admin',
      email: 'tenant.admin@clinic.test',
      role: 'tenant_admin',
      password: generateSecurePassword('TenantAdmin'),
    },
    {
      key: 'writing_clinician',
      email: 'clinician.one@clinic.test',
      role: 'writing_clinician',
      password: generateSecurePassword('Clinician'),
      licenceVerified: true,
    },
    {
      key: 'viewing_dietician',
      email: 'dietician.one@clinic.test',
      role: 'viewing_dietician',
      password: generateSecurePassword('Dietician'),
      licenceVerified: true,
    },
    {
      key: 'patient_alpha',
      email: 'patient.alpha@clinic.test',
      role: 'patient',
      password: generateSecurePassword('PatientAlpha'),
    },
    {
      key: 'patient_beta',
      email: 'patient.beta@clinic.test',
      role: 'patient',
      password: generateSecurePassword('PatientBeta'),
    },
    {
      key: 'commercial_stakeholder',
      email: 'partner.stakeholder@clinic.test',
      role: 'commercial_stakeholder',
      password: generateSecurePassword('Stakeholder'),
      partnerOrg: 'fixture-partner',
    },
    {
      key: 'regulator_dha',
      email: 'regulator.dha@platform.test',
      role: 'compliance_auditor',
      scope: 'platform',
      regulatorBody: 'DHA',
      mandateRef: 'fixture-dha-mandate',
      password: generateSecurePassword('DHA'),
    },
    {
      key: 'regulator_odpc',
      email: 'regulator.odpc@platform.test',
      role: 'compliance_auditor',
      scope: 'platform',
      regulatorBody: 'ODPC',
      mandateRef: 'fixture-odpc-mandate',
      password: generateSecurePassword('ODPC'),
    },
  ]

  const createdRecords = {}

  console.log('\n2. Provisioning de-identified fixture accounts...')

  for (const def of mockDefinitions) {
    let authUser = null

    // Check existing auth user
    const { data: userList } = await supabaseAdmin.auth.admin.listUsers()
    const existing = userList?.users?.find((u) => u.email === def.email)

    if (existing) {
      // Update password and metadata
      const { data: updated, error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
        existing.id,
        {
          password: def.password,
          user_metadata: {},
          app_metadata: { cad_fixture: true },
        },
      )
      if (updErr) throw updErr
      authUser = updated.user
      console.log(`   * Updated existing auth user: ${def.email}`)
    } else {
      // Create new user
      const { data: created, error: crtErr } = await supabaseAdmin.auth.admin.createUser({
        email: def.email,
        password: def.password,
        email_confirm: true,
        user_metadata: {},
        app_metadata: { cad_fixture: true },
      })
      if (crtErr) throw crtErr
      authUser = created.user
      console.log(`   + Created auth user: ${def.email}`)
    }

    if (def.scope === 'platform') {
      const { error: platformErr } = await supabaseAdmin.rpc('create_platform_member', {
        p_user_id: authUser.id,
        p_role: def.role,
        p_regulator_body: def.regulatorBody,
        p_mandate_ref: def.mandateRef,
        p_created_by: null,
      })
      if (platformErr)
        throw new Error(`Failed to provision platform fixture: ${platformErr.message}`)
    } else {
      const { error: userErr } = await supabaseAdmin.from('users').upsert({
        id: authUser.id,
        email: def.email,
        tenant_id: MOCK_CLINIC_ID,
        updated_at: new Date().toISOString(),
      })
      if (userErr) throw new Error(`Failed to provision fixture user: ${userErr.message}`)

      const { error: memberErr } = await supabaseAdmin.from('tenant_members').upsert(
        {
          tenant_id: MOCK_CLINIC_ID,
          user_id: authUser.id,
          role: def.role,
          status: 'active',
          licence_verified: Boolean(def.licenceVerified),
          partner_org: def.partnerOrg || null,
        },
        { onConflict: 'tenant_id,user_id' },
      )
      if (memberErr) throw new Error(`Failed to provision tenant fixture: ${memberErr.message}`)
    }

    createdRecords[def.key] = {
      id: authUser.id,
      email: def.email,
      password: def.password,
      role: def.role,
      tenantId: def.scope === 'platform' ? null : MOCK_CLINIC_ID,
      scope: def.scope || 'tenant',
    }
  }

  // 3. Save the synthetic credentials to the git-ignored local file.
  const credsPath = resolve(REPO_ROOT, '.mock-credentials.json')
  const payload = {
    generatedAt: new Date().toISOString(),
    targetSupabaseUrl: SUPABASE_URL,
    mockClinicId: MOCK_CLINIC_ID,
    users: createdRecords,
  }

  writeFileSync(credsPath, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`\n3. Saved credentials to ${credsPath} (git-ignored)`)

  // 4. Output the local-only credentials summary.
  console.log('\n=============================================================================')
  console.log('  CAD MOCK TEST CREDENTIALS (LOCAL ONLY)')
  console.log('=============================================================================')
  console.log('Role               | Email                          | Password')
  console.log('-------------------+--------------------------------+------------------------')
  for (const [key, u] of Object.entries(createdRecords)) {
    const rolePadded = u.role.padEnd(18)
    const emailPadded = u.email.padEnd(30)
    console.log(`${rolePadded} | ${emailPadded} | ${u.password}`)
  }
  console.log('=============================================================================\n')
}

seed().catch((err) => {
  if (
    err?.cause?.code === 'ECONNREFUSED' ||
    err?.message?.includes('fetch failed') ||
    err?.message?.includes('connect ECONNREFUSED')
  ) {
    console.error('\n❌ CONNECTION REFUSED: Could not reach local Supabase at ' + SUPABASE_URL)
    console.error('The local Supabase Docker containers are not currently running.')
    console.error('\nTo start the local environment:')
    console.error(
      '  1. Launch Docker Desktop from the Start Menu (or run: Start-Process "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe")',
    )
    console.error('  2. Once Docker Desktop is running, start the stack: npx supabase start')
    console.error('  3. Re-run: npm run seed:mocks\n')
  } else {
    console.error('Fatal error during mock seeding:', err)
  }
  process.exit(1)
})
