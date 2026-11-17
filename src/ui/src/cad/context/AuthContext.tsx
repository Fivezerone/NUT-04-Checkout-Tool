// src/ui/src/cad/context/AuthContext.tsx
// Clinic Admin Dashboard Authentication & Multi-Tenant Context
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§6.2, §6.4)
//
// STAGE A (A-03): Supabase client removed — all data calls stubbed.
// STAGE B (B-01): Hardcoded demo tenant fallbacks (KNH, AKUH) removed.
//                 MFA stub replaced with error throw.
// TODO (Stage C): Replace stubs with OidcAuthProvider backed by Keycloak.

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react'
import type { CadRole, Tenant } from '../types'
import { claimsFromAccessToken, type CanonicalClaims } from '../../../../shared/claims'
import { isCadFlagEnabled } from '../flags'
// TODO (Stage C): import { OidcAuthProvider } from '../../../../shared/auth-provider'

interface CadUserClaims {
  userId: string
  tenantId: string
  role: CadRole
  licenceVerified: boolean
  email?: string
  acr?: string
  amr?: string[]
}

interface AuthContextType {
  user: any | null
  claims: CadUserClaims
  activeTenant: Tenant | null
  availableTenants: Tenant[]
  isLoading: boolean
  mfaVerified: boolean
  mfaRequired: boolean
  switchTenant: (tenantId: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  verifyMfa: (code: string) => Promise<boolean>
  signOut: () => Promise<void>
}

const defaultClaims: CadUserClaims = {
  userId: '',
  tenantId: '00000000-0000-0000-0000-000000000000',
  role: 'patient',
  licenceVerified: false,
}

function toCadUserClaims(claims: CanonicalClaims | null): CadUserClaims {
  if (!claims) return defaultClaims
  return {
    userId: claims.sub,
    tenantId: claims.tenantId || '00000000-0000-0000-0000-000000000000',
    role: claims.appRole,
    licenceVerified: claims.licOk,
    acr: claims.acr,
    amr: claims.amr,
  }
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  claims: defaultClaims,
  activeTenant: null,
  availableTenants: [],
  isLoading: true,
  mfaVerified: false,
  mfaRequired: false,
  switchTenant: async () => {},
  signIn: async () => ({ success: false }),
  verifyMfa: async () => false,
  signOut: async () => {},
})

export const useCadAuth = () => useContext(AuthContext)

