/**
 * entitlement Edge Function
 *
 * Issues a signed ES256 JWT when the caller is premium.
 * config.toml: verify_jwt = true  (Supabase validates the Supabase JWT first)
 * We also re-validate with auth.getUser() in code for defense in depth.
 *
 * Returns:
 *   { tier: "premium", token, premium_expires_at, server_now }
 *   { tier: "basic", server_now }
 */

import { serve } from '@std/http'
import { createClient } from '@supabase/supabase-js'
import { importJWK, SignJWT } from 'jose'
import { corsHeaders, jsonError } from '../_shared/cors.ts'

serve(async (req) => {
  const headers = corsHeaders(req)
  if (!headers) return new Response('Forbidden', { status: 403 })

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    // Defense in depth: verify the caller's JWT (Supabase already did, but re-check)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError(401, 'UNAUTHORIZED', headers)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return jsonError(401, 'UNAUTHORIZED', headers)

    const serverNow = new Date().toISOString()

    // Load premium_expires_at for this user
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('premium_expires_at')
      .eq('id', user.id)
      .single()

    if (userError) throw new Error(`User lookup failed: ${userError.message}`)

    const premiumExpiresAt: string | null = userData?.premium_expires_at ?? null
    const isPremium = premiumExpiresAt !== null && new Date(premiumExpiresAt) > new Date()

    if (!isPremium) {
      return new Response(JSON.stringify({ tier: 'basic', server_now: serverNow }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // Sign a JWT for the premium user
    const privateJwkStr = Deno.env.get('ENTITLEMENT_SIGNING_KEY')
    if (!privateJwkStr) throw new Error('ENTITLEMENT_SIGNING_KEY not set')

    const privateJwk = JSON.parse(privateJwkStr)
    const kid = privateJwk.kid ?? 'entitlement-v1'

    const privateKey = await importJWK(privateJwk, 'ES256')

    const expSeconds = Math.floor(new Date(premiumExpiresAt).getTime() / 1000)

    const token = await new SignJWT({
      tier: 'premium',
      iss: 'nutriscore-entitlement',
      sub: user.id,
    })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuedAt()
      .setExpirationTime(expSeconds)
      .sign(privateKey)

    return new Response(
      JSON.stringify({
        tier: 'premium',
        token,
        premium_expires_at: premiumExpiresAt,
        server_now: serverNow,
      }),
      { headers: { ...headers, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error) {
    const requestId = crypto.randomUUID()
    console.error('[entitlement]', { requestId, error })
    return jsonError(500, 'ENTITLEMENT_INTERNAL_ERROR', headers)
  }
})
