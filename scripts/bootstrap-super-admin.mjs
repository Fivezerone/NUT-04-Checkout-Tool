#!/usr/bin/env node
/**
 * scripts/bootstrap-super-admin.mjs
 *
 * Local Platform Super Administrator Bootstrap Script
 * Reference: CAD-Only Identity & Onboarding Rollback (Phase 2)
 *
 * Rule: The first platform admin comes from a one-time local bootstrap script,
 * never from an endpoint. Refuses to run against production databases.
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// Simple .env loader if present
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

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'admin@nutriscore.co.ke'

// ============================================================================
// Production Safety Gate
// ============================================================================
const isLocal =
  SUPABASE_URL.includes('127.0.0.1') ||
  SUPABASE_URL.includes('localhost') ||
  SUPABASE_URL.includes('0.0.0.0')

if (!isLocal && process.env.NODE_ENV === 'production') {
  console.error(
    '❌ [bootstrap] REFUSED: Cannot run bootstrap script against production environment.',
  )
  console.error(`Current target: ${SUPABASE_URL}`)
  process.exit(1)
}

if (!isLocal && !process.env.ALLOW_REMOTE_BOOTSTRAP) {
  console.error(
    '❌ [bootstrap] REFUSED: Remote database detected without ALLOW_REMOTE_BOOTSTRAP=1.',
  )
  console.error(`Current target: ${SUPABASE_URL}`)
  process.exit(1)
}

if (!SERVICE_ROLE_KEY) {
  console.error(
    '❌ [bootstrap] Error: SUPABASE_SERVICE_ROLE_KEY is required to bootstrap platform admin.',
  )
  process.exit(1)
}

async function bootstrap() {
  console.log(`[bootstrap] Target Supabase instance: ${SUPABASE_URL}`)
  console.log(`[bootstrap] Bootstrapping Platform Super Admin (${SUPER_ADMIN_EMAIL})...`)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 1. Ensure Platform Tenant exists
  const { error: tenantErr } = await supabase.from('tenants').upsert(
    {
      id: PLATFORM_TENANT_ID,
      name: 'NutriScore Platform Administration',
      slug: 'platform-admin',
      status: 'active',
      data_residency_region: 'ke-nairobi',
      billing_email: SUPER_ADMIN_EMAIL,
    },
    { onConflict: 'id' },
  )

  if (tenantErr) {
    console.error('❌ [bootstrap] Failed to ensure platform tenant:', tenantErr.message)
    process.exit(1)
  }
  console.log(`✅ [bootstrap] Platform tenant verified: ${PLATFORM_TENANT_ID}`)

  // 2. Check if Super Admin user already exists in Auth
  const { data: userList, error: listErr } = await supabase.auth.admin.listUsers()
  if (listErr) {
    console.error('❌ [bootstrap] Failed to list auth users:', listErr.message)
    process.exit(1)
  }

  const existingUser = userList.users.find((u) => u.email === SUPER_ADMIN_EMAIL)
  let userId
  let initialPassword = process.env.SUPER_ADMIN_PASSWORD

  if (existingUser) {
    userId = existingUser.id
    console.log(`[bootstrap] Existing auth user found: ${userId}`)

    // Update app_metadata to ensure super_admin role and tenant_id
    const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
      app_metadata: {
        role: 'super_admin',
        tenant_id: PLATFORM_TENANT_ID,
        account_status: 'active',
      },
      user_metadata: {
        full_name: 'Platform Super Administrator',
      },
    })

    if (updateErr) {
      console.error('❌ [bootstrap] Failed to update super admin metadata:', updateErr.message)
      process.exit(1)
    }
  } else {
    // Generate secure initial password if not provided
    if (!initialPassword) {
      initialPassword = 'SuperAdmin!' + randomBytes(8).toString('hex')
    }

    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: SUPER_ADMIN_EMAIL,
      password: initialPassword,
      email_confirm: true,
      app_metadata: {
        role: 'super_admin',
        tenant_id: PLATFORM_TENANT_ID,
        account_status: 'active',
      },
      user_metadata: {
        full_name: 'Platform Super Administrator',
        force_password_change: true,
      },
    })

    if (createErr || !newUser.user) {
      console.error('❌ [bootstrap] Failed to create auth user:', createErr?.message)
      process.exit(1)
    }

    userId = newUser.user.id
    console.log(`✅ [bootstrap] Auth user created: ${userId}`)
    console.log(`🔑 [bootstrap] Initial Password: ${initialPassword}`)
  }

  // 3. Upsert public.users record
  const { error: userErr } = await supabase.from('users').upsert(
    {
      id: userId,
      email: SUPER_ADMIN_EMAIL,
      full_name: 'Platform Super Administrator',
      tenant_id: PLATFORM_TENANT_ID,
      role: 'super_admin',
    },
    { onConflict: 'id' },
  )

  if (userErr) {
    console.warn('⚠️ [bootstrap] Failed to upsert public.users:', userErr.message)
  }

  // 4. Ensure tenant_members record exists
  const { error: memberErr } = await supabase.from('tenant_members').upsert(
    {
      tenant_id: PLATFORM_TENANT_ID,
      user_id: userId,
      email: SUPER_ADMIN_EMAIL,
      role: 'super_admin',
      licence_verified: true,
      status: 'active',
    },
    { onConflict: 'tenant_id,user_id' },
  )

  if (memberErr) {
    console.error('❌ [bootstrap] Failed to upsert tenant_members:', memberErr.message)
    process.exit(1)
  }

  // 5. Insert audit log record
  await supabase.from('audit_log').insert({
    tenant_id: PLATFORM_TENANT_ID,
    actor_id: userId,
    actor_role: 'super_admin',
    action: 'BOOTSTRAP_SUPER_ADMIN',
    mutation_type: 'create',
    resource_type: 'TenantMember',
    resource_id: userId,
    subject_ref: userId,
    reason: 'Initial local platform administrator bootstrap',
  })

  console.log('✅ [bootstrap] Platform Super Admin successfully bootstrapped.')
  console.log('   Email:', SUPER_ADMIN_EMAIL)
  console.log('   Role: super_admin')
  console.log('   Tenant:', PLATFORM_TENANT_ID)
}

if (process.argv[1]?.endsWith('bootstrap-super-admin.mjs')) {
  bootstrap().catch((err) => {
    console.error('❌ [bootstrap] Uncaught error:', err)
    process.exit(1)
  })
}
