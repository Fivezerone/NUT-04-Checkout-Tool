// supabase/functions/break-glass/index.ts
// Emergency Break-Glass Endpoint & Review Workflow
// Reference: Blueprint §1.3, §4.2; Test Matrix §5.2 Break-glass

import { serve } from '@std/http'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { extractClaims } from '../_shared/rbac.ts'

function forbidden(cors: HeadersInit): Response {
  return new Response(JSON.stringify({ error: 'forbidden', message: 'Forbidden' }), {
    status: 403,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function badRequest(message: string, cors: HeadersInit): Response {
  return new Response(JSON.stringify({ error: 'bad_request', message }), {
    status: 400,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  const cors = corsHeaders(req) || {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-step-up, x-acr',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const claims = extractClaims(req)
  if (!claims?.sub) {
    return new Response(JSON.stringify({ error: 'unauthorized', message: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const authHeader = req.headers.get('Authorization') || ''

  // Caller client preserves caller JWT claims for RLS and auth_private helpers
  const callerDb = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  })

  try {
    const body = await req.json().catch(() => ({}))
    const action = body.action

    if (action === 'request') {
      // CMO / Tenant Admin only
      if (claims.appRole !== 'tenant_admin') {
        return forbidden(cors)
      }

      // Step-up authentication required (acr >= 2 or step-up header)
      const acrHeader = req.headers.get('x-acr') || req.headers.get('x-step-up')
      const acrValue = acrHeader ? Number(acrHeader) : 1
      const isStepUp = acrValue >= 2 || acrHeader === 'true'
      if (!isStepUp) {
        return forbidden(cors)
      }

      const { patientId, granteeId, incidentNo, reason, durationHours } = body
      if (!patientId || !granteeId || !incidentNo || !reason) {
        return badRequest('Missing required break-glass request parameters', cors)
      }

      // Reason encryption: in Stage A, convert string reason to hex/bytea payload
      const encoder = new TextEncoder()
      const reasonBytes = encoder.encode(reason)
      const reasonHex =
        '\\x' + Array.from(reasonBytes, (b) => b.toString(16).padStart(2, '0')).join('')

      const { data, error } = await callerDb.rpc('request_break_glass', {
        p_patient_id: patientId,
        p_grantee_id: granteeId,
        p_incident_no: incidentNo,
        p_reason_enc: reasonHex,
        p_duration_hours: durationHours || 24,
      })

      if (error) {
        return forbidden(cors)
      }

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'revoke') {
      if (claims.appRole !== 'tenant_admin') {
        return forbidden(cors)
      }

      const { grantId, reason } = body
      if (!grantId) {
        return badRequest('Missing grantId', cors)
      }

      const { data, error } = await callerDb.rpc('revoke_break_glass', {
        p_grant_id: grantId,
        p_reason: reason || 'Break-glass revoked by admin',
      })

      if (error) {
        return forbidden(cors)
      }

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'review') {
      if (claims.appRole !== 'tenant_admin' && claims.appRole !== 'compliance_auditor') {
        return forbidden(cors)
      }

      const { grantId, reviewState, notes } = body
      if (!grantId || !reviewState) {
        return badRequest('Missing grantId or reviewState', cors)
      }

      const { data, error } = await callerDb.rpc('review_break_glass', {
        p_grant_id: grantId,
        p_review_state: reviewState,
        p_notes: notes || null,
      })

      if (error) {
        return forbidden(cors)
      }

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return badRequest('Unknown break-glass action', cors)
  } catch (_err) {
    return forbidden(cors)
  }
})