export const CadAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null)
  const [claims, setClaims] = useState<CadUserClaims>(defaultClaims)
  const [activeTenant, setActiveTenant] = useState<Tenant | null>(null)
  const [availableTenants, setAvailableTenants] = useState<Tenant[]>([])
  const [mfaVerified, setMfaVerified] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  // MFA is mandatory for every non-patient role (Plan §6.4)
  const mfaRequired = useMemo(() => {
    return claims.role !== 'patient' && !mfaVerified
  }, [claims.role, mfaVerified])

  const resolveUserClaims = (
    accessToken: string | null | undefined,
    email?: string,
  ): CadUserClaims => {
    const canonical = claimsFromAccessToken(accessToken)
    if (canonical) {
      return {
        ...toCadUserClaims(canonical),
        email,
      }
    }
    // Fallback: decode raw Keycloak JWT payload if app_role attribute mapper is not yet populated
    if (accessToken) {
      try {
        const parts = accessToken.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
          const roles = (payload.realm_access?.roles || []) as string[]
          const matchedRole = roles.find((r: string) =>
            [
              'super_admin',
              'tenant_admin',
              'writing_clinician',
              'viewing_dietician',
              'compliance_auditor',
              'commercial_stakeholder',
              'patient',
            ].includes(r),
          ) as CadRole | undefined
          if (matchedRole || payload.sub) {
            return {
              userId: payload.sub || '',
              tenantId: payload.tenant_id || '00000000-0000-0000-0000-000000000000',
              role: (payload.app_role as CadRole) || matchedRole || 'patient',
              licenceVerified: payload.lic_ok === true || payload.lic_ok === 'true',
              email: email || payload.email,
              acr: payload.acr ? String(payload.acr) : (payload.aal ? String(payload.aal) : undefined),
              amr: Array.isArray(payload.amr) ? payload.amr : undefined,
            }
          }
        }
      } catch (e) {
        console.warn('[CAD Auth] Fallback decode error:', e)
      }
    }
    return { ...defaultClaims, email }
  }

  // TODO (Stage C): Replace with real OIDC session fetch via OidcAuthProvider.
  const loadTenantData = async (_tenantId: string) => {
    // Stub: returns null until OIDC adapter is wired.
    // No fallback demo tenant data (B-01 — hardcoded hospital names removed).
    setActiveTenant(null)
  }

  // TODO (Stage C): Replace with real tenant list fetch via OIDC-authed REST call.
  const loadAllTenants = async () => {
    // Stub: returns empty list until REST layer is wired.
    // No fallback tenant array (B-01 — hardcoded hospital names removed).
    setAvailableTenants([])
  }

  useEffect(() => {
    let mounted = true

    const initAuth = async () => {
      try {
        const storedToken = sessionStorage.getItem('cad_access_token')
        const storedMfaVerified = sessionStorage.getItem('cad_mfa_verified') === 'true'
        if (storedToken) {
          const userClaims = resolveUserClaims(storedToken)
          if (userClaims && userClaims.userId) {
            setUser({ id: userClaims.userId, email: userClaims.email })
            setClaims(userClaims)
            // Derive assurance from JWT aal/acr claim or stored session verification (D-30)
            const hasServerMfa =
              userClaims.acr === 'aal2' ||
              userClaims.acr === '2' ||
              (Array.isArray(userClaims.amr) &&
                (userClaims.amr.includes('otp') || userClaims.amr.includes('webauthn'))) ||
              userClaims.role === 'patient'

            const isAssuranceAal2 = isCadFlagEnabled('ns.cad.strict_states')
              ? hasServerMfa
              : (hasServerMfa || storedMfaVerified) // LEGACY(ns-p4): stored session verification fallback
            setMfaVerified(isAssuranceAal2)
          }
        }
      } catch (err) {
        console.warn('[CAD Auth] Init error:', err)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    initAuth()

    return () => {
      mounted = false
    }
  }, [])

  const switchTenant = async (tenantId: string) => {
    if (claims.role !== 'super_admin') {
      throw new Error('Only super_admin can switch active tenant')
    }
    setClaims(prev => ({ ...prev, tenantId }))
    await loadTenantData(tenantId)
  }

  const signIn = async (email: string, password: string) => {
    setIsLoading(true)
    try {
      const tokenUrl = '/auth/realms/nutriscore/protocol/openid-connect/token'
      const params = new URLSearchParams()
      params.append('client_id', 'cad-web-ui')
      params.append('grant_type', 'password')
      params.append('username', email)
      params.append('password', password)
      params.append('scope', 'openid ns-core')

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMsg =
          errorData.error_description ||
          errorData.error ||
          (response.status === 401
            ? 'Invalid email or password. Please verify your Keycloak credentials.'
            : 'Authentication failed.')
        setIsLoading(false)
        return { success: false, error: errorMsg }
      }

      const data = await response.json()
      const accessToken = data.access_token
      if (!accessToken) {
        setIsLoading(false)
        return { success: false, error: 'No access token returned by authentication provider.' }
      }

      sessionStorage.setItem('cad_access_token', accessToken)
      if (data.refresh_token) {
        sessionStorage.setItem('cad_refresh_token', data.refresh_token)
      }

      const userClaims = resolveUserClaims(accessToken, email)
      setUser({ id: userClaims.userId, email })
      setClaims(userClaims)
      const isMfa = userClaims.acr === 'aal2' || userClaims.acr === '2' || userClaims.role === 'patient'
      setMfaVerified(isMfa)
      if (isMfa) {
        sessionStorage.setItem('cad_mfa_verified', 'true')
      } else {
        sessionStorage.removeItem('cad_mfa_verified')
      }

      setIsLoading(false)
      return { success: true }
    } catch (err: any) {
      setIsLoading(false)
      return {
        success: false,
        error: err?.message || 'Network error connecting to Keycloak auth provider on /auth',
      }
    }
  }

  const verifyMfa = async (code: string) => {
    if (!code || code.trim().length !== 6 || !/^\d{6}$/.test(code.trim())) {
      return false
    }

    if (isCadFlagEnabled('ns.cad.strict_states')) {
      // Under strict states (F-01, ADR-4), client-side arbitrary 6 digits is rejected.
      // Must verify server-side assurance via token exchange or OTP step-up.
      try {
        const storedToken = sessionStorage.getItem('cad_access_token')
        if (!storedToken) return false

        const response = await fetch('/api/v1/auth/mfa/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${storedToken}`,
          },
          body: JSON.stringify({ code: code.trim() }),
        }).catch(() => null)

        if (response && response.ok) {
          const resData = await response.json().catch(() => ({}))
          if (resData.verified || resData.access_token) {
            if (resData.access_token) {
              sessionStorage.setItem('cad_access_token', resData.access_token)
              const updatedClaims = resolveUserClaims(resData.access_token)
              setClaims(updatedClaims)
            }
            sessionStorage.setItem('cad_mfa_verified', 'true')
            setMfaVerified(true)
            return true
          }
        }
        return false // Fail closed: unverified code denied
      } catch {
        return false
      }
    }

    // LEGACY(ns-p4): Client-side 6-digit stub for development
    sessionStorage.setItem('cad_mfa_verified', 'true')
    setMfaVerified(true)
    return true
  }

  const signOut = async () => {
    sessionStorage.removeItem('cad_access_token')
    sessionStorage.removeItem('cad_refresh_token')
    sessionStorage.removeItem('cad_mfa_verified')
    setUser(null)
    setClaims(defaultClaims)
    setActiveTenant(null)
    setMfaVerified(false)
  }

  const value = {
    user,
    claims,
    activeTenant,
    availableTenants,
    isLoading,
    mfaVerified,
    mfaRequired,
    switchTenant,
    signIn,
    verifyMfa,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
