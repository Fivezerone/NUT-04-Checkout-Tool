#!/usr/bin/env node
/**
 * scripts/check-rls-policies.mjs
 *
 * Implements CAD Implementation Plan §5.2 and Test T11:
 * "New table added without RLS -> CI build fails"
 *
 * Parses SQL migrations in supabase/migrations/ to verify that:
 * 1. Every table defined with a `tenant_id` column explicitly has ROW LEVEL SECURITY enabled.
 * 2. Every table with `tenant_id` has at least one RLS policy defined.
 */

import { readFileSync, readdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations')

function checkRLSPolicies() {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const combinedSql = migrationFiles
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    .join('\n\n')

  // Find all CREATE TABLE statements
  const createTableRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);/gi

  const tenantTables = new Set()
  let match

  while ((match = createTableRegex.exec(combinedSql)) !== null) {
    const tableName = match[1].toLowerCase()
    const tableBody = match[2]

    // Check if table contains tenant_id or is the tenants table
    if (tableName === 'tenants' || /\btenant_id\b/i.test(tableBody)) {
      tenantTables.add(tableName)
    }
  }

  // Also check ALTER TABLE ... ADD COLUMN tenant_id
  const alterAddTenantIdRegex =
    /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?([a-zA-Z0-9_]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?tenant_id\b/gi

  while ((match = alterAddTenantIdRegex.exec(combinedSql)) !== null) {
    tenantTables.add(match[1].toLowerCase())
  }

  if (tenantTables.size === 0) {
    console.log('[check-rls] No tenant tables found yet.')
    return
  }

  console.log(
    `[check-rls] Found ${tenantTables.size} tenant-scoped table(s): ${Array.from(tenantTables).join(', ')}`,
  )

  const errors = []

  for (const table of tenantTables) {
    // Check for ENABLE ROW LEVEL SECURITY
    const rlsRegex = new RegExp(
      `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:public\\.)?${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      'i',
    )
    if (!rlsRegex.test(combinedSql)) {
      errors.push(`Table '${table}' has tenant_id but missing 'ENABLE ROW LEVEL SECURITY'`)
    }

    // Check for at least one CREATE POLICY on this table
    const policyRegex = new RegExp(
      `CREATE\\s+POLICY\\s+[a-zA-Z0-9_]+\\s+ON\\s+(?:public\\.)?${table}\\b`,
      'i',
    )
    if (!policyRegex.test(combinedSql)) {
      errors.push(`Table '${table}' has tenant_id but has no CREATE POLICY defined`)
    }
  }

  if (errors.length > 0) {
    console.error('\n❌ [check-rls] Security violations detected:')
    for (const err of errors) {
      console.error(`  - ${err}`)
    }
    process.exit(1)
  }

  console.log('✅ [check-rls] All tenant-scoped tables have RLS enabled and policies defined.')
}

checkRLSPolicies()
