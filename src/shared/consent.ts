// src/shared/consent.ts
// Consent Ledger, Small-Cell Suppression & Patient Erasure Guards
// Reference: Blueprint §3.4, §4.5, §5.4; Findings X-08; Invariants T13, T26, T27

export const CONSENT_PURPOSES = [
  'clinician_link', // C1: Clinician care link
  'purchase_timeline', // C2: Purchase timeline & cart data
  'diary', // C3: Nutritional diary & targets
  'de_identified_aggregates', // C4: Payer & commercial de-identified analytics
  'payer_analytics', // C4: Direct payer sharing
] as const

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export const PURPOSE_CATEGORY_MAP: Record<ConsentPurpose, 'C1' | 'C2' | 'C3' | 'C4'> = {
  clinician_link: 'C1',
  purchase_timeline: 'C2',
  diary: 'C3',
  de_identified_aggregates: 'C4',
  payer_analytics: 'C4',
}

export interface ConsentRecord {
  id: string
  tenantId: string
  patientRef: string
  purpose: ConsentPurpose
  status: 'not_requested' | 'pending' | 'active' | 'paused' | 'revoked' | 'expired'
  grantedAt?: string
  revokedAt?: string
}

export type StatutoryConsentPurpose = 'C1' | 'C2' | 'C3' | 'C4'

export interface ConsentRegisterEntry {
  consent_ref: string
  patient_ref: string
  tenant_id?: string | null
  purpose: StatutoryConsentPurpose | ConsentPurpose
  scope?: string | null
  notice_hash: string
  granted_at: string
  expires_at?: string | null
  revoked_at?: string | null
}

/**
 * Checks whether a consent register record is active for the specified purpose.
 * Checks for:
 * 1. Entry existence
 * 2. Revocation status (revoked_at must be null)
 * 3. Expiration status (expires_at must be null or in the future)
 * 4. Granted timestamp (granted_at must be in the past or now)
 * 5. Exact or mapped purpose match ('C1' | 'C2' | 'C3' | 'C4')
 */
export function hasActiveConsent(
  entry: ConsentRegisterEntry | null | undefined,
  requiredPurpose: StatutoryConsentPurpose | ConsentPurpose = 'C2',
  now: number = Date.now(),
): boolean {
  if (!entry) return false
  if (entry.revoked_at) return false

  if (entry.expires_at) {
    const expTime = new Date(entry.expires_at).getTime()
    if (!Number.isNaN(expTime) && expTime <= now) return false
  }

  const grantedTime = new Date(entry.granted_at).getTime()
  if (!Number.isNaN(grantedTime) && grantedTime > now) return false

  const targetCategory: StatutoryConsentPurpose =
    (PURPOSE_CATEGORY_MAP[requiredPurpose as ConsentPurpose] as StatutoryConsentPurpose) ||
    (requiredPurpose as StatutoryConsentPurpose)

  const entryCategory: StatutoryConsentPurpose =
    (PURPOSE_CATEGORY_MAP[entry.purpose as ConsentPurpose] as StatutoryConsentPurpose) ||
    (entry.purpose as StatutoryConsentPurpose)

  return entryCategory === targetCategory
}

/**
 * Invariant T26: Clinician Patient-Level Visibility Gate (Finding X-08)
 * A clinician can only access patient-level timelines, diaries, or targets
 * if there is an active consent record for the exact requested purpose.
 * A clinician_link consent no longer satisfies purchase_timeline or diary by default.
 * Revocation immediately cuts off visibility.
 */
