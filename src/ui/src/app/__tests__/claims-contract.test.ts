import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OidcCodePkceProvider, SupabaseAuthProvider } from '../../../../shared/auth-provider'
import { claimsFromAccessToken, canonicalizeClaims } from '../../../../shared/claims'
import { BAN_UNTIL_ISO, CLAIM_SCHEMA_VERSION } from '../../../../shared/constants'

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, '')

function tokenFor(payload: object): string {
  return `header.${btoa(JSON.stringify(payload))}.signature`
}

describe('canonical claims contract', () => {
  it('maps Supabase aliases to the canonical app-role contract', () => {
    expect(
      canonicalizeClaims({
        sub: '11111111-1111-1111-1111-111111111111',
        session_id: 'supabase-session',
        tenant_id: '22222222-2222-2222-2222-222222222222',
        app_role: 'writing_clinician',
        lic_ok: true,
        aal: 'aal2',
        ver: CLAIM_SCHEMA_VERSION,
      }),
    ).toEqual({
      sub: '11111111-1111-1111-1111-111111111111',
      sid: 'supabase-session',
      tenantId: '22222222-2222-2222-2222-222222222222',
      appRole: 'writing_clinician',
      licOk: true,
      acr: 'aal2',
      ver: CLAIM_SCHEMA_VERSION,
    })
  })

  it('accepts Keycloak-shaped canonical claims without provider-specific fields', () => {
    const claims = claimsFromAccessToken(
      tokenFor({
        sub: '11111111-1111-1111-1111-111111111111',
        sid: 'keycloak-session',
        tenant_id: '22222222-2222-2222-2222-222222222222',
        app_role: 'compliance_auditor',
        lic_ok: false,
        auditor_scope: 'platform',
        acr: '2',
        ver: CLAIM_SCHEMA_VERSION,
      }),
    )
    expect(claims?.sid).toBe('keycloak-session')
    expect(claims?.auditorScope).toBe('platform')
  })

  it('rejects a missing role, sid, or inappropriate auditor scope', () => {
    expect(canonicalizeClaims({ sub: 'user', sid: 'session', lic_ok: true })).toBeNull()
    expect(canonicalizeClaims({ sub: 'user', app_role: 'patient', lic_ok: false })).toBeNull()
    expect(
      canonicalizeClaims({
        sub: 'user',
        sid: 'session',
        app_role: 'patient',
        lic_ok: false,
        auditor_scope: 'tenant',
      }),
    ).toBeNull()
  })

  it('defines the application role and forbidden claims in the checked-in schema', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'src/shared/claims.schema.json'), 'utf8'))
    expect(schema.required).toEqual(expect.arrayContaining(['sub', 'sid', 'app_role', 'lic_ok', 'ver']))
    expect(schema.properties).not.toHaveProperty('email')
    expect(schema.properties).not.toHaveProperty('diagnosis')
    expect(schema.properties).not.toHaveProperty('health_mode')
  })
})

describe('auth provider seam', () => {
  it('uses the Supabase provider only through the contract interface', async () => {
    const token = tokenFor({
      sub: '11111111-1111-1111-1111-111111111111',
      sid: 'session',
      app_role: 'patient',
      lic_ok: false,
      ver: CLAIM_SCHEMA_VERSION,
    })
    const provider = new SupabaseAuthProvider(
      {
        auth: {
          signInWithPassword: async () => ({ data: { session: { access_token: token } }, error: null }),
          refreshSession: async () => ({ data: { session: { access_token: token } }, error: null }),
          getSession: async () => ({ data: { session: { access_token: token } } }),
          signOut: async () => ({ error: null }),
        },
      },
      claimsFromAccessToken,
    )
    await expect(provider.signInWithClinicCredentials({ email: 'patient@clinic.test', password: 'password' })).resolves.toMatchObject({ appRole: 'patient' })
    await expect(provider.refresh()).resolves.toMatchObject({ sid: 'session' })
    await expect(provider.currentClaims()).resolves.toMatchObject({ sub: '11111111-1111-1111-1111-111111111111' })
  })

  it('keeps the OIDC PKCE implementation inert before the Stage B cutover', async () => {
    const provider = new OidcCodePkceProvider()
    await expect(provider.currentClaims()).resolves.toBeNull()
    await expect(provider.signInWithClinicCredentials({ email: 'patient@clinic.test', password: 'password' })).rejects.toThrow('not configured')
  })
})

describe('single ban constant', () => {
  it('matches the SQL ban_until implementation exactly', () => {
    const migration = readFileSync(
      resolve(ROOT, 'supabase/migrations/20261101000000_cad_schema_foundation.sql'),
      'utf8',
    )
    expect(migration).toContain(`SELECT '${BAN_UNTIL_ISO}'::timestamptz`)
  })
})

describe('Stage B Keycloak realm and protocol mappers validation', () => {
  it('validates infra/keycloak-realm.json against canonical claims schema and roles', () => {
    const realmJsonPath = resolve(ROOT, 'infra/keycloak-realm.json')
    const realmData = JSON.parse(readFileSync(realmJsonPath, 'utf8'))

    expect(realmData.realm).toBe('nutriscore')
    expect(realmData.sslRequired).toBe('external')
    expect(realmData.bruteForceProtected).toBe(true)

    // Verify 7 canonical realm roles
    const roleNames = realmData.roles.realm.map((r: any) => r.name)
    const expectedRoles = [
      'super_admin',
      'tenant_admin',
      'writing_clinician',
      'viewing_dietician',
      'compliance_auditor',
      'commercial_stakeholder',
      'patient',
    ]
    expect(roleNames).toEqual(expect.arrayContaining(expectedRoles))

    // Verify ns-core client scope protocol mappers
    const nsCoreScope = realmData.clientScopes.find((s: any) => s.name === 'ns-core')
    expect(nsCoreScope).toBeDefined()

    const mapperClaimNames = nsCoreScope.protocolMappers.map((m: any) => m.config['claim.name'])
    expect(mapperClaimNames).toEqual(
      expect.arrayContaining(['tenant_id', 'app_role', 'lic_ok', 'auditor_scope', 'ver', 'sid']),
    )

    // Ensure zero forbidden claims are mapped
    expect(mapperClaimNames).not.toContain('email')
    expect(mapperClaimNames).not.toContain('diagnosis')
    expect(mapperClaimNames).not.toContain('health_mode')

    // Verify synthesized claims from mapper output parse cleanly through canonicalizeClaims
    const synthesizedClaims = {
      sub: '33333333-3333-3333-3333-333333333333',
      sid: 'kc-session-12345',
      tenant_id: '11111111-1111-1111-1111-111111111111',
      app_role: 'writing_clinician',
      lic_ok: true,
      ver: 1,
    }
    const parsed = canonicalizeClaims(synthesizedClaims)
    expect(parsed).toEqual({
      sub: '33333333-3333-3333-3333-333333333333',
      sid: 'kc-session-12345',
      tenantId: '11111111-1111-1111-1111-111111111111',
      appRole: 'writing_clinician',
      licOk: true,
      ver: 1,
    })
  })
})

