import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getPlan } from "../_shared/plan.ts"

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? ""
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map(s => s.trim())
  const allow = allowed.includes(origin) ? origin : allowed[0] ?? "*"
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  }
}

serve(async (req) => {
  const headers = corsHeaders(req)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    const authHeader = req.headers.get("Authorization")!
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""))
    if (authError || !user) throw new Error("Unauthorized")

    // P1: Read price from plans table — ignore any client-supplied amount.
    // NOTE: If the Paystack account currency is not KES, record that in HUMAN_ACTIONS.md
    // and convert accordingly. Currently assumes KES.
    const body = await req.json()
    const { email } = body
    if (!email) throw new Error("Email required for Paystack")

    const plan = await getPlan(supabase)
    const amount = plan.price_kes  // Server-authoritative price

    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY")!
    const callbackUrl = Deno.env.get("PAYSTACK_CALLBACK_URL")!

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        currency: "KES",
        amount: Math.round(amount * 100),  // Paystack amount is in kobo/cents
        metadata: { user_id: user.id },
      }),
    })

    const data = await response.json()
    if (!data.status) {
      throw new Error(data.message || "Paystack initialization failed")
    }

    // Save pending payment with plan and server-authoritative amount
    const { error: insertError } = await supabase.from("payments").insert({
      user_id: user.id,
      amount: amount,
      plan: plan.code,
      payment_method: "paystack",
      transaction_ref: data.data.reference,
      status: "pending",
    })

    if (insertError) {
      console.error("Failed to insert payment record:", insertError)
      throw new Error("Failed to initialize payment record.")
    }

    return new Response(JSON.stringify(data.data), {
      headers: { ...headers, "Content-Type": "application/json" },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...headers, "Content-Type": "application/json" },
      status: 400,
    })
  }
})
