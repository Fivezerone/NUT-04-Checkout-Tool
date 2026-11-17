// src/shared/telemetry-envelope.ts
// Authoritative telemetry schema, constraints and validation for device & gateway.
// Reference: Blueprint §2.8, §3.3 (N3); Invariants G-02, G-03, T-08.

export const TELEMETRY_SCHEMA_VERSION = 'nutriscore.telemetry/1.1' as const
export const ALLOWED_TELEMETRY_SCHEMAS = new Set<string>([
  'nutriscore.telemetry/1.1',
  'nutriscore.telemetry/1.0',
])

export const MAX_BATCH_EVENTS = 100
export const MAX_BATCH_BYTES = 256 * 1024 // 256 KB
export const MAX_DEVICE_RATE_PER_SEC = 20
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000 // 24 hours

export type IngestStatus = 'accepted' | 'duplicate' | 'rejected'
export type RejectionCode = 'SCHEMA' | 'CONSENT' | 'SKEW' | 'RATE' | 'TOO_LARGE'

export interface TelemetryEvent {
  event_id: string // 26-char Crockford Base32 monotonic ULID
  occurred_at: string // ISO 8601
  shopper_ref: string
  retailer: string
  type: string
  consent_ref: string
  profile_ver?: number
  client_seq: number
  schema: string
  payload: Record<string, unknown>
}

export interface IngestResultItem {
  event_id: string
  status: IngestStatus
  code?: RejectionCode
  reason?: string
}

export interface BatchIngestResponse {
  batch_id: string
  results: IngestResultItem[]
}

const ULID_REGEX = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/i

export function isValidUlid(val: unknown): val is string {
  return typeof val === 'string' && val.length === 26 && ULID_REGEX.test(val)
}

export function validateTelemetryEventSchema(event: unknown): {
  valid: boolean
  code?: RejectionCode
  reason?: string
} {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { valid: false, code: 'SCHEMA', reason: 'Event must be a non-null object' }
  }

  const ev = event as Partial<TelemetryEvent>

  if (!isValidUlid(ev.event_id)) {
    return { valid: false, code: 'SCHEMA', reason: 'Invalid or missing 26-character ULID event_id' }
  }

  if (typeof ev.occurred_at !== 'string' || Number.isNaN(new Date(ev.occurred_at).getTime())) {
    return { valid: false, code: 'SCHEMA', reason: 'Invalid or missing occurred_at timestamp' }
  }

  if (typeof ev.shopper_ref !== 'string' || ev.shopper_ref.trim().length === 0) {
    return { valid: false, code: 'SCHEMA', reason: 'Invalid or missing shopper_ref' }
  }

  if (typeof ev.retailer !== 'string' || ev.retailer.trim().length === 0) {
    return { valid: false, code: 'SCHEMA', reason: 'Invalid or missing retailer' }
  }

  if (typeof ev.type !== 'string' || ev.type.trim().length === 0) {
    return { valid: false, code: 'SCHEMA', reason: 'Invalid or missing event type' }
  }

  if (typeof ev.consent_ref !== 'string' || ev.consent_ref.trim().length === 0) {
    return {
      valid: false,
      code: 'SCHEMA',
      reason: 'Invalid or missing consent_ref (100% linkage required)',
    }
  }

  if (typeof ev.client_seq !== 'number' || !Number.isInteger(ev.client_seq) || ev.client_seq < 0) {
    return { valid: false, code: 'SCHEMA', reason: 'client_seq must be a non-negative integer' }
  }

  if (typeof ev.schema !== 'string' || !ALLOWED_TELEMETRY_SCHEMAS.has(ev.schema)) {
    return { valid: false, code: 'SCHEMA', reason: `Unsupported schema version: ${ev.schema}` }
  }

  if (!ev.payload || typeof ev.payload !== 'object' || Array.isArray(ev.payload)) {
    return { valid: false, code: 'SCHEMA', reason: 'payload must be a JSON object' }
  }

  return { valid: true }
}
