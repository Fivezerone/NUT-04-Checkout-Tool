/**
 * NutriScore CAD Phase 5 — Audit Writer Edge Function
 *
 * Drains audit.outbox in batches and appends each entry to audit.ledger
 * via audit.append_ledger_entry() with advisory lock serialization.
 *
 * Trigger modes:
 *   POST /functions/v1/audit-writer           — drain all unprocessed outbox rows
 *   POST /functions/v1/audit-writer?chain=<uuid> — drain one chain only
 *
 * Blueprint refs: §4.4 outbox pattern, §4.5 serialized ledger insertion, A7
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BATCH_SIZE = 50

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface OutboxRow {
  id: string
  chain_id: string
  event_id: string
  action: string
  actor_id: string | null
  actor_role: string | null
  decision: string | null
  resource_type: string | null
  resource_id: string | null
  patient_ref: string | null // bytea comes back as hex string from Supabase JS client
  severity: number
  envelope: Record<string, unknown>
  payload_enc: string | null
  payload_mac: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Helper — build Supabase admin client using service-role key
// ---------------------------------------------------------------------------
function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ---------------------------------------------------------------------------
// Fetch unprocessed outbox rows for a given chain (or all chains)
// ---------------------------------------------------------------------------
async function fetchOutbox(
  supabase: ReturnType<typeof adminClient>,
  chainId: string | null,
): Promise<OutboxRow[]> {
  let q = supabase
    .from('outbox')
    .select('*')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)
    .schema('audit')

  if (chainId) {
    q = q.eq('chain_id', chainId)
  }

  const { data, error } = await q

  if (error) throw new Error(`outbox fetch failed: ${error.message}`)
  return (data as OutboxRow[]) ?? []
}

// ---------------------------------------------------------------------------
// Call audit.append_ledger_entry for one row
// ---------------------------------------------------------------------------
async function appendEntry(
  supabase: ReturnType<typeof adminClient>,
  row: OutboxRow,
): Promise<void> {
  const { error } = await supabase.rpc('append_ledger_entry', {
    p_chain_id: row.chain_id,
    p_event_id: row.event_id,
    p_occurred_at: row.created_at,
    p_actor_id: row.actor_id,
    p_actor_role: row.actor_role,
    p_action: row.action,
    p_decision: row.decision,
    p_resource_type: row.resource_type,
    p_resource_id: row.resource_id,
    p_patient_ref: row.patient_ref, // passed as hex; server casts bytea
    p_severity: row.severity,
    p_envelope: row.envelope,
    p_payload_enc: row.payload_enc,
    p_payload_mac: row.payload_mac,
    p_signature: null, // let the DB generate Stage A HMAC
  })

  if (error) {
    throw new Error(`append_ledger_entry failed for outbox id=${row.id}: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Mark outbox row as processed
// ---------------------------------------------------------------------------
async function markProcessed(supabase: ReturnType<typeof adminClient>, id: string): Promise<void> {
  const { error } = await supabase
    .from('outbox')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', id)
    .schema('audit')

  if (error) {
    throw new Error(`markProcessed failed for id=${id}: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Main drain loop
// ---------------------------------------------------------------------------
async function drainOutbox(chainId: string | null): Promise<{
  processed: number
  errors: string[]
}> {
  const supabase = adminClient()
  const rows = await fetchOutbox(supabase, chainId)

  let processed = 0
  const errors: string[] = []

  for (const row of rows) {
    try {
      await appendEntry(supabase, row)
      await markProcessed(supabase, row.id)
      processed++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`[ERROR] outbox id=${row.id}: ${msg}`)
      // Continue with remaining rows; don't abort the whole batch
    }
  }

  return { processed, errors }
}

// ---------------------------------------------------------------------------
// Deno Edge Function handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed — use POST' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(req.url)
  const chainId = url.searchParams.get('chain') ?? null

  let result: { processed: number; errors: string[] }

  try {
    result = await drainOutbox(chainId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[audit-writer] fatal:', msg)
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { processed, errors } = result

  if (errors.length > 0) {
    errors.forEach((e) => console.error(e))
  }

  console.log(
    `[audit-writer] processed=${processed} errors=${errors.length}` +
      (chainId ? ` chain=${chainId}` : ' (all chains)'),
  )

  return new Response(JSON.stringify({ ok: errors.length === 0, processed, errors }), {
    status: errors.length === 0 ? 200 : 207,
    headers: { 'Content-Type': 'application/json' },
  })
})
