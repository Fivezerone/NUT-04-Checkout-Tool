import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Complete — NutriScore</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #f8fafc;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      padding: 48px 40px;
      max-width: 440px;
      width: 90%;
      text-align: center;
      backdrop-filter: blur(12px);
    }
    .icon {
      width: 72px;
      height: 72px;
      background: linear-gradient(135deg, #22c55e, #16a34a);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      font-size: 32px;
    }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 10px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
    button {
      background: #22c55e;
      color: white;
      border: none;
      border-radius: 10px;
      padding: 12px 28px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #16a34a; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Payment Successful!</h1>
    <p>Your premium subscription is active. Please close this tab and return to the NutriScore extension — it will update automatically.</p>
    <button onclick="window.close()">Close This Tab</button>
  </div>
</body>
</html>`

async function main() {
  // 1. Create a public bucket if it doesn't exist
  const { data: buckets } = await supabase.storage.listBuckets()
  if (!buckets?.find((b) => b.name === 'public-assets')) {
    await supabase.storage.createBucket('public-assets', { public: true })
    console.log('Created bucket: public-assets')
  }

  // 2. Upload the HTML file
  const { data, error } = await supabase.storage
    .from('public-assets')
    .upload('success.html', htmlContent, {
      contentType: 'text/html; charset=utf-8',
      upsert: true,
    })

  if (error) {
    console.error('Upload failed:', error.message)
    process.exit(1)
  }

  // 3. Get the public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from('public-assets').getPublicUrl('success.html')

  console.log('Success page uploaded! Public URL:', publicUrl)
}

main()
