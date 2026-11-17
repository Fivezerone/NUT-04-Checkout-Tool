import {
  claimsFromRequest,
  type CadRole,
  type CanonicalClaims,
  type VerifiedClaims,
  isVerifiedClaims,
} from './claims'

export type { CadRole, CanonicalClaims as CadClaims, VerifiedClaims }
export { isVerifiedClaims }

export function extractClaims(req: Request): CanonicalClaims | null {
  return claimsFromRequest(req)
}

export function requireRole(
  req: Request,
  allowedRoles: CadRole[],
  options?: {
    requireLicence?: boolean
    claims?: VerifiedClaims | CanonicalClaims
    requireVerified?: boolean
  },
): { claims: CanonicalClaims } | { errorResponse: Response } {
  const claims = options?.claims ?? extractClaims(req)
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

  if (options?.requireVerified && !isVerifiedClaims(claims)) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'unauthorized',
          message: 'Cryptographically verified claims required',
        }),
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
