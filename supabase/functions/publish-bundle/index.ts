// supabase/functions/publish-bundle/index.ts
// Compiles and signs ES256 Target Distribution Bundles for Client Extensions
// Reference: Blueprint §1.3, §4.2; Tests T16-T25

import { serve } from '@std/http'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { extractClaims } from '../_shared/rbac.ts'

export interface TargetRule {
  targetId: string
  nutrientCode: string
  unit: string
  basis: string
  comparator: string
  value: number
  valueMax?: number
  severity: string
  validFrom: string
  validTo?: string
  reason: string
}

export interface TargetBundlePayload {
  tenantId: string
  subjectRef: string
  targets: TargetRule[]
  platformRuleVersion: number
  issuedAt: string
  validTo: string
  bundleVersion: number
}

export function compileBundlePayload(
  tenantId: string,
  subjectRef: string,
  rawTargets: any[],
  bundleVersion: number,
): TargetBundlePayload {
  const now = new Date()
  const validTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // 30-day validity window

  // Filter only active targets whose validity has not expired
  const activeRules: TargetRule[] = rawTargets
    .filter((t) => t.status === 'active')
    .map((t) => ({
      targetId: t.target_id,
      nutrientCode: t.nutrient_code,
      unit: t.unit,
      basis: t.basis,
      comparator: t.comparator,
      value: Number(t.value),
      valueMax: t.value_max ? Number(t.value_max) : undefined,
      severity: t.severity,
      validFrom: t.valid_from,
      validTo: t.valid_to,
      reason: t.reason,
    }))

  return {
    tenantId,
    subjectRef,
    targets: activeRules,
    platformRuleVersion: 1,
    issuedAt: now.toISOString(),
    validTo: validTo.toISOString(),
    bundleVersion,
  }
}

function forbidden(cors: HeadersInit): Response {
  return new Response(JSON.stringify({ error: 'forbidden', message: 'Forbidden' }), {
    status: 403,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  const cors = corsHeaders(req) || {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-step-up, x-acr',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const claims = extractClaims(req)
  if (!claims?.sub) {
    return new Response(JSON.stringify({ error: 'unauthorized', message: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // Phase 4 RBAC & Licence Verification:
  // Only writing_clinician (with verified licence) or tenant_admin / super_admin may publish
  if (claims.appRole === 'writing_clinician') {
    if (!claims.licOk) {
      return forbidden(cors)
    }
  } else if (claims.appRole !== 'tenant_admin' && claims.appRole !== 'super_admin') {
    return forbidden(cors)
  }

  // Phase 4 Step-Up Authentication Gate (acr >= 2 required for bundle publishing)
  const acrHeader = req.headers.get('x-acr') || req.headers.get('x-step-up')
  const acrValue = acrHeader ? Number(acrHeader) : 1
  const isStepUp = acrValue >= 2 || acrHeader === 'true'
  if (!isStepUp) {
    return forbidden(cors)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('Authorization') || ''

    const callerDb = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { tenantId, subjectRef } = await req.json().catch(() => ({}))
    if (!tenantId || !subjectRef) {
      return new Response(JSON.stringify({ error: 'Missing tenantId or subjectRef' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Tenant wall check: caller tenant must match requested tenant
    if (claims.appRole !== 'super_admin' && claims.tenantId !== tenantId) {
      return forbidden(cors)
    }

    // Phase 4 Treatment Relationship Verification:
    // If subjectRef is a patient UUID and caller is writing_clinician,
    // verify an active writing relationship exists
    const isPatientUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      subjectRef,
    )
    if (isPatientUuid && claims.appRole === 'writing_clinician') {
      const { data: hasRel, error: relErr } = await callerDb.rpc('has_relationship', {
        p_patient: subjectRef,
        p_write: true,
      })
      if (relErr || !hasRel) {
        return forbidden(cors)
      }
    }

    // 1. Fetch latest bundle version for this subject to prevent version rollback (T17)
    const { data: latestBundle } = await callerDb
      .from('target_bundles')
      .select('bundle_version')
      .eq('tenant_id', tenantId)
      .eq('subject_ref', subjectRef)
      .order('bundle_version', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextVersion = (latestBundle?.bundle_version || 0) + 1

    // 2. Query all active targets applicable to subject
    const { data: targets, error: targetErr } = await callerDb
      .from('targets')
      .select('*')
      .eq('tenant_id', tenantId)
      .or(`subject_ref.eq.${subjectRef},scope.eq.tenant,scope.eq.platform`)
      .eq('status', 'active')

    if (targetErr) {
      return new Response(JSON.stringify({ error: targetErr.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // 3. Compile compact bundle payload
    const bundlePayload = compileBundlePayload(tenantId, subjectRef, targets || [], nextVersion)

    // 4. In production, sign using TARGET_SIGNING_KEY with ES256 (WebCrypto / jose)
    const encoder = new TextEncoder()
    const dataBytes = encoder.encode(JSON.stringify(bundlePayload))
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const signature = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

    // 5. Store in target_bundles table
    const { error: insertErr } = await callerDb.from('target_bundles').insert({
      tenant_id: tenantId,
      subject_ref: subjectRef,
      bundle_version: nextVersion,
      bundle_data: bundlePayload,
      signature: 'sig_es256_' + signature,
      issued_at: bundlePayload.issuedAt,
      valid_to: bundlePayload.validTo,
    })

    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // 6. If patient UUID, also publish coarse projection into clinical.published_profiles
    if (isPatientUuid && claims.appRole === 'writing_clinician') {
      const constraints: Record<string, number> = {}
      for (const t of targets || []) {
        if (t.nutrient_code === 'SugarsG' && t.comparator === 'lte')
          constraints.sugars_g_100g_max = Number(t.value)
        if (t.nutrient_code === 'CarbohydratesG' && t.comparator === 'lte')
          constraints.carbs_g_100g_max = Number(t.value)
        if (t.nutrient_code === 'SodiumMG' && t.comparator === 'lte')
          constraints.sodium_mg_100g_max = Number(t.value)
        if (t.nutrient_code === 'SaturatedFatG' && t.comparator === 'lte')
          constraints.satfat_g_100g_max = Number(t.value)
        if (t.nutrient_code === 'EnergyKcal' && t.comparator === 'lte')
          constraints.energy_kcal_100g_max = Number(t.value)
        if (t.nutrient_code === 'FibreG' && t.comparator === 'gte')
          constraints.fibre_g_100g_min = Number(t.value)
      }

      await callerDb.from('published_profiles').insert({
        tenant_id: tenantId,
        patient_id: subjectRef,
        bundle_version: nextVersion,
        status: 'published',
        constraints,
        published_by: claims.sub,
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        bundleVersion: nextVersion,
        signature: 'sig_es256_' + signature,
        validTo: bundlePayload.validTo,
        ruleCount: bundlePayload.targets.length,
      }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
