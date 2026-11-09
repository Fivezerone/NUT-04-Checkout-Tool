/**
 * NutriScore CAD Phase 9 — Patient Data Subject Export Service
 *
 * Reference: Blueprint §4.1, Decision D5, Kenya Data Protection Act 2019 (s. 40 - Right of Access/Portability)
 *
 * Generates an end-to-end verifiable, signed export bundle for a data subject.
 * The bundle packages all patient-associated healthcare and commercial records,
 * computes an immutable SHA-256 digest, signs it with the Stage A Ed25519 Signer,
 * and formats the EXPORT_PATIENT_DATA audit event for the WORM ledger.
 */

import { createHash } from 'node:crypto'
import { Signer, LocalEd25519Signer } from './signer.js'

export interface PatientExportProfile {
  id: string
  tenantId: string
  medicalRecordNumber?: string
  dateOfBirth?: string
  gender?: string
  restricted?: boolean
  createdAt: string
  updatedAt?: string
}

export interface PatientExportClinicalRecord {
  id: string
  recordType: string
  version: number
  classification: string
  body: Record<string, unknown> | string
  createdAt: string
}

export interface PatientExportClinicalAdvice {
  id: string
  authorId: string
  content: string
  version: number
  createdAt: string
}

export interface PatientExportConsent {
  id: string
  purpose: string
  granted: boolean
  lawfulBasis: string[]
  policyVersion: string
  grantedAt: string
}

export interface PatientExportObservedOrder {
  id: string
  retailer: string
  placedAt: string
  linesCount: number
  source: string
}

export interface PatientDataPayload {
  profile: PatientExportProfile
  clinicalRecords: PatientExportClinicalRecord[]
  clinicalAdvice: PatientExportClinicalAdvice[]
  tags: string[]
  consents: PatientExportConsent[]
  observedOrders: PatientExportObservedOrder[]
}

export interface SignedPatientExportBundle {
  exportId: string
  tenantId: string
  patientId: string
  exportedAt: string
  exporter: {
    actorId: string
    actorRole: string
  }
  data: PatientDataPayload
  digest: string // hex SHA-256 of canonical data
  signature: string // base64url Ed25519 signature
  signerKid: string
  specification: 'CAD-DPA2019-PORTABILITY-v1'
}

export interface ExportAuditPayload {
  exportId: string
  patientId: string
  actorId: string
  actorRole: string
  digest: string
  signerKid: string
  exportedAt: string
  recordsExported: {
    clinicalRecordsCount: number
    adviceCount: number
    consentsCount: number
    ordersCount: number
  }
}

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj)
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']'
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`,
  )
  return '{' + entries.join(',') + '}'
}

/**
 * Computes the SHA-256 digest of the patient data payload.
 */
export function computePatientDataDigest(data: PatientDataPayload): string {
  const canonical = canonicalJson(data)
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Creates and cryptographically signs a patient portability export bundle.
 */
export async function createSignedPatientExport(
  tenantId: string,
  patientId: string,
  data: PatientDataPayload,
  exporter: { actorId: string; actorRole: string },
  signer: Signer,
  options: { exportId?: string; timestamp?: string } = {},
): Promise<{
  bundle: SignedPatientExportBundle
  auditPayload: ExportAuditPayload
}> {
  if (!tenantId || !patientId) {
    throw new Error('tenantId and patientId are required for patient export')
  }

  const exportId = options.exportId || crypto.randomUUID()
  const exportedAt = options.timestamp || new Date().toISOString()
  const digest = computePatientDataDigest(data)

  // Signing message format: exportId.tenantId.patientId.digest
  const signingMessage = `${exportId}.${tenantId}.${patientId}.${digest}`
  const signatureBytes = await signer.sign(Buffer.from(signingMessage, 'utf8'))
  const signature = Buffer.from(signatureBytes).toString('base64url')

  const bundle: SignedPatientExportBundle = {
    exportId,
    tenantId,
    patientId,
    exportedAt,
    exporter: {
      actorId: exporter.actorId,
      actorRole: exporter.actorRole,
    },
    data,
    digest,
    signature,
    signerKid: signer.getKid(),
    specification: 'CAD-DPA2019-PORTABILITY-v1',
  }

  const auditPayload: ExportAuditPayload = {
    exportId,
    patientId,
    actorId: exporter.actorId,
    actorRole: exporter.actorRole,
    digest,
    signerKid: signer.getKid(),
    exportedAt,
    recordsExported: {
      clinicalRecordsCount: data.clinicalRecords.length,
      adviceCount: data.clinicalAdvice.length,
      consentsCount: data.consents.length,
      ordersCount: data.observedOrders.length,
    },
  }

  return { bundle, auditPayload }
}

/**
 * Verifies the integrity and signature of a patient export bundle.
 */
export function verifyPatientExport(
  bundle: SignedPatientExportBundle,
  signer: LocalEd25519Signer,
): boolean {
  // 1. Verify SHA-256 data digest matches bundle content
  const expectedDigest = computePatientDataDigest(bundle.data)
  if (expectedDigest !== bundle.digest) {
    return false
  }

  // 2. Verify Ed25519 signature
  const signingMessage = `${bundle.exportId}.${bundle.tenantId}.${bundle.patientId}.${bundle.digest}`
  const signatureBytes = Buffer.from(bundle.signature, 'base64url')

  return signer.verify(Buffer.from(signingMessage, 'utf8'), signatureBytes)
}