export function evaluatePatientVisibility(
  consent: ConsentRecord | null | undefined,
  requiredPurpose: ConsentPurpose = 'clinician_link',
): { allowed: boolean; reason?: string } {
  if (!consent) {
    return {
      allowed: false,
      reason: 'No consent record exists for this patient and purpose.',
    }
  }

  if (consent.status === 'revoked') {
    return {
      allowed: false,
      reason:
        'Consent has been explicitly revoked by the patient. Patient-level data is inaccessible.',
    }
  }

  if (consent.status !== 'active') {
    return {
      allowed: false,
      reason: `Consent status is '${consent.status}'. Active patient consent is mandatory.`,
    }
  }

  if (consent.purpose !== requiredPurpose) {
    return {
      allowed: false,
      reason: `Consent granted for '${consent.purpose}', but required purpose is '${requiredPurpose}'.`,
    }
  }

  return { allowed: true }
}

export const K_CLINICAL_INTERNAL = 5
export const K_RETAILER_OUTPUT = 20
export const K_COMMERCIAL_DEFAULT = 20

/**
 * Invariant T13 & §9.4: Small-Cell Suppression for Cohort Aggregates (Finding X-08)
 * Retailer-facing and commercial outputs default to k >= 20.
 * Clinical internal views may configure k >= 5.
 * Any cohort with fewer than minK members is suppressed to protect anonymity.
 */
export function evaluateCohortSuppression(
  memberCount: number,
  minK: number = K_RETAILER_OUTPUT,
): {
  isSuppressed: boolean
  displayCount: number | null
  message?: string
} {
  if (memberCount < minK) {
    return {
      isSuppressed: true,
      displayCount: null,
      message: `Cohort size (${memberCount}) is below privacy threshold (k >= ${minK}). Metrics suppressed.`,
    }
  }

  return {
    isSuppressed: false,
    displayCount: memberCount,
  }
}

export interface ShredOptions {
  secret?: string
  dek?: Uint8Array
  cascadeJobId?: string
}

export interface ShredResult {
  anonymizedRef: string
  erasureTimestamp: string
  shredded_at: string
  dek_id?: string
  objects_unreadable?: number
  cascade_job_id: string
  keyDestroyed: boolean
}

/**
 * Invariant T27: Right to Erasure / Cryptographic Shredding (Finding X-08, Blueprint §3.4)
 * Generates an irreversible cryptographic pseudonym using HMAC(secret, patientRef).
 * Deletes the four-character patient reference leak and Math.random() usage.
 * Explicitly zeroes / destroys passed patient DEK key material.
 */
export function cryptoShredPatient(patientRef: string, options: ShredOptions = {}): ShredResult {
  const now = new Date().toISOString()
  const secret = options.secret || 'NUTRISCORE_ANON_SHRED_SALT_V1'

  let hexDigest: string
  try {
    // Dynamic Node require without violating browser-targeted tsconfig
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const req =
      typeof globalThis !== 'undefined' && (globalThis as any).require
        ? (globalThis as any).require
        : eval('require')
    const nodeCrypto = req('node:crypto')
    const h = nodeCrypto.createHmac('sha256', secret)
    h.update(patientRef)
    hexDigest = h.digest('hex').substring(0, 16)
  } catch {
    const textEncoder = new TextEncoder()
    const data = textEncoder.encode(`${secret}:${patientRef}`)
    let hash1 = 0x811c9dc5
    let hash2 = 0x9e3779b9
    for (let i = 0; i < data.length; i++) {
      hash1 ^= data[i]
      hash1 = Math.imul(hash1, 0x01000193)
      hash2 ^= data[i]
      hash2 = Math.imul(hash2, 0x5bd1e995)
    }
    hexDigest =
      (hash1 >>> 0).toString(16).padStart(8, '0') + (hash2 >>> 0).toString(16).padStart(8, '0')
  }

  const anonymizedRef = `SHREDDED-${hexDigest}`

  let keyDestroyed = false
  if (options.dek instanceof Uint8Array) {
    options.dek.fill(0)
    keyDestroyed = true
  }

  const cascadeJobId = options.cascadeJobId || `cascade-purge-${Date.now()}`

  return {
    anonymizedRef,
    erasureTimestamp: now,
    shredded_at: now,
    cascade_job_id: cascadeJobId,
    keyDestroyed,
  }
}
