#!/usr/bin/env node
/**
 * scripts/seed-mock-users.mjs
 *
 * Seed Mock Users for CAD & Extension Local Testing (Phase 7)
 *
 * Rules:
 * 1. Uses reserved RFC 2606 / RFC 6761 `.test` top-level domain.
 * 2. Generates high-entropy random passwords and writes to git-ignored `.mock-credentials.json`.
 * 3. Creates:
 *    - 1 mock clinic: Nairobi Metabolic Care Clinic
 *    - 1 clinic admin: admin@clinic.test
 *    - 1 writing clinician: dr.mwangi@clinic.test (KMPDC A.4921 verified)
 *    - 1 viewing dietician: dietician.wanjiku@clinic.test (KNDI D.1082 verified)
 *    - 2 patients with assigned health modes:
 *      * patient1@clinic.test (Cardio-Metabolic / Diabetes, assigned to Dr. Mwangi)
 *      * patient2@clinic.test (Hypertension Care, assigned to Dr. Mwangi)
 * 4. Safety Gate: Aborts immediately if run against any non-local/production project.
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
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

  // 1. Ensure Mock Clinic Tenant
  console.log('\n1. Ensuring Mock Clinic Tenant...')
  const { error: tenantErr } = await supabaseAdmin.from('tenants').upsert({
    id: MOCK_CLINIC_ID,
    name: 'Nairobi Metabolic Care Clinic',
    slug: 'nairobi-metabolic',
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
  console.log(
    '   ✓ Tenant ready: Nairobi Metabolic Care Clinic (11111111-2222-3333-4444-555555555555)',
  )

  // Mock User Definitions
  const mockDefinitions = [
    {
      key: 'clinic_admin',
      email: 'admin@clinic.test',
      fullName: 'Alice Mumo (Clinic Admin)',
      role: 'tenant_admin',
      password: generateSecurePassword('Admin'),
      licenceNumber: null,
      licenceVerified: false,
    },
    {
      key: 'clinician',
      email: 'dr.mwangi@clinic.test',
      fullName: 'Dr. Joseph Mwangi',
      role: 'writing_clinician',
      password: generateSecurePassword('Doc'),
      licenceNumber: 'KMPDC-A.4921',
      licenceVerified: true,
    },
    {
      key: 'dietician',
      email: 'dietician.wanjiku@clinic.test',
      fullName: 'Grace Wanjiku (Dietician)',
      role: 'viewing_dietician',
      password: generateSecurePassword('Diet'),
      licenceNumber: 'KNDI-D.1082',
      licenceVerified: true,
    },
    {
      key: 'patient_diabetes',
      email: 'patient1@clinic.test',
      fullName: 'David Kiprono',
      role: 'patient',
      password: generateSecurePassword('Pat1'),
      condition: 'diabetes',
      metric: 'Refined Sugars & Carbohydrates',
      licenceNumber: null,
      licenceVerified: false,
    },
    {
      key: 'patient_hypertension',
      email: 'patient2@clinic.test',
      fullName: 'Sarah Achieng',
      role: 'patient',
      password: generateSecurePassword('Pat2'),
      condition: 'hypertension',
      metric: 'Sodium & Saturated Fat',
      licenceNumber: null,
      licenceVerified: false,
    },
  ]

  const createdRecords = {}

  console.log('\n2. Provisioning Mock Accounts in Supabase Auth & Public Tables...')

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
          user_metadata: { full_name: def.fullName },
          app_metadata: {
            role: def.role,
            tenant_id: MOCK_CLINIC_ID,
            cad_provisioned: true,
            status: 'active',
          },
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
        user_metadata: { full_name: def.fullName },
        app_metadata: {
          role: def.role,
          tenant_id: MOCK_CLINIC_ID,
          cad_provisioned: true,
          status: 'active',
        },
      })
      if (crtErr) throw crtErr
      authUser = created.user
      console.log(`   + Created auth user: ${def.email}`)
    }

    // Sync public.users
    await supabaseAdmin.from('users').upsert({
      id: authUser.id,
      email: def.email,
      full_name: def.fullName,
      tenant_id: MOCK_CLINIC_ID,
      role: def.role,
      condition: def.condition || 'general',
      metric: def.metric || 'Target Nutrients',
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    })

    // Sync public.tenant_members
    await supabaseAdmin.from('tenant_members').upsert({
      tenant_id: MOCK_CLINIC_ID,
      user_id: authUser.id,
      role: def.role,
      status: 'active',
      licence_number: def.licenceNumber,
      licence_verified: def.licenceVerified,
      licence_expiry: def.licenceVerified ? '2028-12-31' : null,
      updated_at: new Date().toISOString(),
    })

    // If patient, pre-grant 2.0 care consent
    if (def.role === 'patient') {
      await supabaseAdmin.from('consents').upsert({
        patient_id: authUser.id,
        tenant_id: MOCK_CLINIC_ID,
        consent_version: '2.0',
        terms_accepted: true,
        privacy_accepted: true,
        clinical_sharing_accepted: true,
        user_agent: 'Mock Seed Script (RFC 2606)',
        ip_hash: 'mock_seed_local_ip',
        consented_at: new Date().toISOString(),
      })
    }

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      tenant_id: MOCK_CLINIC_ID,
      actor_id: authUser.id,
      action: 'MOCK_USER_SEEDED',
      entity: 'users',
      entity_id: authUser.id,
      payload: { email: def.email, role: def.role },
    })

    createdRecords[def.key] = {
      id: authUser.id,
      email: def.email,
      password: def.password,
      role: def.role,
      name: def.fullName,
      condition: def.condition || null,
      metric: def.metric || null,
      licenceNumber: def.licenceNumber,
      clinic: 'Nairobi Metabolic Care Clinic',
    }
  }

  // 3. Link Patients to Dr. Mwangi
  console.log('\n3. Establishing Patient Care Links to Primary Clinician...')
  const docId = createdRecords.clinician.id
  for (const patKey of ['patient_diabetes', 'patient_hypertension']) {
    const pat = createdRecords[patKey]
    await supabaseAdmin.from('patient_links').upsert({
      tenant_id: MOCK_CLINIC_ID,
      clinician_id: docId,
      patient_id: pat.id,
      status: 'active',
    })
    console.log(`   ✓ Linked patient ${pat.email} -> Dr. Mwangi (${docId})`)
  }

  // 4. Save credentials to git-ignored .mock-credentials.json
  const credsPath = resolve(REPO_ROOT, '.mock-credentials.json')
  const payload = {
    generatedAt: new Date().toISOString(),
    targetSupabaseUrl: SUPABASE_URL,
    mockClinicId: MOCK_CLINIC_ID,
    users: createdRecords,
  }

  writeFileSync(credsPath, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`\n4. Saved credentials to ${credsPath} (git-ignored)`)

  // 5. Output Summary Table
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
  console.error('Fatal error during mock seeding:', err)
  process.exit(1)
})
