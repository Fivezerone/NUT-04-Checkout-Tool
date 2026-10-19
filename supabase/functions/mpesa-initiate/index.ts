import { serve } from '@std/http'
import { createClient } from '@supabase/supabase-js'
import { getPlan } from '../_shared/plan.ts'
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

    // Authenticate the user from the JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError(401, 'UNAUTHORIZED', headers)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return jsonError(401, 'UNAUTHORIZED', headers)

    // P1: Read price from plans table — ignore any client-supplied amount
    const body = await req.json()
    const { phone } = body
    if (!phone) return jsonError(400, 'INVALID_REQUEST', headers)

    const plan = await getPlan(supabase)
    const amount = plan.price_kes // Server-authoritative price

    // Daraja Configuration
    const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY')!
    const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET')!
    const shortcode = Deno.env.get('MPESA_SHORTCODE')!
    const passkey = Deno.env.get('MPESA_PASSKEY')!
    const mpesaEnv = Deno.env.get('MPESA_ENV') ?? 'sandbox'
    const mpesaBaseUrl =
      mpesaEnv === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'

    // Get OAuth Token
    const auth = btoa(`${consumerKey}:${consumerSecret}`)
    const tokenResponse = await fetch(
      `${mpesaBaseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` } },
    )
    const tokenData = await tokenResponse.json()
    const darajaToken = tokenData.access_token

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14)
    const password = btoa(`${shortcode}${passkey}${timestamp}`)

    const clientReference = `NUT04-${crypto.randomUUID()}`
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        amount,
        plan: plan.code,
        payment_method: 'mpesa',
        client_reference: clientReference,
        status: 'pending',
      })
      .select('id, client_reference')
      .single()

    if (paymentError || !payment) throw new Error('Unable to start payment.')

    const callbackUrl = `${Deno.env.get('MPESA_CALLBACK_URL')!}?payment_id=${encodeURIComponent(payment.id)}`

    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount), // M-Pesa requires integer
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: clientReference,
      TransactionDesc: 'Premium Subscription',
    }

    const stkResponse = await fetch(`${mpesaBaseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${darajaToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(stkPayload),
    })
    const stkData = await stkResponse.json()

    if (!stkResponse.ok || stkData.ResponseCode !== '0') {
      await supabase.from('payments').update({ status: 'failed' }).eq('id', payment.id)
      throw new Error(stkData.errorMessage || 'STK Push failed')
    }

    const { error: updateError } = await supabase
      .from('payments')
      .update({ transaction_ref: stkData.CheckoutRequestID })
      .eq('id', payment.id)

    if (updateError) {
      console.warn('M-Pesa initiate: failed to link CheckoutRequestID to payment', payment.id)
    }

    return new Response(JSON.stringify(stkData), {
      headers: { ...headers, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    const requestId = crypto.randomUUID()
    console.error('[mpesa-initiate]', { requestId, error })
    return jsonError(500, 'INTERNAL_ERROR', headers)
  }
})
