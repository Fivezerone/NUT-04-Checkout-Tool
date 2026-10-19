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

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError(401, 'UNAUTHORIZED', headers)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return jsonError(401, 'UNAUTHORIZED', headers)

    // P1: Read price from plans table — ignore any client-supplied amount.
    // NOTE: If the Paystack account currency is not KES, record that in HUMAN_ACTIONS.md
    // and convert accordingly. Currently assumes KES.
    const body = await req.json()
    const { email } = body
    if (!email) return jsonError(400, 'INVALID_REQUEST', headers)

    const plan = await getPlan(supabase)
    const amount = plan.price_kes // Server-authoritative price

    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')!
    const callbackUrl = Deno.env.get('PAYSTACK_CALLBACK_URL')

    const paystackPayload: Record<string, unknown> = {
      email,
      currency: 'KES',
      amount: Math.round(amount * 100), // Paystack amount is in kobo/cents
      metadata: { user_id: user.id },
    }
    if (callbackUrl) {
      paystackPayload.callback_url = callbackUrl
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(paystackPayload),
    })

    const data = await response.json()
    if (!data.status) {
      throw new Error(data.message || 'Paystack initialization failed')
    }

    // Save pending payment with plan and server-authoritative amount
    const { error: insertError } = await supabase.from('payments').insert({
      user_id: user.id,
      amount: amount,
      plan: plan.code,
      payment_method: 'paystack',
      transaction_ref: data.data.reference,
      status: 'pending',
    })

    if (insertError) {
      console.error('Failed to insert payment record:', insertError)
      throw new Error('Failed to initialize payment record.')
    }

    return new Response(JSON.stringify(data.data), {
      headers: { ...headers, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    const requestId = crypto.randomUUID()
    console.error('[paystack-initiate]', { requestId, error })
    return jsonError(500, 'INTERNAL_ERROR', headers)
  }
})
