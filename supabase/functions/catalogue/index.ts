/**
 * NutriScore CAD Phase 8 — Catalogue Filtering Edge Function
 *
 * Reference: Blueprint §4.3, Decision D6, Amendment A6
 *
 * Provides DPT-authenticated filtering of reference SKUs.
 * Validates DPoP proof and Dietary Profile Token (DPT), and checks jti revocations.
 * Never logs the token.
 *
 * Endpoint:
 *   POST /functions/v1/catalogue
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyDpopProof } from '../../src/shared/dpop.ts'
import { verifyDpt } from '../../src/shared/dpt.ts'
import { LocalEd25519Signer } from '../../src/shared/signer.ts'
import {
  evaluateSkuAgainstConstraints,
  type CandidateSku,
} from '../../src/shared/commercial-catalogue.ts'

const signer = new LocalEd25519Signer()
const replayCache = new Set<string>()

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321'
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // 1. DPoP Proof Validation
  const dpopHeader = req.headers.get('DPoP') || req.headers.get('dpop')
  if (!dpopHeader) {
    return jsonResponse({ error: 'Missing required DPoP proof header' }, 401)
  }

  const dpopResult = verifyDpopProof(dpopHeader, 'POST', req.url, replayCache)
  if (!dpopResult.valid || !dpopResult.jkt) {
    return jsonResponse({ error: `Invalid DPoP proof: ${dpopResult.error}` }, 401)
  }

  // 2. DPT Token Validation
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401)
  }

  const token = authHeader.replace(/^(DPoP|Bearer)\s+/i, '').trim()
  if (!token) {
    return jsonResponse({ error: 'Malformed Authorization header' }, 401)
  }

  // Note: NEVER log the DPT token!
  const dptResult = verifyDpt(token, signer.getPublicKey(), dpopResult.jkt)
  if (!dptResult.valid || !dptResult.payload) {
    return jsonResponse({ error: `Invalid Dietary Profile Token: ${dptResult.error}` }, 401)
  }

  const dpt = dptResult.payload

  // 3. Revocation check against exchange.dpt_revocations
  const supabase = adminClient()
  const { data: isRevoked } = await supabase.rpc('is_token_revoked', {
    p_jti: dpt.jti,
  })
  if (isRevoked === true) {
    return jsonResponse({ error: 'DPT token has been revoked' }, 401)
  }

  // 4. Parse candidate items or query retailer
  let body: any
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  let candidateSkus: CandidateSku[] = []

  if (Array.isArray(body.skus) && body.skus.length > 0) {
    candidateSkus = body.skus
  } else {
    // Fetch from commercial.skus
    const retailer = body.retailer
    let query = supabase.from('skus').select('*').eq('active', true)
    if (retailer) {
      query = query.eq('retailer', retailer)
    }
    const { data: dbSkus, error: dbErr } = await query.limit(100)
    if (dbErr) {
      return jsonResponse({ error: 'Failed to fetch catalogue items' }, 500)
    }
    candidateSkus = (dbSkus || []) as CandidateSku[]
  }

  // 5. Evaluate against DPT constraints
  const constraints = dpt.cs || {}
  const results = candidateSkus.map((sku) => {
    const evaluation = evaluateSkuAgainstConstraints(sku, constraints)
    return {
      sku_id: sku.sku_id,
      name: sku.name,
      retailer: sku.retailer,
      conforming: evaluation.conforming,
    }
  })

  return jsonResponse({
    total: candidateSkus.length,
    conforming_count: results.filter((r) => r.conforming).length,
    results,
  })
})
