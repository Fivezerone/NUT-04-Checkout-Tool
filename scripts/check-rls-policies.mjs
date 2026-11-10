#!/usr/bin/env node
/**
 * scripts/check-rls-policies.mjs
 * CI guard for the CAD restrictive tenant wall.
 *
 * STAGE A (A-06): Migrated from supabase/migrations/ to db/migrations/.
 * Checks that every tenant-scoped relation has an explicit FORCE ROW LEVEL SECURITY
 * and a restrictive tenant_wall policy in the plain-Postgres migration files.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dirnameHere = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(dirnameHere, '..')
const migrationsDir = join(repoRoot, 'db', 'migrations')

if (!existsSync(migrationsDir)) {
  console.warn('[check-rls] db/migrations/ not found — skipping (expected before Stage C migration files are added).')
  process.exit(0)
}

const tenantRelations = [
  'iam.members',
  'audit.audit_log',
  'clinical.targets',
  'clinical.target_bundles',
  'clinical.consumption_diary',
  'clinical.consent_records',
  'clinical.patient_links',
  'clinical.consents',
  'clinical.health_modes',
  'clinical.health_mode_rules',
  'clinical.patients',
  'clinical.treatment_relationships',
  'clinical.dietary_tags',
  'clinical.clinical_records',
  'clinical.clinical_advice',
  'clinical.emergency_grants',
  'clinical.retention_policies',
  'clinical.published_profiles',
  'clinical.patient_keys',
  'exchange.projection',
  'exchange.alias_map',
  'commercial.sku_mappings',
  'commercial.orders',
  'commercial.order_lines',
]

const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()

if (migrationFiles.length === 0) {
  console.warn('[check-rls] No .sql files in db/migrations/ — skipping.')
  process.exit(0)
}

const combinedSql = migrationFiles
  .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
  .join('\n\n')

const errors = []
for (const relation of tenantRelations) {
  const escaped = relation.replace('.', '\\.')
  const wallCall = new RegExp(
    `SELECT\\s+app_private\\.apply_tenant_wall\\(\\s*'${escaped}'\\s*\\)`,
    'i',
  )
  if (!wallCall.test(combinedSql)) {
    errors.push(`${relation} is missing an explicit restrictive tenant-wall application`)
  }
}

if (!/ALTER\s+TABLE\s+\S+\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(combinedSql)) {
  errors.push('No FORCE ROW LEVEL SECURITY found in migration files')
}
if (!/CREATE\s+POLICY\s+tenant_wall[\s\S]*?AS\s+RESTRICTIVE/i.test(combinedSql)) {
  errors.push('No restrictive tenant_wall policy found in migration files')
}

if (errors.length > 0) {
  console.error('❌ [check-rls] CAD tenant-wall violations detected:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(
  `✅ [check-rls] ${tenantRelations.length} tenant relations have explicit forced restrictive walls.`,
)
