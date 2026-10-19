import { serve } from '@std/http'
import { createClient } from '@supabase/supabase-js'
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

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError(401, 'UNAUTHORIZED', headers)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return jsonError(401, 'UNAUTHORIZED', headers)

    const { transaction_ref, method } = await req.json()
    if (!transaction_ref || !method) return jsonError(400, 'INVALID_REQUEST', headers)

    // 1. Check local DB — resolve by transaction_ref AND user_id to prevent cross-user enumeration
    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('transaction_ref', transaction_ref)
      .eq('user_id', user.id)
      .single()

    if (!payment) return jsonError(400, 'INVALID_REQUEST', headers)

    // If already finalized, return immediately
    if (payment.status !== 'pending') {
      return new Response(JSON.stringify({ status: payment.status }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // 2. Active polling fallback based on method
    let finalStatus = 'pending'
    let providerAmount: number | null = null
    const providerCurrency = method === 'paystack' ? 'KES' : null

    if (method === 'paystack') {
      const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')!
      const verifyRes = await fetch(
        `https://api.paystack.co/transaction/verify/${transaction_ref}`,
        {
          headers: { Authorization: `Bearer ${paystackSecret}` },
        },
      )
      const verifyData = await verifyRes.json()
      if (verifyData.status && verifyData.data.status === 'success') {
        finalStatus = 'completed'
        providerAmount = verifyData.data.amount / 100 // Paystack sends kobo
      } else if (verifyData.status && verifyData.data.status === 'failed') {
        finalStatus = 'failed'
      }
    } else if (method === 'mpesa') {
      const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY')!
      const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET')!
      const shortcode = Deno.env.get('MPESA_SHORTCODE') || '174379'
      const passkey = Deno.env.get('MPESA_PASSKEY')!
      const mpesaEnv = Deno.env.get('MPESA_ENV') ?? 'sandbox'
      const mpesaBaseUrl =
        mpesaEnv === 'production'
          ? 'https://api.safaricom.co.ke'
          : 'https://sandbox.safaricom.co.ke'

      const auth = btoa(`${consumerKey}:${consumerSecret}`)
      const tokenResponse = await fetch(
        `${mpesaBaseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        { headers: { Authorization: `Basic ${auth}` } },
      )
      const tokenData = await tokenResponse.json()
      const timestamp = new Date()
        .toISOString()
        .replace(/[^0-9]/g, '')
        .slice(0, 14)
      const password = btoa(`${shortcode}${passkey}${timestamp}`)

      const queryResponse = await fetch(`${mpesaBaseUrl}/mpesa/stkpushquery/v1/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: timestamp,
          CheckoutRequestID: transaction_ref,
        }),
      })
      const queryData = await queryResponse.json()
      const resultCode = queryData.ResultCode
      if (resultCode === '0' || resultCode === 0) {
        finalStatus = 'completed'
        // STK query response has no amount; pass NULL — grant_premium will use payments.amount
        providerAmount = null
      } else if (resultCode !== undefined && String(resultCode) !== '1036') {
        finalStatus = 'failed'
      }
    }

    // 3. Update DB via grant_premium (the ONLY way premium is granted)
    if (finalStatus === 'completed') {
      const { data: grantResult, error: grantError } = await supabase.rpc('grant_premium', {
        p_payment_id: payment.id,
        p_provider_amount: providerAmount,
        p_provider_currency: providerCurrency,
      })

      if (grantError) {
        console.error('grant_premium failed:', grantError)
        throw new Error('Failed to process payment.')
      }

      const result = grantResult as { result: string }
      if (result?.result === 'amount_mismatch') {
        return new Response(JSON.stringify({ status: 'amount_mismatch' }), {
          headers: { ...headers, 'Content-Type': 'application/json' },
          status: 200,
        })
      }

      return new Response(JSON.stringify({ status: 'completed' }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    if (finalStatus === 'failed') {
      await supabase.from('payments').update({ status: 'failed' }).eq('id', payment.id)
    }

    return new Response(JSON.stringify({ status: finalStatus }), {
      headers: { ...headers, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    const requestId = crypto.randomUUID()
    console.error('[payment-status]', { requestId, error })
    return jsonError(500, 'INTERNAL_ERROR', headers)
  }
})
