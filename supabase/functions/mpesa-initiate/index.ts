import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getPlan } from "../_shared/plan.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    // Authenticate the user from the JWT
    const authHeader = req.headers.get("Authorization")!
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""))
    if (authError || !user) throw new Error("Unauthorized")

    // P1: Read price from plans table — ignore any client-supplied amount
    const body = await req.json()
    const { phone } = body
    if (!phone) throw new Error("Phone number required")

    const plan = await getPlan(supabase)
    const amount = plan.price_kes  // Server-authoritative price

    // Daraja Configuration
    const consumerKey = Deno.env.get("MPESA_CONSUMER_KEY")!
    const consumerSecret = Deno.env.get("MPESA_CONSUMER_SECRET")!
    const shortcode = Deno.env.get("MPESA_SHORTCODE")!
    const passkey = Deno.env.get("MPESA_PASSKEY")!
    const mpesaEnv = Deno.env.get("MPESA_ENV") ?? "sandbox"
    const mpesaBaseUrl = mpesaEnv === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke"

    // Get OAuth Token
    const auth = btoa(`${consumerKey}:${consumerSecret}`)
    const tokenResponse = await fetch(
      `${mpesaBaseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` } }
    )
    const tokenData = await tokenResponse.json()
    const darajaToken = tokenData.access_token

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)
    const password = btoa(`${shortcode}${passkey}${timestamp}`)

    const callbackUrl = Deno.env.get("MPESA_CALLBACK_URL")!

    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(amount),  // M-Pesa requires integer
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: "NUT04 Checkout",
      TransactionDesc: "Premium Subscription",
    }

    const stkResponse = await fetch(`${mpesaBaseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${darajaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(stkPayload),
    })
    const stkData = await stkResponse.json()

    if (stkData.ResponseCode !== "0") {
      throw new Error(stkData.errorMessage || "STK Push failed")
    }

    // Save pending payment with plan and server-authoritative amount
    const { error: insertError } = await supabase.from("payments").insert({
      user_id: user.id,
      amount: amount,
      plan: plan.code,
      payment_method: "mpesa",
      transaction_ref: stkData.CheckoutRequestID,
      status: "pending",
    })

    if (insertError) {
      console.error("Failed to insert payment record:", insertError)
      throw new Error("Failed to initialize payment record.")
    }

    return new Response(JSON.stringify(stkData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    })
  }
})
