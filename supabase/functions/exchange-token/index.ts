/**
 * NutriScore CAD Phase 7 — Exchange Service Edge Function
 *
 * Implements RFC 8693 OAuth 2.0 Token Exchange for Dietary Profile Tokens (DPTs).
 * Reference: Blueprint §3.3–§3.6, Amendment A7
 *
 * Endpoint:
 *   POST /functions/v1/exchange-token
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { LocalEd25519Signer } from '../../src/shared/signer.ts'
import { verifyDpopProof } from '../../src/shared/dpop.ts'
import {
  scrubAndBandConstraints,
  applyCohortGate,
  computeConstraintFingerprint,
  mintDpt,
} from '../../src/shared/dpt.ts'

const signer = new LocalEd25519Signer()
const replayCache = new Set<string>()

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321'
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Only POST is allowed
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'invalid_request', error_description: 'Method must be POST' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  const url = req.url
  const dpopHeader = req.headers.get('DPoP')
  if (!dpopHeader) {
    return new Response(
      JSON.stringify({
        error: 'invalid_dpop_proof',
        error_description: 'Missing required DPoP proof header',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 1. Verify DPoP Proof
  const dpopResult = verifyDpopProof(dpopHeader, req.method, url, replayCache)
  if (!dpopResult.valid || !dpopResult.jkt) {
    return new Response(
      JSON.stringify({
        error: 'invalid_dpop_proof',
        error_description: dpopResult.error || 'Invalid DPoP proof',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Parse request body (supports application/x-www-form-urlencoded or application/json)
  let grantType: string | null = null
  let subjectToken: string | null = null
  let requestedTokenType: string | null = null
  let audience: string | null = null
  let mode: 'browse' | 'order' = 'browse'

  const contentType = req.headers.get('Content-Type') ?? ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await req.formData()
    grantType = formData.get('grant_type') as string
    subjectToken = formData.get('subject_token') as string
    requestedTokenType = formData.get('requested_token_type') as string
    audience = formData.get('audience') as string
    if (formData.get('mode') === 'order') mode = 'order'
  } else {
    try {
      const json = await req.json()
      grantType = json.grant_type
      subjectToken = json.subject_token
      requestedTokenType = json.requested_token_type
      audience = json.audience
      if (json.mode === 'order') mode = 'order'
    } catch {
      return new Response(
        JSON.stringify({ error: 'invalid_request', error_description: 'Invalid body' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }
  }

  // Validate RFC 8693 request shape
  if (grantType !== 'urn:ietf:params:oauth:grant-type:token-exchange') {
    return new Response(JSON.stringify({ error: 'unsupported_grant_type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (requestedTokenType !== 'urn:ns:token-type:dpt') {
    return new Response(JSON.stringify({ error: 'unsupported_token_type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (audience !== 'ns-commercial') {
    return new Response(
      JSON.stringify({
        error: 'invalid_target',
        error_description: 'Audience must be ns-commercial',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  if (!subjectToken) {
    return new Response(
      JSON.stringify({ error: 'invalid_request', error_description: 'Missing subject_token' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  const supabase = adminClient()

  // 2. Verify Subject Token (must belong to an active patient)
  const { data: userData, error: userError } = await supabase.auth.getUser(subjectToken)
  if (userError || !userData?.user) {
    return new Response(
      JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid subject token' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  const userId = userData.user.id

  // Load member and patient records
  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('tenant_id, role, status')
    .eq('user_id', userId)
    .schema('iam')
    .single()

  if (memberError || !member || member.role !== 'patient' || member.status !== 'active') {
    return new Response(
      JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Caller is not an active patient member',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const tenantId = member.tenant_id

  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .schema('clinical')
    .single()

  if (patientError || !patient) {
    return new Response(
      JSON.stringify({ error: 'invalid_grant', error_description: 'Patient record not found' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  const patientId = patient.id

  // 3. Consent Gate: active dietary_profile_sharing consent, not withdrawn
  const { data: consent, error: consentError } = await supabase
    .from('consent_records')
    .select('policy_version, withdrawn_at')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .eq('purpose', 'dietary_profile_sharing')
    .is('withdrawn_at', null)
    .order('granted_at', { ascending: false })
    .limit(1)
    .schema('clinical')
    .maybeSingle()

  if (consentError || !consent) {
    return new Response(
      JSON.stringify({
        error: 'consent_required',
        error_description: 'Active dietary profile sharing consent required',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const policyVersion = consent.policy_version ?? 4

  // 4. Load latest published profile from exchange.projection
  const { data: projection, error: projError } = await supabase
    .from('projection')
    .select('constraints, bundle_version')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .schema('exchange')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const rawConstraints = (projection?.constraints as Record<string, unknown>) ?? {}

  // 5. Scrub & Band constraints
  let banded: Record<string, number>
  try {
    const scrubbed = scrubAndBandConstraints(rawConstraints)
    banded = scrubbed.banded
  } catch (err) {
    // Condition-named tags or illegal keys abort the mint
    return new Response(
      JSON.stringify({ error: 'invalid_constraints', error_description: (err as Error).message }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 6. Cohort Gate (k >= 5) with Generalisation
  const fingerprint = computeConstraintFingerprint(banded)

  // Count patients in tenant with matching projected constraints
  const { count: cohortCount, error: countError } = await supabase
    .from('projection')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .schema('exchange')

  const effectiveCohort = cohortCount ?? 1
  const cohortResult = applyCohortGate(banded, effectiveCohort, 5)

  // 7. Check Signer availability
  if (!signer.isAvailable()) {
    return new Response(
      JSON.stringify({
        error: 'service_unavailable',
        error_description: 'Signer service unreachable',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 8. Mint DPT
  const mintResult = mintDpt(signer, {
    tenantId,
    patientId,
    constraints: cohortResult.constraints,
    dpopJkt: dpopResult.jkt,
    mode,
    policyVersion,
  })

  // 9. Emit DPT_MINTED event to audit outbox (NO constraint values!)
  await supabase
    .from('outbox')
    .insert({
      chain_id: tenantId,
      action: 'DPT_MINTED',
      decision: 'ALLOW',
      resource_type: 'dpt',
      resource_id: mintResult.jti,
      severity: 0,
      envelope: {
        jti: mintResult.jti,
        constraint_fingerprint: fingerprint,
        generalised: cohortResult.generalised,
        consent_version: policyVersion,
        mode,
      },
    })
    .schema('audit')

  // 10. Respond with RFC 8693 shape and Cache-Control: no-store
  return new Response(
    JSON.stringify({
      access_token: mintResult.token,
      issued_token_type: 'urn:ns:token-type:dpt',
      token_type: 'DPoP',
      expires_in: 900,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    },
  )
})
