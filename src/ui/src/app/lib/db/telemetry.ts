/**
 * db/telemetry.ts
 *
 * Device telemetry client: durable, consent-gated, idempotent, bounded queue.
 * Replaces observed-orders-sync.js.
 * Reference: Blueprint §2.8, §3.2, §3.3 (C11; A-06, A-12, O-02, G-02, T-08)
 * Flag: ns.telemetry.v2
 */
import { getDB } from "./shared";
import { getNextClientSeq } from "./cart";

// ── Crockford's Base32 & ULID Generator ────────────────────────────────────────
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastUlidTimestamp = 0;
let lastUlidRandom = new Uint8Array(10);

/**
 * Generates a standard 26-character Crockford Base32 ULID.
 * 10 characters: 48-bit millisecond timestamp
 * 16 characters: 80-bit cryptographic or pseudo-randomness
 * Monotonically increments randomness if called in the same millisecond.
 */
export function generateUlid(ts: number = Date.now()): string {
  const time = Math.max(0, Math.floor(ts));
  let timeStr = "";

  // 48-bit timestamp to 10 base32 chars (most significant to least)
  for (let i = 9; i >= 0; i--) {
    const mod = Math.floor(time / Math.pow(32, i)) % 32;
    timeStr += CROCKFORD_BASE32[mod];
  }

  // 80-bit randomness
  const randomBytes = new Uint8Array(10);
  if (time === lastUlidTimestamp) {
    // Increment last random bytes for strict monotonicity within same ms
    let carry = 1;
    for (let i = 9; i >= 0; i--) {
      const sum = (lastUlidRandom[i] || 0) + carry;
      randomBytes[i] = sum % 256;
      carry = Math.floor(sum / 256);
    }
  } else {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(randomBytes);
    } else {
      for (let i = 0; i < 10; i++) randomBytes[i] = Math.floor(Math.random() * 256);
    }
    lastUlidTimestamp = time;
  }
  lastUlidRandom = randomBytes;

  let randomStr = "";
  for (let i = 0; i < 16; i++) {
    // 80 bits into 16 5-bit chunks
    const bitPos = i * 5;
    const bytePos = Math.floor(bitPos / 8);
    const bitOffset = bitPos % 8;
    let val = ((randomBytes[bytePos] || 0) << 8) | (randomBytes[bytePos + 1] || 0);
    val = (val >> (11 - bitOffset)) & 0x1f;
    randomStr += CROCKFORD_BASE32[val % 32];
  }

  return timeStr + randomStr;
}

// ── Types & Contracts ──────────────────────────────────────────────────────────
export type TelemetryEventType =
  | "cart_snapshot"
  | "checkout_completed"
  | "swap_accepted"
  | "swap_declined"
  | "obs_metric";

export type TelemetryStatus = "pending" | "inflight" | "acked" | "dead";

export interface TelemetryEvent {
  schema: "nutriscore.telemetry/1.1";
  event_id: string; // ULID, created once at enqueue and never regenerated
  client_seq: number; // monotonic per install (2.3)
  type: TelemetryEventType;
  occurred_at: string; // RFC 3339 device time; the gateway adds received_at
  shopper_ref: string; // Shopper_ID alias from the token, never the patient UUID
  retailer: string;
  cart_episode_id: string;
  consent_ref: string; // receipt id; 100% linkage required
  profile_ver: number | null;
  versions: { scoring: string; catalogue: string; ext: string };
  payload: unknown; // validated against a JSON Schema per type
}

export interface QueuedTelemetryRecord extends TelemetryEvent {
  status: TelemetryStatus;
  attempts: number;
  lastAttemptAt?: number | null;
  deadLetterReason?: string | null;
  createdAt: number;
}

// ── Queue Constants & Storage Bounds (Blueprint §2.8) ─────────────────────────
export const QUEUE_MAX_EVENTS = 1000;
export const QUEUE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const BATCH_MAX_EVENTS = 100;
export const BATCH_MAX_BYTES = 256 * 1024; // 256 KB
export const FLUSH_TIMEOUT_MS = 5000; // 5 s request deadline
export const RATE_LIMIT_PER_SEC = 20; // 20 events per sec per device
export const DEAD_LETTER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Diagnostic counters
export let telemetryDroppedCount = 0;
export let telemetryEnqueuedCount = 0;
export let telemetryAckedCount = 0;

