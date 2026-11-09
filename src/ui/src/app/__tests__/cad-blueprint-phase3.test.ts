import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, '')
const migration = readFileSync(
  resolve(ROOT, 'supabase/migrations/20261101020000_grant_matrix_lifecycle.sql'),
  'utf8',
)
const claimsMigration = readFileSync(
  resolve(ROOT, 'supabase/migrations/20261101010000_canonical_claims_and_revocation.sql'),
  'utf8',
)
const provisioningFunction = readFileSync(
  resolve(ROOT, 'supabase/functions/admin-provision-user/index.ts'),
  'utf8',
)
const userManagementView = readFileSync(
  resolve(ROOT, 'src/ui/src/cad/views/UserManagementView.tsx'),
  'utf8',
)
const identitySeed = readFileSync(resolve(ROOT, 'scripts/seed-mock-users.mjs'), 'utf8')
const pilotFixtures = readFileSync(resolve(ROOT, 'scripts/stage-pilot-fixtures.mjs'), 'utf8')
const mockPurge = readFileSync(resolve(ROOT, 'scripts/purge-mocks.mjs'), 'utf8')

const roles = [
  'super_admin',
  'tenant_admin',
  'writing_clinician',
  'viewing_dietician',
  'compliance_auditor',
  'commercial_stakeholder',
  'patient',
]
const scopes = ['platform', 'tenant', 'own_patients']
const expectedGrants = new Set([
  'super_admin:tenant_admin:platform',
  'super_admin:compliance_auditor:platform',
  'super_admin:commercial_stakeholder:platform',
  'tenant_admin:writing_clinician:tenant',
  'tenant_admin:viewing_dietician:tenant',
  'tenant_admin:compliance_auditor:tenant',
  'tenant_admin:patient:tenant',
  'writing_clinician:patient:own_patients',
])

function migrationGrants(source: string): Set<string> {
  const grantStatements = [...source.matchAll(/INSERT INTO iam\.role_grants[\s\S]*?ON CONFLICT/g)]
    .map(([statement]) => statement)
    .join('\n')
  return new Set(
    [...grantStatements.matchAll(/\('([^']+)',\s*'([^']+)',\s*'(platform|tenant|own_patients)'\)/g)].map(
      ([, grantor, grantee, scope]) => `${grantor}:${grantee}:${scope}`,
    ),
  )
}

describe('CAD blueprint Phase 3 grant-matrix provisioning', () => {
  it('allows exactly every grant-table tuple and denies every other role/scope combination', () => {
    const grants = migrationGrants(`${claimsMigration}\n${migration}`)
    expect(grants).toEqual(expectedGrants)

    for (const caller of roles) {
      for (const target of roles) {
        for (const scope of scopes) {
          const tuple = `${caller}:${target}:${scope}`
          expect(grants.has(tuple), tuple).toBe(expectedGrants.has(tuple))
        }
      }
    }
  })

  it('uses the matrix rather than role order and keeps cross-tenant creation denied', () => {
    expect(provisioningFunction).toContain("admin.rpc('provisioning_grant_exists'")
    expect(provisioningFunction).toContain("targetTenantId !== claims.tenantId")
    expect(provisioningFunction).toContain("targetRole === 'super_admin'")
    const forbiddenRankTokens = [
      `${'caller'}${'Rank'}`,
      `${'target'}${'Rank'}`,
      `${'ROLE_'}${'HIERARCHY'}`,
      `${'ROLE_'}${'RANK'}`,
    ]
    expect(provisioningFunction).not.toMatch(new RegExp(forbiddenRankTokens.join('|')))
  })

  it('enforces the stakeholder authority boundary in the database, edge, and CAD UI', () => {
    expect(migration).toContain("DELETE FROM iam.role_grants\nWHERE grantor_role = 'tenant_admin' AND grantee_role = 'commercial_stakeholder'")
    expect(migration).toContain("('super_admin', 'commercial_stakeholder', 'platform')")
    expect(migration).toContain('members_partner_org_check')
    expect(migration).toContain("target.role = 'commercial_stakeholder' AND p_new_status <> 'suspended'")
    expect(migration).toContain("'AUTHZ_DENY'")
    expect(migration).toContain("'GRANT_MATRIX'")
    expect(migration).toContain("set_config('response.status', '403', true)")
    expect(migration).toContain('IF NOT app_private.is_active_member() THEN')
    expect(provisioningFunction).toContain("'PROVISION_COMMERCIAL_STAKEHOLDER'")
    expect(provisioningFunction).toContain("callerDb.rpc('deactivate_tenant_member'")
    expect(provisioningFunction).toContain("callerDb.rpc('update_tenant_member_role'")
    expect(provisioningFunction).toContain("admin.rpc('edge_token_is_denied'")

    const tenantAdminRoles = userManagementView.slice(
      userManagementView.indexOf('tenant_admin:'),
      userManagementView.indexOf('writing_clinician:'),
    )
    expect(tenantAdminRoles).not.toContain('commercial_stakeholder')
  })

  it('limits platform auditors to DHA or ODPC and keeps them outside tenant membership', () => {
    expect(migration).toContain("regulator_body text CHECK (regulator_body IN ('DHA', 'ODPC'))")
    expect(migration).toContain("auditor_scope = 'platform'")
    expect(migration).toContain('length(btrim(mandate_ref)) > 0')
    expect(provisioningFunction).toContain("const REGULATOR_BODIES = new Set(['DHA', 'ODPC'])")
    expect(provisioningFunction).toContain("admin.rpc('create_platform_member'")
    expect(provisioningFunction).toContain('if (isPlatformAuditor)')
    expect(userManagementView).toContain('Digital Health Agency (DHA)')
    expect(userManagementView).toContain('Office of the Data Protection Commissioner (ODPC)')
  })

  it('uses a de-identified, condition-free mock fixture contract', () => {
    for (const email of [
      'regulator.dha@platform.test',
      'regulator.odpc@platform.test',
      'partner.stakeholder@clinic.test',
    ]) {
      expect(identitySeed).toContain(email)
    }

    expect(identitySeed).not.toMatch(/Alice Mumo|Joseph Mwangi|Grace Wanjiku|David Kiprono|Sarah Achieng/)
    expect(pilotFixtures).not.toMatch(/Omondi|Wanjiku|Mutua|diabetes|hypertension|renal/i)
    expect(identitySeed).not.toMatch(/\b(condition|metric|fullName|full_name)\s*:/)
    expect(identitySeed).not.toContain("from('audit_log').insert")
    expect(mockPurge).toContain("rpc('remove_platform_member'")
  })
})
