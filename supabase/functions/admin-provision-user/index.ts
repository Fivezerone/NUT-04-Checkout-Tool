// Stage A provisioning service. Provisioning authority is exclusively the
// iam.role_grants matrix; display order is never an authorization input.

import { serve } from '@std/http'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { extractClaims, type CadRole } from '../_shared/rbac.ts'

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

function genericForbidden(cors: HeadersInit): Response {
  return new Response(JSON.stringify({ error: 'forbidden', message: 'Forbidden' }), {
    status: 403,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function securePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

async function permitted(
  client: ReturnType<typeof createClient>,
  grantorRole: CadRole,
  granteeRole: CadRole,
  scope: 'platform' | 'tenant' | 'own_patients',
): Promise<boolean> {
  const { data, error } = await client
    .schema('iam')
    .from('role_grants')
    .select('grantor_role')
    .eq('grantor_role', grantorRole)
    .eq('grantee_role', granteeRole)
    .eq('scope', scope)
    .maybeSingle()
  return !error && Boolean(data)
}

serve(async (req: Request) => {
  const cors = corsHeaders(req) || {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const claims = extractClaims(req)
  if (!claims) {
    return new Response(JSON.stringify({ error: 'unauthorized', message: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key)
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: cors })
  const admin = createClient(url, key)

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'bad_request', message: 'Invalid request' }), {
        status: 400,
        headers: cors,
      })
    }

    if (body.action !== 'create_user') return genericForbidden(cors)
    const targetRole = body.role as CadRole
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    if (!email || !targetRole || targetRole === 'super_admin') return genericForbidden(cors)

    const requestedTenant = typeof body.tenantId === 'string' ? body.tenantId : null
    const scope =
      claims.appRole === 'writing_clinician' && targetRole === 'patient'
        ? 'own_patients'
        : claims.appRole === 'super_admin'
          ? 'platform'
          : 'tenant'
    if (!(await permitted(admin, claims.appRole, targetRole, scope))) return genericForbidden(cors)

    const targetTenantId =
      scope === 'platform'
        ? requestedTenant || claims.tenantId || PLATFORM_TENANT_ID
        : claims.tenantId
    if (
      !targetTenantId ||
      (scope !== 'platform' && requestedTenant && requestedTenant !== claims.tenantId)
    ) {
      return genericForbidden(cors)
    }

    const primaryClinicianId =
      typeof body.primaryClinicianId === 'string' ? body.primaryClinicianId : null
    if (targetRole === 'patient' && !primaryClinicianId) {
      return new Response(
        JSON.stringify({ error: 'bad_request', message: 'Patient linkage is required' }),
        { status: 400, headers: cors },
      )
    }
    if (scope === 'own_patients' && primaryClinicianId !== claims.sub) return genericForbidden(cors)

    const temporaryPassword =
      typeof body.password === 'string' && body.password.length >= 16
        ? body.password
        : securePassword()
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: typeof body.fullName === 'string' ? body.fullName : undefined,
        force_password_change: true,
      },
      app_metadata: { tenant_id: targetTenantId },
    })
    if (createError || !created.user) {
      return new Response(
        JSON.stringify({ error: 'provisioning_failed', message: 'Provisioning failed' }),
        { status: 400, headers: cors },
      )
    }

    const { error: memberError } = await admin
      .schema('iam')
      .from('members')
      .insert({
        tenant_id: targetTenantId,
        user_id: created.user.id,
        role: targetRole,
        primary_clinician_id: primaryClinicianId,
        licence_number: typeof body.licenceNumber === 'string' ? body.licenceNumber : null,
        licence_expiry: typeof body.licenceExpiry === 'string' ? body.licenceExpiry : null,
        licence_verified: false,
        status: 'invited',
        invited_by: claims.sub,
      })
    if (memberError) {
      await admin.auth.admin.deleteUser(created.user.id)
      return new Response(
        JSON.stringify({ error: 'provisioning_failed', message: 'Provisioning failed' }),
        { status: 400, headers: cors },
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        userId: created.user.id,
        tenantId: targetTenantId,
        role: targetRole,
        temporaryPassword,
      }),
      { status: 201, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  } catch {
    return new Response(JSON.stringify({ error: 'internal_error', message: 'Request failed' }), {
      status: 500,
      headers: cors,
    })
  }
})
