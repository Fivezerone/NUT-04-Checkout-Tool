#!/usr/bin/env node
/**
 * scripts/stage-pilot-fixtures.mjs
 *
 * De-identified staging identity fixtures
 * Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§9.5 Pilot Plan)
 *
 * Produces only the role and tenant identifiers required for local lifecycle
 * checks. Do not add person-style labels, clinical content, condition fields,
 * or target fixtures to this file.
 */

export const PILOT_FIXTURES = {
  tenant: {
    id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Fixture Tenant A',
    slug: 'fixture-tenant-a',
    status: 'active',
    data_residency_region: 'ke-nairobi',
    billing_email: 'tenant-a@fixture.test',
    config: {
      small_cell_k: 5,
      default_locale: 'en-KE',
    },
  },

  staff: [
    {
      user_id: 'b0000000-0000-0000-0000-000000000001',
      tenant_id: 'a0000000-0000-0000-0000-000000000001',
      role: 'writing_clinician',
      licence_verified: true,
    },
    {
      user_id: 'b0000000-0000-0000-0000-000000000002',
      tenant_id: 'a0000000-0000-0000-0000-000000000001',
      role: 'viewing_dietician',
      licence_verified: true,
    },
    {
      user_id: 'b0000000-0000-0000-0000-000000000003',
      tenant_id: 'a0000000-0000-0000-0000-000000000001',
      role: 'tenant_admin',
    },
  ],
}

if (process.argv[1]?.endsWith('stage-pilot-fixtures.mjs')) {
  console.log('[stage-pilot] Staging de-identified identity fixtures:')
  console.log(`- Tenant: ${PILOT_FIXTURES.tenant.name} (${PILOT_FIXTURES.tenant.id})`)
  console.log(`- Staff members: ${PILOT_FIXTURES.staff.length}`)
  console.log('✅ [stage-pilot] De-identified fixtures staged successfully.')
}
