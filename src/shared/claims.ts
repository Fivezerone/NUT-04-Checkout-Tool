import { CLAIM_SCHEMA_VERSION } from './constants'

export const CAD_ROLES = [
  'super_admin',
  'tenant_admin',
  'writing_clinician',
  'viewing_dietician',
  'compliance_auditor',
  'commercial_stakeholder',
  'patient',
] as const

export type CadRole = (typeof CAD_ROLES)[number]
export type AuditorScope = 'tenant' | 'platform'

/** The only application-facing representation of access-token claims. */
export interface CanonicalClaims {
  sub: string
  sid: string
  tenantId: string | null
  appRole: CadRole
  licOk: boolean
  auditorScope?: AuditorScope
  acr?: string
  ver: number
}

type RawClaims = Record<string, unknown>

function isRecord(value: unknown): value is RawClaims {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCadRole(value: unknown): value is CadRole {
  return typeof value === 'string' && (CAD_ROLES as readonly string[]).includes(value)
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    if (typeof atob === 'function') return atob(normalized)
    const BufferCtor = (
      globalThis as {
        Buffer?: { from: (s: string, e: string) => { toString: (e: string) => string } }
      }
    ).Buffer
    return BufferCtor?.from(normalized, 'base64').toString('utf8') ?? null
  } catch {
    return null
  }
}

/**
 * Maps verified Supabase or OIDC claim names to the canonical contract.
 * Do not read raw token payload fields outside this module.
 */
export function canonicalizeClaims(raw: unknown): CanonicalClaims | null {
  if (!isRecord(raw) || typeof raw.sub !== 'string' || !isCadRole(raw.app_role)) return null

  const sid =
    typeof raw.sid === 'string'
      ? raw.sid
      : typeof raw.session_id === 'string'
        ? raw.session_id
        : null
  if (!sid) return null

  const tenantId = typeof raw.tenant_id === 'string' ? raw.tenant_id : null
  const auditorScope =
    raw.auditor_scope === 'tenant' || raw.auditor_scope === 'platform'
      ? raw.auditor_scope
      : undefined
  if (raw.app_role === 'compliance_auditor' ? !auditorScope : Boolean(auditorScope)) return null

  return {
    sub: raw.sub,
    sid,
    tenantId,
    appRole: raw.app_role,
    licOk: raw.lic_ok === true,
    auditorScope,
    acr: typeof raw.acr === 'string' ? raw.acr : typeof raw.aal === 'string' ? raw.aal : undefined,
    ver: typeof raw.ver === 'number' ? raw.ver : CLAIM_SCHEMA_VERSION,
  }
}

export function claimsFromAccessToken(
  accessToken: string | null | undefined,
): CanonicalClaims | null {
  if (!accessToken) return null
  const segments = accessToken.split('.')
  if (segments.length !== 3) return null
  const decoded = decodeBase64Url(segments[1])
  if (!decoded) return null
  try {
    return canonicalizeClaims(JSON.parse(decoded))
  } catch {
    return null
  }
}

export function claimsFromRequest(request: Request): CanonicalClaims | null {
  const authorization = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  return claimsFromAccessToken(authorization.slice('Bearer '.length).trim())
}
