import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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

    if (resultCode !== 0) {
      // Payment failed/cancelled by user
      await supabase
        .from("payments")
        .update({ status: "failed" })
        .eq("transaction_ref", checkoutRequestID)
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

    // Look up payment by transaction_ref
    const { data: payment } = await supabase
      .from("payments")
      .select("id")
      .eq("transaction_ref", checkoutRequestID)
      .single()

    if (!payment) {
      console.error("M-Pesa webhook: payment not found for ref", checkoutRequestID)
      return new Response("OK", { status: 200 })
    }

    const verified = queryData.ResultCode === "0" || queryData.ResultCode === 0
    const queryLagging = queryData.ResultCode === undefined || String(queryData.ResultCode) === "1036"

    if (verified || queryLagging) {
      // STK query response has no Amount field; pass NULL — grant_premium uses payments.amount
      // (set at initiate time, server-authoritative)
      const { data: grantResult, error: grantError } = await supabase.rpc("grant_premium", {
        p_payment_id: payment.id,
        p_provider_amount: null,
        p_provider_currency: null,
      })

      if (grantError) {
        console.error("grant_premium failed:", grantError)
      } else {
        const r = grantResult as { result: string }
        if (r?.result === "amount_mismatch") {
          console.warn("M-Pesa webhook: amount mismatch for payment", payment.id)
        }
      }
    } else {
      // Active verification explicitly failed
      await supabase
        .from("payments")
        .update({ status: "failed" })
        .eq("id", payment.id)
    }

    return new Response("OK", { status: 200 })
  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), { status: 400 })
  }
})
