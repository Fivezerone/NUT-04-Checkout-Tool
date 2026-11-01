import { claimsFromRequest, type CadRole, type CanonicalClaims } from './claims'

export type { CadRole, CanonicalClaims as CadClaims }

export function extractClaims(req: Request): CanonicalClaims | null {
  return claimsFromRequest(req)
}

export function requireRole(
  req: Request,
  allowedRoles: CadRole[],
  options?: { requireLicence?: boolean },
): { claims: CanonicalClaims } | { errorResponse: Response } {
  const claims = extractClaims(req)
  if (!claims?.sub) {
    return {
      errorResponse: new Response(
        JSON.stringify({ error: 'unauthorized', message: 'Unauthorized' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    }
  }

  if (!allowedRoles.includes(claims.appRole)) {
    return {
      errorResponse: new Response(JSON.stringify({ error: 'forbidden', message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    }
  }

  if (options?.requireLicence && claims.appRole === 'writing_clinician' && !claims.licOk) {
    return {
      errorResponse: new Response(JSON.stringify({ error: 'forbidden', message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    }
  }

  return { claims }
}
