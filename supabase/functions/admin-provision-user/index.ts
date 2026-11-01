// Stage A provisioning service. The database grant matrix is the sole source
// of provisioning authority. All authorization denials are generic to callers
// and carry GRANT_MATRIX only in the audit ledger.

import { serve } from '@std/http'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { extractClaims, type CadRole } from '../_shared/rbac.ts'

type ProvisionScope = 'platform' | 'tenant' | 'own_patients'

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const REGULATOR_BODIES = new Set(['DHA', 'ODPC'])

function securePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*'
  return Array.from(
    crypto.getRandomValues(new Uint8Array(20)),
    (byte) => alphabet[byte % alphabet.length],
  ).join('')
}

function forbidden(cors: HeadersInit): Response {
  return new Response(JSON.stringify({ error: 'forbidden', message: 'Forbidden' }), {
    status: 403,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function badRequest(cors: HeadersInit): Response {
  return new Response(JSON.stringify({ error: 'bad_request', message: 'Invalid request' }), {
    status: 400,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function requestedScope(
  callerRole: CadRole,
  targetRole: CadRole,
  auditorScope: unknown,
): ProvisionScope {
  if (callerRole === 'writing_clinician' && targetRole === 'patient') return 'own_patients'
  if (callerRole === 'super_admin') return 'platform'
  if (targetRole === 'compliance_auditor' && auditorScope === 'platform') return 'platform'
  return 'tenant'
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
  // Keep the service credential for privileged writes, but forward the caller
  // token for lifecycle RPCs. Those SQL functions re-check app_role and tenant
  // from the actual request JWT on every transition.
  const callerDb = createClient(url, key, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  })

  const { data: tokenDenied, error: tokenCheckError } = await admin.rpc('edge_token_is_denied', {
    p_sid: claims.sid,
    p_sub: claims.sub,
  })
  if (tokenCheckError || tokenDenied === true) {
    return new Response(JSON.stringify({ error: 'unauthorized', message: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const auditDeny = async (tenantId: string | null | undefined) => {
    if (!tenantId) return
    await admin.from('audit_log').insert({
      tenant_id: tenantId,
      actor_id: claims.sub,
      actor_role: claims.appRole,
      action: 'AUTHZ_DENY',
      mutation_type: 'read',
      resource_type: 'Provisioning',
      reason: 'GRANT_MATRIX',
    })
  }

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return badRequest(cors)
    const action = body.action

    if (action === 'create_user') {
      const targetRole = body.role as CadRole
      const email = typeof body.email === 'string' ? body.email.trim() : ''
      const targetTenantId = typeof body.tenantId === 'string' ? body.tenantId : null
      const auditorScope = body.auditorScope
      const scope = requestedScope(claims.appRole, targetRole, auditorScope)
      const auditTenant = claims.tenantId || targetTenantId || PLATFORM_TENANT_ID

      const { data: permitted } = await admin.rpc('provisioning_grant_exists', {
        p_grantor: claims.appRole,
        p_grantee: targetRole,
        p_scope: scope,
      })
      if (!email || targetRole === 'super_admin' || !permitted) {
        await auditDeny(auditTenant)
        return forbidden(cors)
      }

      const isPlatformAuditor = targetRole === 'compliance_auditor' && auditorScope === 'platform'
      const isCommercialStakeholder = targetRole === 'commercial_stakeholder'
      const partnerOrg = typeof body.partnerOrg === 'string' ? body.partnerOrg.trim() : ''
      const regulatorBody = typeof body.regulatorBody === 'string' ? body.regulatorBody : ''
      const mandateRef = typeof body.mandateRef === 'string' ? body.mandateRef.trim() : ''
      const primaryClinicianId =
        typeof body.primaryClinicianId === 'string' ? body.primaryClinicianId : null

      if (
        (scope !== 'platform' &&
          (!claims.tenantId || (targetTenantId && targetTenantId !== claims.tenantId))) ||
        (scope === 'platform' && !isPlatformAuditor && !targetTenantId) ||
        (targetRole === 'patient' && !primaryClinicianId) ||
        (scope === 'own_patients' && primaryClinicianId !== claims.sub) ||
        (isCommercialStakeholder && (!targetTenantId || !partnerOrg)) ||
        (isPlatformAuditor && (!REGULATOR_BODIES.has(regulatorBody) || !mandateRef))
      ) {
        await auditDeny(auditTenant)
        return forbidden(cors)
      }

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
        app_metadata: isPlatformAuditor ? {} : { tenant_id: targetTenantId || claims.tenantId },
      })
      if (createError || !created.user) return badRequest(cors)

      const newUserId = created.user.id
      if (isPlatformAuditor) {
        const { error } = await admin.rpc('create_platform_member', {
          p_user_id: newUserId,
          p_role: targetRole,
          p_regulator_body: regulatorBody,
          p_mandate_ref: mandateRef,
          p_created_by: claims.sub,
        })
        if (error) {
          await admin.auth.admin.deleteUser(newUserId)
          return badRequest(cors)
        }
        await admin.from('audit_log').insert({
          tenant_id: PLATFORM_TENANT_ID,
          actor_id: claims.sub,
          actor_role: claims.appRole,
          action: 'PROVISION_PLATFORM_AUDITOR',
          mutation_type: 'create',
          resource_type: 'PlatformMember',
          resource_id: newUserId,
          reason: `REGULATOR:${regulatorBody};MANDATE:${mandateRef}`,
        })
      } else {
        const memberTenantId = targetTenantId || claims.tenantId
        const { error } = await admin.from('tenant_members').insert({
          tenant_id: memberTenantId,
          user_id: newUserId,
          role: targetRole,
          primary_clinician_id: primaryClinicianId,
          auditor_scope: targetRole === 'compliance_auditor' ? 'tenant' : null,
          licence_number: typeof body.licenceNumber === 'string' ? body.licenceNumber : null,
          licence_expiry: typeof body.licenceExpiry === 'string' ? body.licenceExpiry : null,
          licence_verified: false,
          status: 'invited',
          invited_by: claims.sub,
          partner_org: isCommercialStakeholder ? partnerOrg : null,
        })
        if (error) {
          await admin.auth.admin.deleteUser(newUserId)
          return badRequest(cors)
        }
        await admin.from('audit_log').insert({
          tenant_id: memberTenantId,
          actor_id: claims.sub,
          actor_role: claims.appRole,
          action: isCommercialStakeholder ? 'PROVISION_COMMERCIAL_STAKEHOLDER' : 'PROVISION_USER',
          mutation_type: 'create',
          resource_type: 'TenantMember',
          resource_id: newUserId,
          reason: isCommercialStakeholder ? `PARTNER_ORG:${partnerOrg}` : 'GRANT_MATRIX',
        })
      }

      return new Response(
        JSON.stringify({ success: true, userId: newUserId, role: targetRole, temporaryPassword }),
        { status: 201, headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    if (action === 'update_status') {
      const targetUserId = typeof body.userId === 'string' ? body.userId : ''
      const status = typeof body.status === 'string' ? body.status : ''
      const tenantId =
        claims.appRole === 'super_admin'
          ? typeof body.tenantId === 'string'
            ? body.tenantId
            : null
          : claims.tenantId
      if (!targetUserId || !tenantId || !['active', 'suspended', 'deactivated'].includes(status)) {
        await auditDeny(tenantId)
        return forbidden(cors)
      }
      const { data, error } = await callerDb.rpc('deactivate_tenant_member', {
        p_tenant_id: tenantId,
        p_target_user_id: targetUserId,
        p_new_status: status,
        p_reason: typeof body.reason === 'string' ? body.reason : '',
      })
      if (error || data?.success !== true) {
        return forbidden(cors)
      }
      return new Response(JSON.stringify({ success: true, result: data }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'update_role') {
      const targetUserId = typeof body.userId === 'string' ? body.userId : ''
      const newRole = body.newRole as CadRole
      const tenantId =
        claims.appRole === 'super_admin'
          ? typeof body.tenantId === 'string'
            ? body.tenantId
            : null
          : claims.tenantId
      if (!targetUserId || !tenantId || !newRole) {
        await auditDeny(tenantId)
        return forbidden(cors)
      }
      const { data, error } = await callerDb.rpc('update_tenant_member_role', {
        p_tenant_id: tenantId,
        p_target_user_id: targetUserId,
        p_new_role: newRole,
        p_partner_org: typeof body.partnerOrg === 'string' ? body.partnerOrg : null,
        p_reason: typeof body.reason === 'string' ? body.reason : '',
      })
      if (error || data?.success !== true) {
        return forbidden(cors)
      }
      return new Response(JSON.stringify({ success: true, result: data }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    await auditDeny(claims.tenantId || PLATFORM_TENANT_ID)
    return forbidden(cors)
  } catch {
    return new Response(JSON.stringify({ error: 'internal_error', message: 'Request failed' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
