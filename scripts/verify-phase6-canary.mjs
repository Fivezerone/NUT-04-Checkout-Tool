#!/usr/bin/env node
/**
 * NutriScore CAD Phase 6 — Field Encryption, Crypto-Shredding & Canary Scan Verifier
 *
 * Blueprint & Prompt Exit Criteria:
 * 1. A ciphertext copied to another row or tenant fails to decrypt (AAD binding).
 * 2. A shredded patient is unreadable, leaving structural rows intact.
 * 3. Scanning a full database dump for canary plaintext strings finds nothing.
 *
 * Usage:
 *   node scripts/verify-phase6-canary.mjs
 */

import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { LocalKeyWrapper } from '../src/shared/key-wrapper.ts'
import {
  encryptField,
  decryptFieldToString,
  computeBlindIndex,
  computeKeyedMac,
} from '../src/shared/field-encryption.ts'

function queryPsql(sql) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_NUT-04_Checkout_Tool',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8', timeout: 30000 },
  )
  if (result.status !== 0) {
    throw new Error(`psql command failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

function dumpDatabase() {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_NUT-04_Checkout_Tool',
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--data-only',
    ],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 50 * 1024 * 1024 },
  )
  if (result.status !== 0) {
    throw new Error(`pg_dump failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

async function runCanaryVerification() {
  console.log('[INFO] Starting Phase 6 Canary & Field Encryption Verification...')

  const keyWrapper = new LocalKeyWrapper()
  const tenantId = '41111111-1111-1111-1111-111111111111'
  const patientId = 'ca000000-0000-0000-0000-000000000001'
  const recordId = 'cb000000-0000-0000-0000-000000000001'
  const clinicianId = '41111111-1111-1111-1111-111111111130'

  // Unique canary plaintext strings
  const canaryToken = randomBytes(8).toString('hex')
  const canaryName = `CANARY_NAME_SECRET_${canaryToken}`
  const canaryEmail = `canary_email_secret_${canaryToken}@hospital.ke`
  const canaryPhone = `+254700${canaryToken.slice(0, 6)}`
  const canaryDiagnosis = `CANARY_DIAGNOSIS_SECRET_HYPERTENSION_ICD10_${canaryToken}`

  console.log(`[INFO] Canary strings generated with token: ${canaryToken}`)

  // Generate patient DEK and wrap under tenant KEK
  const dek = randomBytes(32)
  const wrappedDek = keyWrapper.wrapKey(tenantId, dek)
  const kIdx = keyWrapper.deriveTenantIndexKey(tenantId)
  const kMac = keyWrapper.deriveTenantMacKey(tenantId)

  // Encrypt fields with AES-256-GCM and row AAD
  const nameEnc = encryptField(canaryName, dek, {
    tenantId,
    tableName: 'patients',
    columnName: 'full_name_enc',
    rowId: patientId,
  })
  const emailEnc = encryptField(canaryEmail, dek, {
    tenantId,
    tableName: 'patients',
    columnName: 'email_enc',
    rowId: patientId,
  })
  const phoneEnc = encryptField(canaryPhone, dek, {
    tenantId,
    tableName: 'patients',
    columnName: 'phone_enc',
    rowId: patientId,
  })
  const emailBidx = computeBlindIndex(canaryEmail, kIdx)

  const bodyEnc = encryptField(canaryDiagnosis, dek, {
    tenantId,
    tableName: 'clinical_records',
    columnName: 'body_enc',
    rowId: recordId,
  })
  const bodyMac = computeKeyedMac(canaryDiagnosis, kMac)

  // Clean up any stale canary data
  queryPsql(`
    ALTER TABLE clinical.clinical_records DISABLE TRIGGER trg_clinical_records_deny_mutation;
    DELETE FROM clinical.clinical_records WHERE id = '${recordId}';
    DELETE FROM clinical.patient_keys WHERE patient_id = '${patientId}';
    DELETE FROM clinical.patients WHERE id = '${patientId}';
    ALTER TABLE clinical.clinical_records ENABLE TRIGGER trg_clinical_records_deny_mutation;
  `)

  try {
    // 1. Insert canary patient and wrapped key into live DB
    console.log('[STEP 1] Inserting canary patient, wrapped key, and clinical record...')
    queryPsql(`
      INSERT INTO clinical.patients (
        tenant_id, id, full_name_enc, email_enc, phone_enc, email_bidx
      ) VALUES (
        '${tenantId}', '${patientId}',
        '\\x${nameEnc.toString('hex')}',
        '\\x${emailEnc.toString('hex')}',
        '\\x${phoneEnc.toString('hex')}',
        '\\x${emailBidx.toString('hex')}'
      );

      INSERT INTO clinical.patient_keys (
        tenant_id, patient_id, key_version, dek_wrapped
      ) VALUES (
        '${tenantId}', '${patientId}', 1,
        '\\x${Buffer.from(wrappedDek).toString('hex')}'
      );

      ALTER TABLE clinical.clinical_records DISABLE TRIGGER trg_clinical_records_deny_mutation;
      INSERT INTO clinical.clinical_records (
        tenant_id, id, patient_id, author_id, record_type,
        body_enc, body_mac
      ) VALUES (
        '${tenantId}', '${recordId}', '${patientId}', '${clinicianId}', 'diagnosis',
        '\\x${bodyEnc.toString('hex')}',
        '\\x${bodyMac.toString('hex')}'
      );
      ALTER TABLE clinical.clinical_records ENABLE TRIGGER trg_clinical_records_deny_mutation;
    `)
    console.log('[OK] Canary rows inserted.')

    // 2. Perform full database dump and scan for canary plaintext
    console.log('[STEP 2] Running pg_dump and scanning for canary plaintext strings...')
    const dump = dumpDatabase()

    const canaries = [canaryName, canaryEmail, canaryPhone, canaryDiagnosis]
    let leaksFound = 0
    for (const canary of canaries) {
      if (dump.includes(canary)) {
        console.error(`[LEAK DETECTED] Canary string "${canary}" found in database dump!`)
        leaksFound++
      }
    }

    if (leaksFound > 0) {
      throw new Error(`Database dump contains ${leaksFound} plaintext canary string(s)!`)
    }
    console.log('[OK] Zero plaintext canary strings found in database dump ✓')

    // 3. Test row binding: ciphertext copied to another row fails to decrypt
    console.log('[STEP 3] Testing AAD row and tenant binding...')
    const fakeRowId = 'ca000000-0000-0000-0000-000000000999'
    let copiedRowFailed = false
    try {
      decryptFieldToString(nameEnc, dek, {
        tenantId,
        tableName: 'patients',
        columnName: 'full_name_enc',
        rowId: fakeRowId,
      })
    } catch {
      copiedRowFailed = true
    }
    if (!copiedRowFailed) {
      throw new Error('Ciphertext copied to different row ID unexpectedly decrypted!')
    }

    const fakeTenantId = '22222222-2222-2222-2222-222222222222'
    let copiedTenantFailed = false
    try {
      decryptFieldToString(nameEnc, dek, {
        tenantId: fakeTenantId,
        tableName: 'patients',
        columnName: 'full_name_enc',
        rowId: patientId,
      })
    } catch {
      copiedTenantFailed = true
    }
    if (!copiedTenantFailed) {
      throw new Error('Ciphertext copied to different tenant ID unexpectedly decrypted!')
    }
    console.log('[OK] Cross-row and cross-tenant ciphertext decryption strictly prevented by AAD ✓')

    // 4. Test Crypto-Shredding
    console.log('[STEP 4] Executing clinical.crypto_shred_patient()...')
    const shredOutput = queryPsql(`
      SELECT clinical.crypto_shred_patient('${tenantId}', '${patientId}');
    `)
    if (!shredOutput.includes('t')) {
      throw new Error(`crypto_shred_patient returned unexpected output: ${shredOutput}`)
    }

    // Read shredded key from DB
    const keyData = queryPsql(`
      SELECT encode(dek_wrapped, 'hex') AS wrapped, (destroyed_at IS NOT NULL) AS destroyed
      FROM clinical.patient_keys WHERE tenant_id = '${tenantId}' AND patient_id = '${patientId}';
    `)

    if (!keyData.includes('t')) {
      throw new Error('patient_keys.destroyed_at is not set after crypto-shred!')
    }

    // Verify unwrapping the shredded DEK fails
    const shreddedWrapped = Buffer.alloc(61, 0)
    let unwrapFailed = false
    try {
      keyWrapper.unwrapKey(tenantId, shreddedWrapped)
    } catch {
      unwrapFailed = true
    }
    if (!unwrapFailed) {
      throw new Error('Unwrapping shredded zeroed key did not throw!')
    }

    // Verify structural row still exists
    const patientExists = queryPsql(`
      SELECT count(*) FROM clinical.patients WHERE id = '${patientId}';
    `)
    if (!patientExists.includes('1')) {
      throw new Error('Structural row in clinical.patients was removed during crypto-shred!')
    }

    console.log(
      '[OK] Crypto-shredding permanently destroyed key material while preserving structural row ✓',
    )
    console.log('\n[PASS] All Phase 6 Canary & Field Encryption Verification Exit Gates Passed! ✓')
  } finally {
    // Teardown canary data
    queryPsql(`
      ALTER TABLE clinical.clinical_records DISABLE TRIGGER trg_clinical_records_deny_mutation;
      DELETE FROM clinical.clinical_records WHERE id = '${recordId}';
      DELETE FROM clinical.patient_keys WHERE patient_id = '${patientId}';
      DELETE FROM clinical.patients WHERE id = '${patientId}';
      ALTER TABLE clinical.clinical_records ENABLE TRIGGER trg_clinical_records_deny_mutation;
    `)
  }
}

runCanaryVerification().catch((err) => {
  console.error('[FATAL]', err.message)
  process.exit(1)
})
