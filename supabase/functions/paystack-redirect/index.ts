import { serve } from '@std/http'

// This endpoint is the browser-facing callback URL after a Paystack card
// payment. Paystack redirects the user's tab here with ?reference=T2796...
// The actual payment verification happens via the server-to-server webhook
// (paystack-webhook). This page just shows a friendly "close this tab" message
// and the Realtime subscription in the extension popup will resolve the flow.
//
// IMPORTANT: Supabase Edge Functions on *.supabase.co domains enforce a strict
// Content-Security-Policy sandbox and overwrite Content-Type to text/plain to
// prevent phishing. Therefore, we CANNOT return HTML here. We return a clean
// plain text message instead.
serve(async (req) => {
  const url = new URL(req.url)
  const reference = url.searchParams.get('reference') || url.searchParams.get('trxref') || ''

  const textMessage = `
=========================================
      PAYMENT VERIFICATION PENDING       
=========================================

Thank you! Your payment is being verified. 

You can now safely close this browser tab and 
return to the Chrome Extension to continue.

Transaction Reference: ${reference}
=========================================
`

  return new Response(textMessage, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status: 200,
  })
})
