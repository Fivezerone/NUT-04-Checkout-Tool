import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  // Sign in as the test user to get RLS access
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'user@example.com', // fallback to real test email used
    password: 'password123'    // fallback to real test password used
  });

  if (authError) {
    console.error("Auth error (update credentials in script if needed):", authError.message);
    // If it fails, maybe we can list users if anon key allows? No.
  } else {
    console.log("Logged in as:", authData.user.email);
  }

  // Now query payments
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error("Error fetching payments:", error);
  } else {
    console.log(`Found ${data?.length || 0} recent payments for this user:`);
    console.table(data);
  }
}

main();