// Rate limiting sliding window
let rateWindowStart = 0;
let rateWindowCount = 0;

export function resetTelemetryCounters(): void {
  telemetryDroppedCount = 0;
  telemetryEnqueuedCount = 0;
  telemetryAckedCount = 0;
  rateWindowStart = 0;
  rateWindowCount = 0;
}

// ── Feature Flag Evaluation ───────────────────────────────────────────────────
export function isTelemetryV2Enabled(): boolean {
  if (typeof self !== "undefined" && (self as any).NutriFlags?.isEnabled) {
    return Boolean((self as any).NutriFlags.isEnabled("ns.telemetry.v2"));
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).__NUTRI_FLAGS__?.["ns.telemetry.v2"] !== undefined) {
    return Boolean((globalThis as any).__NUTRI_FLAGS__["ns.telemetry.v2"]);
  }
  return false;
}

// ── Canonical Hashing Helper ──────────────────────────────────────────────────
export function canonicalStringify(val: unknown): string {
  if (val === null || typeof val !== "object") return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(val as Record<string, unknown>).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify((val as Record<string, unknown>)[k])}`).join(",")}}`;
}

export async function sha256Hex(str: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Deterministic fallback for non-SubtleCrypto environments
  let h1 = 0xdeadbeef;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(64, "0");
}

export async function computeBatchIdempotencyKey(eventIds: string[]): Promise<string> {
  const sorted = [...eventIds].sort();
  return sha256Hex(sorted.join(","));
}

// ── Config & Gateway URL Resolution (A-12) ────────────────────────────────────
export function getGatewayUrl(): string {
  if (typeof globalThis !== "undefined" && typeof (globalThis as any).NUTRI_CONFIG !== "undefined") {
    const conf = (globalThis as any).NUTRI_CONFIG;
    if (conf.GATEWAY_URL) return conf.GATEWAY_URL.replace(/\/+$/, "");
    if (conf.API_URL) return conf.API_URL.replace(/\/+$/, "");
  }
  if (typeof self !== "undefined" && typeof (self as any).NUTRI_CONFIG !== "undefined") {
    const conf = (self as any).NUTRI_CONFIG;
    if (conf.GATEWAY_URL) return conf.GATEWAY_URL.replace(/\/+$/, "");
    if (conf.API_URL) return conf.API_URL.replace(/\/+$/, "");
  }
  return "/api";
}

// ── Consent Verification & Queue Purge on Revocation (T-08, G-02) ─────────────
export async function purgeTelemetryQueue(): Promise<number> {
  const db = await getDB();
  if (!db.objectStoreNames.contains("telemetry_queue")) return 0;
  const tx = db.transaction("telemetry_queue", "readwrite");
  const store = tx.objectStore("telemetry_queue" as any);
  await (store as any).clear();
  await tx.done;
  return 1;
}

// ── Enqueue Telemetry Event ───────────────────────────────────────────────────
export interface EnqueueOptions {
  type: TelemetryEventType;
  shopperRef: string;
  retailer: string;
  cartEpisodeId: string;
  consentRef: string;
  profileVer?: number | null;
  scoringVersion?: string;
  catalogueVersion?: string;
  extVersion?: string;
  payload: unknown;
  occurredAt?: string;
}

