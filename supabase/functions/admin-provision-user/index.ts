// supabase/functions/admin-provision-user/index.ts
// Provisioning & Lifecycle Edge Function for Clinic Admin Dashboard (CAD)
// Reference: CAD-Only Identity & Onboarding Rollback (Phase 2)

import { serve } from '@std/http'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { extractClaims, type CadRole } from '../_shared/rbac.ts'

export const ROLE_HIERARCHY: Record<CadRole, number> = {
  super_admin: 100,
  tenant_admin: 80,
  compliance_auditor: 70,
  writing_clinician: 60,
  viewing_dietician: 50,
  commercial_stakeholder: 40,
  patient: 10,
}

function generateSecurePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*'
  let pwd = ''
  for (let i = 0; i < 18; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return pwd
}

serve(async (req: Request) => {
  const originCors = corsHeaders(req) || {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: originCors })
  }

  try {
    const claims = extractClaims(req)
    if (!claims || !claims.userId) {
      return new Response(
        JSON.stringify({
          error: 'unauthorized',
          message: 'Missing or invalid Authorization token',
        }),
        { status: 401, headers: { ...originCors, 'Content-Type': 'application/json' } },
      )
    }

    const callerRank = ROLE_HIERARCHY[claims.role] ?? 0
    if (callerRank <= ROLE_HIERARCHY.patient) {
      return new Response(
        JSON.stringify({
          error: 'forbidden',
          message: 'Patients and unprivileged accounts cannot provision users',
        }),
        { status: 403, headers: { ...originCors, 'Content-Type': 'application/json' } },
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey)

    const body = await req.json().catch(() => ({}))
    const action = body.action || 'create_user'

    // =========================================================================
    // ACTION: create_user
    // =========================================================================
    if (action === 'create_user') {
      const {
        email,
        role: targetRole,
        tenantId: reqTenantId,
        primaryClinicianId,
        fullName,
        password: reqPassword,
        licenceNumber,
        licenceExpiry,
        status = 'active',
      } = body

      if (!email || !targetRole) {
        return new Response(
          JSON.stringify({ error: 'bad_request', message: 'email and role are required' }),
          { status: 400, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      // 1. Super admin role can NEVER be provisioned via an endpoint
      if (targetRole === 'super_admin') {
        return new Response(
          JSON.stringify({
            error: 'forbidden',
            message: 'Platform super_admin cannot be provisioned via API',
          }),
          { status: 403, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      // 2. Strict hierarchy invariant: callerRank > targetRank
      const targetRank = ROLE_HIERARCHY[targetRole as CadRole] ?? 0
      if (callerRank <= targetRank) {
        return new Response(
          JSON.stringify({
            error: 'forbidden',
            message: `Cannot grant role '${targetRole}' (rank ${targetRank}) with caller role '${claims.role}' (rank ${callerRank}). Caller may only provision roles strictly below their own.`,
          }),
          { status: 403, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      // Writing clinician can only provision patients
      if (claims.role === 'writing_clinician' && targetRole !== 'patient') {
        return new Response(
          JSON.stringify({
            error: 'forbidden',
            message: 'Writing clinicians may only provision patients under clinical oversight',
          }),
          { status: 403, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      // 3. Clinic scope invariant: non-super_admin can only provision for their own clinic
      let targetTenantId = reqTenantId
      if (claims.role !== 'super_admin') {
        if (reqTenantId && reqTenantId !== claims.tenantId) {
          return new Response(
            JSON.stringify({
              error: 'forbidden',
              message: 'Cross-tenant user provisioning is prohibited',
            }),
            { status: 403, headers: { ...originCors, 'Content-Type': 'application/json' } },
          )
        }
        targetTenantId = claims.tenantId
      } else if (!targetTenantId) {
        targetTenantId = claims.tenantId || '00000000-0000-0000-0000-000000000000'
      }

      // 4. Patient linking invariant: Patient MUST be bound to a primary clinician in that clinic
      let boundClinicianId = primaryClinicianId
      if (targetRole === 'patient') {
        if (!boundClinicianId) {
          if (claims.role === 'writing_clinician') {
            boundClinicianId = claims.userId
          } else {
            return new Response(
              JSON.stringify({
                error: 'bad_request',
                message:
                  'Patient must be linked to exactly one primary clinician (primaryClinicianId required)',
              }),
              { status: 400, headers: { ...originCors, 'Content-Type': 'application/json' } },
            )
          }
        }

        // Verify that the assigned primary clinician exists and belongs to the clinic
        const { data: clinicianMember, error: clinErr } = await adminClient
          .from('tenant_members')
          .select('user_id, role, status')
          .eq('tenant_id', targetTenantId)
          .eq('user_id', boundClinicianId)
          .maybeSingle()

        if (clinErr || !clinicianMember || clinicianMember.status !== 'active') {
          return new Response(
            JSON.stringify({
              error: 'bad_request',
              message: 'Invalid primary clinician: must be an active clinician in the clinic',
            }),
            { status: 400, headers: { ...originCors, 'Content-Type': 'application/json' } },
          )
        }
      }

      // 5. Create Auth User via Supabase Admin API
      const temporaryPassword = reqPassword || generateSecurePassword()
      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          full_name: fullName || email.split('@')[0],
          force_password_change: true,
        },
        app_metadata: {
          role: targetRole,
          tenant_id: targetTenantId,
          primary_clinician_id: boundClinicianId || null,
          account_status: status,
        },
      })

      if (authError || !authData.user) {
        return new Response(
          JSON.stringify({
            error: 'provisioning_failed',
            message: authError?.message || 'Failed to create authentication identity',
          }),
          { status: 400, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      const newUserId = authData.user.id

      // 6. Insert into public.users
      const { error: userInsertErr } = await adminClient.from('users').upsert({
        id: newUserId,
        email,
        full_name: fullName || email.split('@')[0],
        tenant_id: targetTenantId,
        role: targetRole,
      })

      if (userInsertErr) {
        console.error('Failed to create public.users record:', userInsertErr)
      }

      // 7. Insert into public.tenant_members
      const { error: memberInsertErr } = await adminClient.from('tenant_members').insert({
        tenant_id: targetTenantId,
        user_id: newUserId,
        email,
        role: targetRole,
        primary_clinician_id: boundClinicianId || null,
        licence_number: licenceNumber || null,
        licence_expiry: licenceExpiry || null,
        licence_verified: false,
        status,
        invited_by: claims.userId,
      })

      if (memberInsertErr) {
        console.error('Failed to insert tenant_members row:', memberInsertErr)
        return new Response(
          JSON.stringify({ error: 'db_error', message: memberInsertErr.message }),
          { status: 500, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      // 8. Record in audit_log
      const encoder = new TextEncoder()
      await adminClient.from('audit_log').insert({
        tenant_id: targetTenantId,
        actor_id: claims.userId,
        actor_role: claims.role,
        action: 'PROVISION_USER',
        mutation_type: 'create',
        resource_type: 'TenantMember',
        resource_id: newUserId,
        subject_ref: newUserId,
        reason: `Provisioned ${targetRole} (${email}) by ${claims.role}`,
        after_snapshot: encoder.encode(
          JSON.stringify({
            userId: newUserId,
            email,
            role: targetRole,
            tenant_id: targetTenantId,
            primary_clinician_id: boundClinicianId,
            status,
          }),
        ),
      })

      return new Response(
        JSON.stringify({
          success: true,
          userId: newUserId,
          email,
          role: targetRole,
          tenantId: targetTenantId,
          primaryClinicianId: boundClinicianId,
          status,
          temporaryPassword,
        }),
        { status: 201, headers: { ...originCors, 'Content-Type': 'application/json' } },
      )
    }

    // =========================================================================
    // ACTION: update_status (suspend / deactivate / activate)
    // =========================================================================
    if (action === 'update_status') {
      const { userId: targetUserId, status: newStatus, reason = '' } = body

      if (!targetUserId || !newStatus) {
        return new Response(
          JSON.stringify({ error: 'bad_request', message: 'userId and status are required' }),
          { status: 400, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      if (!['active', 'suspended', 'deactivated'].includes(newStatus)) {
        return new Response(JSON.stringify({ error: 'bad_request', message: 'Invalid status' }), {
          status: 400,
          headers: { ...originCors, 'Content-Type': 'application/json' },
        })
      }

      // Fetch target member details to check hierarchy
      const { data: targetMember, error: memberErr } = await adminClient
        .from('tenant_members')
        .select('*')
        .eq('user_id', targetUserId)
        .maybeSingle()

      if (memberErr || !targetMember) {
        return new Response(JSON.stringify({ error: 'not_found', message: 'Member not found' }), {
          status: 404,
          headers: { ...originCors, 'Content-Type': 'application/json' },
        })
      }

      // Clinic scope check
      if (claims.role !== 'super_admin' && targetMember.tenant_id !== claims.tenantId) {
        return new Response(
          JSON.stringify({
            error: 'forbidden',
            message: 'Cannot modify member outside your clinic',
          }),
          { status: 403, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      // Hierarchy check: caller must outrank target user
      const targetRank = ROLE_HIERARCHY[targetMember.role as CadRole] ?? 0
      if (callerRank <= targetRank) {
        return new Response(
          JSON.stringify({
            error: 'forbidden',
            message: 'Cannot modify status of a user with equal or higher rank',
          }),
          { status: 403, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      // Call database procedure deactivate_tenant_member
      const { data: rpcData, error: rpcErr } = await adminClient.rpc('deactivate_tenant_member', {
        p_tenant_id: targetMember.tenant_id,
        p_target_user_id: targetUserId,
        p_new_status: newStatus,
        p_reason: reason || `Status changed to ${newStatus} by ${claims.role}`,
      })

      if (rpcErr) {
        return new Response(JSON.stringify({ error: 'rpc_error', message: rpcErr.message }), {
          status: 500,
          headers: { ...originCors, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ success: true, result: rpcData }), {
        status: 200,
        headers: { ...originCors, 'Content-Type': 'application/json' },
      })
    }

    // =========================================================================
    // ACTION: update_role
    // =========================================================================
    if (action === 'update_role') {
      const { userId: targetUserId, newRole, reason = '' } = body

      if (!targetUserId || !newRole) {
        return new Response(
          JSON.stringify({ error: 'bad_request', message: 'userId and newRole are required' }),
          { status: 400, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      if (newRole === 'super_admin') {
        return new Response(
          JSON.stringify({ error: 'forbidden', message: 'Cannot assign super_admin role via API' }),
          { status: 403, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      const newRoleRank = ROLE_HIERARCHY[newRole as CadRole] ?? 0
      if (callerRank <= newRoleRank) {
        return new Response(
          JSON.stringify({
            error: 'forbidden',
            message: 'Cannot grant role equal to or higher than caller rank',
          }),
          { status: 403, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      const { data: targetMember, error: memberErr } = await adminClient
        .from('tenant_members')
        .select('*')
        .eq('user_id', targetUserId)
        .maybeSingle()

      if (memberErr || !targetMember) {
        return new Response(JSON.stringify({ error: 'not_found', message: 'Member not found' }), {
          status: 404,
          headers: { ...originCors, 'Content-Type': 'application/json' },
        })
      }

      if (claims.role !== 'super_admin' && targetMember.tenant_id !== claims.tenantId) {
        return new Response(
          JSON.stringify({
            error: 'forbidden',
            message: 'Cannot modify member outside your clinic',
          }),
          { status: 403, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      const currentRank = ROLE_HIERARCHY[targetMember.role as CadRole] ?? 0
      if (callerRank <= currentRank) {
        return new Response(
          JSON.stringify({
            error: 'forbidden',
            message: 'Cannot modify role of equal or superior user',
          }),
          { status: 403, headers: { ...originCors, 'Content-Type': 'application/json' } },
        )
      }

      // Update tenant_members
      await adminClient
        .from('tenant_members')
        .update({ role: newRole })
        .eq('tenant_id', targetMember.tenant_id)
        .eq('user_id', targetUserId)

      // Update users
      await adminClient.from('users').update({ role: newRole }).eq('id', targetUserId)

      // Update auth app_metadata
      await adminClient.auth.admin.updateUserById(targetUserId, {
        app_metadata: { role: newRole },
      })

      // Global session revocation on role change
      await adminClient.from('auth.sessions').delete().eq('user_id', targetUserId)
      await adminClient.from('auth.refresh_tokens').delete().eq('user_id', targetUserId)

      // Record in audit log
      const encoder = new TextEncoder()
      await adminClient.from('audit_log').insert({
        tenant_id: targetMember.tenant_id,
        actor_id: claims.userId,
        actor_role: claims.role,
        action: 'UPDATE_ROLE',
        mutation_type: 'update',
        resource_type: 'TenantMember',
        resource_id: targetUserId,
        subject_ref: targetUserId,
        reason: reason || `Role changed from ${targetMember.role} to ${newRole} by ${claims.role}`,
        before_snapshot: encoder.encode(JSON.stringify(targetMember)),
        after_snapshot: encoder.encode(JSON.stringify({ ...targetMember, role: newRole })),
      })

      return new Response(
        JSON.stringify({
          success: true,
          userId: targetUserId,
          oldRole: targetMember.role,
          newRole,
        }),
        { status: 200, headers: { ...originCors, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ error: 'bad_request', message: `Unknown action: ${action}` }),
      { status: 400, headers: { ...originCors, 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'internal_error', message: err?.message || 'Server error' }),
      { status: 500, headers: { ...originCors, 'Content-Type': 'application/json' } },
    )
  }
})
