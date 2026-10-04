import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts"

serve(async (req) => {
  try {
    const signature = req.headers.get("x-paystack-signature")
    if (!signature) {
      return new Response("Missing signature", { status: 401 })
    }

    const payload = await req.text()
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY")!

    // Verify signature
    const hash = createHmac("sha512", paystackSecret)
      .update(payload)
      .digest("hex")

    if (hash !== signature) {
      return new Response("Invalid signature", { status: 401 })
    }

    const event = JSON.parse(payload)

    if (event.event === "charge.success") {
      const reference = event.data.reference
      const providerAmount = event.data.amount / 100  // Paystack sends kobo
      const providerCurrency = event.data.currency    // e.g. "KES"

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!
      const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

      // Look up payment by transaction_ref
      const { data: payment } = await supabase
        .from("payments")
        .select("id")
        .eq("transaction_ref", reference)
        .single()

      if (!payment) {
        console.error("Paystack webhook: payment not found for ref", reference)
        return new Response("OK", { status: 200 })
      }

      // Grant premium via the authoritative function (idempotent, amount-checked)
      const { data: grantResult, error: grantError } = await supabase.rpc("grant_premium", {
        p_payment_id: payment.id,
        p_provider_amount: providerAmount,
        p_provider_currency: providerCurrency,
      })

      if (grantError) {
        console.error("grant_premium failed:", grantError)
      } else {
        const result = grantResult as { result: string }
        if (result?.result === "amount_mismatch") {
          console.warn("Paystack webhook: amount mismatch for payment", payment.id, providerAmount, providerCurrency)
        }
      }
    }

    return new Response("OK", { status: 200 })
  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), { status: 400 })
  }
})