export async function enqueueTelemetryEvent(options: EnqueueOptions): Promise<string | null> {
  // 1. Mandatory consent check (T-08: 100% linkage required, no unlinked telemetry)
  if (!options.consentRef || !options.consentRef.trim()) {
    telemetryDroppedCount++;
    console.warn("[Telemetry] Event dropped: missing mandatory consent_ref receipt");
    return null;
  }
  if (!options.shopperRef || !options.shopperRef.trim()) {
    telemetryDroppedCount++;
    console.warn("[Telemetry] Event dropped: missing shopper_ref alias");
    return null;
  }

  // 2. Rate guard: 20 events per second per device
  const now = Date.now();
  if (now - rateWindowStart < 1000) {
    rateWindowCount++;
    if (rateWindowCount > RATE_LIMIT_PER_SEC) {
      telemetryDroppedCount++;
      console.warn("[Telemetry] Rate limit exceeded (> 20 events/sec). Dropping event.");
      return null;
    }
  } else {
    rateWindowStart = now;
    rateWindowCount = 1;
  }

  const db = await getDB();
  if (!db.objectStoreNames.contains("telemetry_queue")) return null;

  // 3. Bounds enforcement: Cap queue at 1,000 events
  const tx = db.transaction("telemetry_queue", "readwrite");
  const store = tx.objectStore("telemetry_queue" as any);
  const allEvents: QueuedTelemetryRecord[] = await (store as any).getAll();

  if (allEvents.length >= QUEUE_MAX_EVENTS) {
    // Drop oldest pending event
    const pendingEvents = allEvents.filter(e => e.status === "pending").sort((a, b) => a.createdAt - b.createdAt);
    if (pendingEvents.length > 0) {
      await (store as any).delete(pendingEvents[0].event_id);
      telemetryDroppedCount++;
    }
  }

  // 4. Construct envelope (ULID created once and never regenerated)
  const eventId = generateUlid(now);
  const clientSeq = await getNextClientSeq();

  const record: QueuedTelemetryRecord = {
    schema: "nutriscore.telemetry/1.1",
    event_id: eventId,
    client_seq: clientSeq,
    type: options.type,
    occurred_at: options.occurredAt || new Date(now).toISOString(),
    shopper_ref: options.shopperRef,
    retailer: options.retailer.toUpperCase(),
    cart_episode_id: options.cartEpisodeId,
    consent_ref: options.consentRef,
    profile_ver: options.profileVer ?? null,
    versions: {
      scoring: options.scoringVersion || "v5",
      catalogue: options.catalogueVersion || "current",
      ext: options.extVersion || "1.1.0",
    },
    payload: options.payload,
    status: "pending",
    attempts: 0,
    createdAt: now,
  };

  await (store as any).put(record);
  await tx.done;
  telemetryEnqueuedCount++;

  return eventId;
}

// ── Full Jitter Backoff Calculator (ADR-9) ────────────────────────────────────
export function computeBackoffMs(attempt: number, retryAfterSec?: number): number {
  if (retryAfterSec && retryAfterSec > 0) {
    return retryAfterSec * 1000;
  }
  const baseMs = 5000; // 5 s
  const capMs = 15 * 60 * 1000; // 15 min
  const maxDelay = Math.min(capMs, baseMs * Math.pow(2, attempt));
  return Math.floor(Math.random() * maxDelay);
}

// ── Flush Telemetry Queue ─────────────────────────────────────────────────────
export interface FlushResult {
  flushed: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  deadLettered: number;
  error?: string;
}

