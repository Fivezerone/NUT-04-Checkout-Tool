// src/shared/rbac.ts
// Shared RBAC definitions and claims helper for Clinic Admin Dashboard (CAD)

export type CadRole =
  | 'super_admin'
  | 'compliance_auditor'
  | 'tenant_admin'
  | 'writing_clinician'
  | 'viewing_dietician'
  | 'commercial_stakeholder'
  | 'patient'

export interface CadClaims {
  userId: string
  tenantId: string
  role: CadRole
  licenceVerified?: boolean
  email?: string
}

/**
 * Extracts and decodes JWT payload claims from the Authorization Bearer header.
 */
export function extractClaims(req: Request): CadClaims | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.slice(7).trim()
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }

  try {
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const decoded =
      typeof atob !== 'undefined'
        ? atob(payloadBase64)
        : typeof (globalThis as any).Buffer !== 'undefined'
          ? (globalThis as any).Buffer.from(payloadBase64, 'base64').toString('utf8')
          : ''
    const json = JSON.parse(decoded)

    return {
      userId: json.sub || json.user_id || '',
      tenantId:
        json.tenant_id || json.app_metadata?.tenant_id || '00000000-0000-0000-0000-000000000000',
      role: (json.role || json.app_metadata?.role || 'patient') as CadRole,
      licenceVerified: Boolean(json.licence_verified || json.app_metadata?.licence_verified),
      email: json.email,
    }
  } catch {
    return null
  }
}

/**
 * Guards an endpoint by enforcing that the caller has one of the allowed roles.
 * Returns either the verified claims, or a 401/403 Response.
 */
export function requireRole(
  req: Request,
  allowedRoles: CadRole[],
  options?: { requireLicence?: boolean },
): { claims: CadClaims } | { errorResponse: Response } {
  const claims = extractClaims(req)
  if (!claims || !claims.userId) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'unauthorized',
          message: 'Missing or malformed Authorization token',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    }
  }

  // Super admin bypasses role check except for explicit restrictions
  if (claims.role !== 'super_admin' && !allowedRoles.includes(claims.role)) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'forbidden',
          message: `Role '${claims.role}' is not authorized. Required: ${allowedRoles.join(', ')}`,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    }
  }

  // If clinician licence verification is required
  if (options?.requireLicence && claims.role === 'writing_clinician' && !claims.licenceVerified) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'licence_unverified',
          message: 'Writing clinician licence has not been verified by tenant administrator',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    }
  }

  return { claims }
}
