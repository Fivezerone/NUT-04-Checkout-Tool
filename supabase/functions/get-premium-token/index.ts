import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error("Unauthorized")
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) throw new Error("Unauthorized")

    // Check premium status in DB
    const { data: profile, error: dbError } = await supabase
      .from('users')
      .select('is_premium, subscription_status')
      .eq('id', user.id)
      .single()

    if (dbError || !profile || !profile.is_premium || profile.subscription_status !== 'active') {
      return new Response(JSON.stringify({ error: "Not premium" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 })
    }

    // Generate JWT
    const header = btoa(JSON.stringify({alg: 'ES256', typ: 'JWT'})).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = btoa(JSON.stringify({
      sub: user.id,
      premium: true,
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    
    const privateJwk = JSON.parse(Deno.env.get('PREMIUM_SIGNING_KEY') || '{}')
    if (!privateJwk.kty) throw new Error("Missing PREMIUM_SIGNING_KEY env");
    const key = await crypto.subtle.importKey(
      'jwk',
      privateJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    )
    
    const dataToSign = new TextEncoder().encode(`${header}.${payload}`)
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      dataToSign
    )
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      
    const token = `${header}.${payload}.${signatureBase64}`
    return new Response(JSON.stringify({ token }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
  }
})