export async function flushTelemetryQueue(customFetch?: typeof fetch): Promise<FlushResult> {
  const result: FlushResult = {
    flushed: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    deadLettered: 0,
  };

  const db = await getDB();
  if (!db.objectStoreNames.contains("telemetry_queue")) return result;

  // 1. Collect pending events up to 100 events / 256 KB
  const tx = db.transaction("telemetry_queue", "readwrite");
  const store = tx.objectStore("telemetry_queue" as any);
  const allEvents: QueuedTelemetryRecord[] = await (store as any).getAll();

  const pendingBatch: QueuedTelemetryRecord[] = [];
  let batchBytes = 0;

  for (const ev of allEvents) {
    if (ev.status !== "pending") continue;
    const str = JSON.stringify(ev);
    const evBytes = str.length;
    if (pendingBatch.length >= BATCH_MAX_EVENTS || batchBytes + evBytes > BATCH_MAX_BYTES) {
      break;
    }
    pendingBatch.push(ev);
    batchBytes += evBytes;
  }

  if (pendingBatch.length === 0) {
    await tx.done;
    return result;
  }

  // Mark selected batch as inflight
  for (const ev of pendingBatch) {
    ev.status = "inflight";
    ev.lastAttemptAt = Date.now();
    await (store as any).put(ev);
  }
  await tx.done;

  // 2. Prepare HTTP request with SHA-256 Idempotency-Key
  const eventIds = pendingBatch.map(e => e.event_id);
  const idempotencyKey = await computeBatchIdempotencyKey(eventIds);
  const gatewayUrl = getGatewayUrl();
  const endpoint = `${gatewayUrl}/v1/telemetry/batch`;

  const fetchFn = customFetch || (typeof fetch !== "undefined" ? fetch : null);
  if (!fetchFn) {
    // Return inflight back to pending if no fetch function available
    const resetTx = db.transaction("telemetry_queue", "readwrite");
    const rStore = resetTx.objectStore("telemetry_queue" as any);
    for (const ev of pendingBatch) {
      ev.status = "pending";
      await (rStore as any).put(ev);
    }
    await resetTx.done;
    return result;
  }

  // 3. Dispatch HTTP batch request with 5 s deadline (AbortSignal.timeout)
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);

  try {
    response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-NS-Shadow": "1", // Contract bridge: shadow ingest
      },
      body: JSON.stringify({
        batch_id: idempotencyKey,
        events: pendingBatch,
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    // Transient network failure: return to pending with attempts incremented
    const errTx = db.transaction("telemetry_queue", "readwrite");
    const eStore = errTx.objectStore("telemetry_queue" as any);
    for (const ev of pendingBatch) {
      ev.attempts += 1;
      if (ev.attempts >= 8) {
        ev.status = "dead";
        ev.deadLetterReason = err.name === "AbortError" ? "timeout_exceeded" : "network_failure_max_retries";
        result.deadLettered++;
      } else {
        ev.status = "pending";
      }
      await (eStore as any).put(ev);
    }
    await errTx.done;
    result.error = err.message;
    return result;
  } finally {
    clearTimeout(timeoutId);
  }

  result.flushed = pendingBatch.length;

  // 4. Handle response statuses (200, 207, 429, 5xx)
  const writeTx = db.transaction("telemetry_queue", "readwrite");
  const wStore = writeTx.objectStore("telemetry_queue" as any);

  if (response.ok) {
    let body: any;
    try {
      body = await response.json();
    } catch {
      body = { results: [] };
    }

    const resultMap = new Map<string, { status: string; code?: string }>();
    if (Array.isArray(body?.results)) {
      for (const item of body.results) {
        resultMap.set(item.event_id, item);
      }
    }

    for (const ev of pendingBatch) {
      const itemResult = resultMap.get(ev.event_id);
      const evStatus = itemResult?.status || "accepted";

      if (evStatus === "accepted") {
        await (wStore as any).delete(ev.event_id);
        result.accepted++;
        telemetryAckedCount++;
      } else if (evStatus === "duplicate") {
        await (wStore as any).delete(ev.event_id);
        result.duplicates++;
      } else if (evStatus === "rejected") {
        // Schema rejection: dead-letter without retry
        ev.status = "dead";
        ev.deadLetterReason = itemResult?.code || "schema_rejected";
        await (wStore as any).put(ev);
        result.rejected++;
        result.deadLettered++;
      } else {
        await (wStore as any).delete(ev.event_id);
        result.accepted++;
      }
    }
  } else if (response.status === 429 || response.status >= 500) {
    // 429 / 5xx: retry with full jitter backoff (up to 8 attempts)
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

    for (const ev of pendingBatch) {
      ev.attempts += 1;
      if (ev.attempts >= 8) {
        ev.status = "dead";
        ev.deadLetterReason = `http_${response.status}_max_attempts`;
        result.deadLettered++;
      } else {
        ev.status = "pending";
      }
      await (wStore as any).put(ev);
    }
    result.error = `HTTP ${response.status} (backoff applied, retryAfter=${retryAfterSec ?? "none"})`;
  } else {
    // Client error (400, 401, 403, etc.): dead letter
    for (const ev of pendingBatch) {
      ev.status = "dead";
      ev.deadLetterReason = `client_error_${response.status}`;
      await (wStore as any).put(ev);
      result.deadLettered++;
    }
    result.error = `HTTP ${response.status}`;
  }

  await writeTx.done;
  return result;
}

// ── Dead-Letter Retention Pruning (7 Days) ────────────────────────────────────
export async function pruneDeadLetters(cutoffMs: number = Date.now() - DEAD_LETTER_RETENTION_MS): Promise<number> {
  const db = await getDB();
  if (!db.objectStoreNames.contains("telemetry_queue")) return 0;
  const tx = db.transaction("telemetry_queue", "readwrite");
  const store = tx.objectStore("telemetry_queue" as any);
  const allEvents: QueuedTelemetryRecord[] = await (store as any).getAll();
  let deletedCount = 0;

  for (const ev of allEvents) {
    if (ev.status === "dead" && ev.createdAt < cutoffMs) {
      await (store as any).delete(ev.event_id);
      deletedCount++;
    }
  }

  await tx.done;
  return deletedCount;
}
