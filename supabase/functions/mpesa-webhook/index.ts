import { serve } from "@std/http"
import { createClient } from "@supabase/supabase-js"

serve(async (req) => {
  try {
    const body = await req.json()
    const result = body?.Body?.stkCallback

    if (!result) throw new Error("Invalid callback payload")

    const checkoutRequestID = result.CheckoutRequestID
    const resultCode = result.ResultCode

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    const url = new URL(req.url)
    const paymentId = url.searchParams.get("payment_id")
    
    if (!paymentId) {
      console.error("M-Pesa webhook: missing payment_id param")
      return new Response("OK", { status: 200 })
    }

    const { data: payment } = await supabase
      .from("payments")
      .select("id, transaction_ref")
      .eq("id", paymentId)
      .single()

    if (!payment || payment.transaction_ref !== checkoutRequestID) {
      console.error("M-Pesa webhook: payment not found or ref mismatch", checkoutRequestID)
      return new Response("OK", { status: 200 })
    }

    if (resultCode !== 0) {
      // Payment failed/cancelled by user
      await supabase
        .from("payments")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", payment.id)
        .eq("status", "pending")
      return new Response("OK", { status: 200 })
    }

    // Active verification using STK Push Query API
    const consumerKey = Deno.env.get("MPESA_CONSUMER_KEY")!
    const consumerSecret = Deno.env.get("MPESA_CONSUMER_SECRET")!
    const shortcode = Deno.env.get("MPESA_SHORTCODE")!
    const passkey = Deno.env.get("MPESA_PASSKEY")!
    const mpesaEnv = Deno.env.get("MPESA_ENV") ?? "sandbox"
    const mpesaBaseUrl = mpesaEnv === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke"

    const auth = btoa(`${consumerKey}:${consumerSecret}`)
    const tokenResponse = await fetch(
      `${mpesaBaseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` } }
    )
    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)
    const password = btoa(`${shortcode}${passkey}${timestamp}`)

    const queryPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestID,
    }

    const queryResponse = await fetch(`${mpesaBaseUrl}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(queryPayload),
    })
    const queryData = await queryResponse.json()

    const raw = queryData?.ResultCode
    const hasCode = raw !== undefined && raw !== null && String(raw).trim() !== ''
    const code = hasCode ? Number(raw) : NaN

    if (hasCode && code === 0) {
      const { data: grantResult, error: grantError } = await supabase.rpc('grant_premium', {
        p_payment_id: payment.id, p_provider_amount: null, p_provider_currency: null })
      if (grantError) console.error('[mpesa-webhook] grant_premium failed:', grantError)
    } else if (hasCode && code !== 1036) {
      await supabase.from('payments').update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', payment.id).eq('status', 'pending')
    }

    return new Response("OK", { status: 200 })
  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), { status: 400 })
  }
})
