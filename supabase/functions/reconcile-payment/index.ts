// supabase/functions/reconcile-payment/index.ts
// Background Payment Reconciliation Worker for Safaricom Daraja STK Push & Paystack
// Implements "Acknowledge fast, decide later" pattern with backoff schedule: +90s, +3m, +10m, +30m, +2h.
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§7.3, §13 Tests T3, T9)

import { serve } from '@std/http'
import { createClient } from '@supabase/supabase-js'

export const RETRY_DELAYS_SECONDS = [90, 180, 600, 1800, 7200]

export async function queryMpesaStatus(
  checkoutRequestID: string,
  env: {
    consumerKey: string
    consumerSecret: string
    shortcode: string
    passkey: string
    mpesaEnv: string
  },
): Promise<{ resultCode: number | null; resultDesc: string; isProcessing: boolean }> {
  const mpesaBaseUrl =
    env.mpesaEnv === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke'

  const auth = btoa(`${env.consumerKey}:${env.consumerSecret}`)
  const tokenRes = await fetch(`${mpesaBaseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  const tokenData = await tokenRes.json()
  const accessToken = tokenData.access_token

  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14)
  const password = btoa(`${env.shortcode}${env.passkey}${timestamp}`)

  const queryPayload = {
    BusinessShortCode: env.shortcode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestID,
  }

  const queryRes = await fetch(`${mpesaBaseUrl}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(queryPayload),
  })
  const queryData = await queryRes.json()

  const rawCode = queryData?.ResultCode
  const hasCode = rawCode !== undefined && rawCode !== null && String(rawCode).trim() !== ''
  const code = hasCode ? Number(rawCode) : null

  // 1036 = "Transaction is still being processed" (T9 invariant)
  const isProcessing = code === 1036 || queryData?.errorCode === '500.001.1001'

  return {
    resultCode: code,
    resultDesc: queryData?.ResultDesc || queryData?.errorMessage || '',
    isProcessing,
  }
}

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    const { attemptId } = await req.json().catch(() => ({}))

    if (!attemptId) {
      return new Response(JSON.stringify({ error: 'Missing attemptId' }), { status: 400 })
    }

    const { data: attempt, error: fetchError } = await supabase
      .from('payment_attempts')
      .select('*, invoice:invoices(*)')
      .eq('id', attemptId)
      .single()

    if (fetchError || !attempt) {
      return new Response(JSON.stringify({ error: 'Attempt not found' }), { status: 404 })
    }

    // If already finalized, do nothing
    if (attempt.status !== 'pending') {
      return new Response(JSON.stringify({ status: attempt.status, alreadyResolved: true }), {
        status: 200,
      })
    }

    if (attempt.method === 'mpesa_stk' && attempt.provider_ref) {
      const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY') || ''
      const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET') || ''
      const shortcode = Deno.env.get('MPESA_SHORTCODE') || ''
      const passkey = Deno.env.get('MPESA_PASSKEY') || ''
      const mpesaEnv = Deno.env.get('MPESA_ENV') || 'sandbox'

      const queryResult = await queryMpesaStatus(attempt.provider_ref, {
        consumerKey,
        consumerSecret,
        shortcode,
        passkey,
        mpesaEnv,
      })

      // Invariant T9: Still processing -> Leave pending, never mark failed
      if (queryResult.isProcessing) {
        return new Response(
          JSON.stringify({
            status: 'pending',
            message: 'Transaction is still processing on Daraja rails. Retrying with backoff.',
          }),
          { status: 200 },
        )
      }

      if (queryResult.resultCode === 0) {
        // Confirmed payment -> Authoritative activation
        const { data: activationResult, error: actErr } = await supabase.rpc(
          'activate_tenant_subscription',
          {
            p_attempt_id: attempt.id,
            p_resolved_by: 'query',
          },
        )
        return new Response(JSON.stringify({ resolved: true, activationResult, actErr }), {
          status: 200,
        })
      } else if (queryResult.resultCode !== null) {
        // Failed / Cancelled / Timeout -> Route failure
        const { data: failureResult } = await supabase.rpc('route_payment_failure', {
          p_attempt_id: attempt.id,
          p_result_code: queryResult.resultCode,
          p_error_desc: queryResult.resultDesc,
        })
        return new Response(JSON.stringify({ resolved: true, failureResult }), { status: 200 })
      }
    }

    return new Response(JSON.stringify({ status: 'unresolved' }), { status: 200 })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
