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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { importJWK, SignJWT } from "https://esm.sh/jose@5"

// CORS: restrict to the extension origin in production.
// Chrome extension origin is chrome-extension://<id>; we also allow the
// dashboard origin for local dev. Both are set via the ALLOWED_ORIGINS secret.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? ""
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map(s => s.trim())
  const allow = allowed.includes(origin) ? origin : allowed[0] ?? "*"
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  }
}

serve(async (req) => {
  const headers = corsHeaders(req)

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    // Defense in depth: verify the caller's JWT (Supabase already did, but re-check)
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) throw new Error("Unauthorized")
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    )
    if (authError || !user) throw new Error("Unauthorized")

    const serverNow = new Date().toISOString()

    // Load premium_expires_at for this user
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("premium_expires_at")
      .eq("id", user.id)
      .single()

    if (userError) throw new Error(`User lookup failed: ${userError.message}`)

    const premiumExpiresAt: string | null = userData?.premium_expires_at ?? null
    const isPremium = premiumExpiresAt !== null && new Date(premiumExpiresAt) > new Date()

    if (!isPremium) {
      return new Response(
        JSON.stringify({ tier: "basic", server_now: serverNow }),
        { headers: { ...headers, "Content-Type": "application/json" }, status: 200 }
      )
    }

    // Sign a JWT for the premium user
    const privateJwkStr = Deno.env.get("ENTITLEMENT_SIGNING_KEY")
    if (!privateJwkStr) throw new Error("ENTITLEMENT_SIGNING_KEY not set")

    const privateJwk = JSON.parse(privateJwkStr)
    const kid = privateJwk.kid ?? "entitlement-v1"

    const privateKey = await importJWK(privateJwk, "ES256")

    const expSeconds = Math.floor(new Date(premiumExpiresAt).getTime() / 1000)

    const token = await new SignJWT({
      tier: "premium",
      iss: "nutriscore-entitlement",
      sub: user.id,
    })
      .setProtectedHeader({ alg: "ES256", kid })
      .setIssuedAt()
      .setExpirationTime(expSeconds)
      .sign(privateKey)

    return new Response(
      JSON.stringify({
        tier: "premium",
        token,
        premium_expires_at: premiumExpiresAt,
        server_now: serverNow,
      }),
      { headers: { ...headers, "Content-Type": "application/json" }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...headers, "Content-Type": "application/json" }, status: error.message === "Unauthorized" ? 401 : 500 }
    )
  }
})
