/**
 * NutriScore CAD Phase 8 — Observed Orders Edge Function
 *
 * Reference: Blueprint §4.3, Decision D6, Amendment A6
 *
 * Ingestion of observed grocery cart events from Chrome extension into
 * commercial.orders and commercial.order_lines.
 * Authenticated via Dietary Profile Token (DPT) with DPoP binding.
 *
 * Strictly observed event logging: no transaction, routing, stock, or settlement logic.
 *
 * Endpoint:
 *   POST /functions/v1/observed-orders
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyDpopProof } from '../../src/shared/dpop.ts'
import { verifyDpt, type DptPayload } from '../../src/shared/dpt.ts'
import { LocalEd25519Signer } from '../../src/shared/signer.ts'

const replayCache = new Set<string>()
const signer = new LocalEd25519Signer()

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

  const dpt: DptPayload = dptResult.payload

  // 3. Revocation check against exchange.dpt_revocations
  const supabase = adminClient()
  const { data: isRevoked, error: revError } = await supabase.rpc('is_token_revoked', {
    p_jti: dpt.jti,
  })

  if (revError) {
    console.error('[observed-orders] Failed to check revocation:', revError.message)
  } else if (isRevoked === true) {
    return jsonResponse({ error: 'DPT token has been revoked' }, 401)
  }

  // 4. Parse observed cart items
  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const retailer = String(body.retailer || '').trim()
  const idempotencyKey = String(body.idempotency_key || '').trim()
  const totalKes = body.total_kes !== undefined ? Number(body.total_kes) : null
  const items = Array.isArray(body.items) ? body.items : []

  if (!retailer || !idempotencyKey) {
    return jsonResponse({ error: 'Missing required retailer or idempotency_key' }, 400)
  }

  // 5. Ingest into commercial.orders and commercial.order_lines
  // Resolve tenant ID from alias or default test tenant
  const tenantId = body.tenant_id || '00000000-0000-0000-0000-000000000001'
  const shopperAliasBytes = Buffer.from(dpt.shp, 'utf8')
  const currentEpoch = dpt.iat ? Math.floor(dpt.iat / 7776000) : 1 // ~quarterly epoch

  try {
    // Upsert order by tenant_id and idempotency_key
    const { data: orderData, error: orderErr } = await supabase
      .from('orders')
      .upsert(
        {
          tenant_id: tenantId,
          shopper_alias: shopperAliasBytes,
          epoch: currentEpoch,
          retailer,
          status: 'observed',
          total_kes: totalKes,
          idempotency_key: idempotencyKey,
          source: 'extension_observed',
        },
        { onConflict: 'tenant_id,idempotency_key' },
      )
      .select('id')
      .single()

    if (orderErr) {
      console.error('[observed-orders] Failed to record order:', orderErr.message)
      return jsonResponse({ error: 'Failed to record observed order' }, 500)
    }

    const orderId = orderData.id

    // Insert order lines
    if (items.length > 0) {
      const lines = items.map((item: any, idx: number) => ({
        tenant_id: tenantId,
        order_id: orderId,
        line_no: idx + 1,
        sku_id: item.sku_id,
        qty: Number(item.qty) || 1,
        unit_price_kes: Number(item.unit_price_kes) || 0.0,
      }))

      const { error: linesErr } = await supabase.from('order_lines').upsert(lines, {
        onConflict: 'tenant_id,order_id,line_no',
      })

      if (linesErr) {
        console.error('[observed-orders] Failed to record order lines:', linesErr.message)
      }
    }

    return jsonResponse(
      {
        status: 'recorded',
        order_id: orderId,
        retailer,
        lines_count: items.length,
      },
      201,
    )
  } catch (err) {
    console.error('[observed-orders] Ingestion exception:', (err as Error).message)
    return jsonResponse({ error: 'Internal ingestion error' }, 500)
  }
})
