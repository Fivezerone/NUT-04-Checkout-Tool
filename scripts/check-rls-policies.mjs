#!/usr/bin/env node
/**
 * CI guard for the CAD restrictive tenant wall.
 *
 * A live database test is kept in supabase/tests/cad_tenant_wall.sql. This
 * static companion fails fast whenever a migration omits the required forced,
 * restrictive wall for a Stage A tenant relation.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dirnameHere = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(dirnameHere, '..')
const migrationsDir = join(repoRoot, 'supabase', 'migrations')

const phaseOneTenantRelations = [
  'iam.members',
  'audit.legacy_audit_log',
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
  'public.users',
  'public.payments',
  'public.subscriptions',
  'public.invoices',
  'public.payment_attempts',
]

const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
const combinedSql = migrationFiles
  .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
  .join('\n\n')

const errors = []
for (const relation of phaseOneTenantRelations) {
  const escaped = relation.replace('.', '\\.')
  const wallCall = new RegExp(
    `SELECT\\s+app_private\\.apply_tenant_wall\\(\\s*'${escaped}'\\s*\\)`,
    'i',
  )
  if (!wallCall.test(combinedSql)) {
    errors.push(`${relation} is missing an explicit restrictive tenant-wall application`)
  }
}

if (!/ALTER\s+TABLE\s+%s\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(combinedSql)) {
  errors.push('tenant-wall helper does not FORCE ROW LEVEL SECURITY')
}
if (!/CREATE\s+POLICY\s+tenant_wall[\s\S]*?AS\s+RESTRICTIVE/i.test(combinedSql)) {
  errors.push('tenant-wall helper does not create a restrictive tenant_wall policy')
}

if (errors.length > 0) {
  console.error('❌ [check-rls] CAD tenant-wall violations detected:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(
  `✅ [check-rls] ${phaseOneTenantRelations.length} tenant relations have explicit forced restrictive walls.`,
)
console.log('[check-rls] Live gate query is covered by supabase/tests/cad_tenant_wall.sql.')
