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
import { defaultBffClient, BffError } from '../api/bff-client'
import { env } from '../../env'

interface CadUserClaims {
  userId: string
  tenantId: string
  role: CadRole | null
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
  role: null,
  licenceVerified: false,
}

function toCadUserClaims(claims: CanonicalClaims | null): CadUserClaims {
  if (!claims) return defaultClaims
  return {
    userId: claims.sub,
    tenantId: claims.tenantId || '00000000-0000-0000-0000-000000000000',
    role: (claims.appRole as CadRole) || null,
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

  // MFA is mandatory for every authenticated non-patient role (Plan §6.4, F-02)
  const mfaRequired = useMemo(() => {
    return Boolean(claims.role && claims.role !== 'patient' && !mfaVerified)
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
          if (payload.exp && payload.exp * 1000 < Date.now()) {
            console.warn('[CAD Auth] Token expired')
            return { ...defaultClaims, email }
          }
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
              role: (payload.app_role as CadRole) || matchedRole || null,
              licenceVerified: payload.lic_ok === true || payload.lic_ok === 'true',
              email: email || payload.email,
              acr: payload.acr ? String(payload.acr) : payload.aal ? String(payload.aal) : undefined,
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
        if (isCadFlagEnabled('ns.cad.bff_client')) {
          try {
            const capsRes = await defaultBffClient.getCapabilities()
            if (mounted && capsRes && capsRes.tenant) {
              const bffRole = (capsRes.caps.includes('platform.tenants.read')
                ? 'super_admin'
                : capsRes.caps.includes('patients.targets.write')
                ? 'writing_clinician'
                : capsRes.caps.includes('patients.targets.read')
                ? 'viewing_dietician'
                : capsRes.caps.includes('audit.verify')
                ? 'compliance_auditor'
                : 'tenant_admin') as CadRole

              setUser({ id: 'bff-user', email: 'session@bff.local' })
              setClaims({
                userId: 'bff-user',
                tenantId: capsRes.tenant.id,
                role: bffRole,
                licenceVerified: true,
              })
              setActiveTenant({
                id: capsRes.tenant.id,
                name: capsRes.tenant.label,
                slug: capsRes.tenant.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                status: 'active',
                config: {},
                config_version: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              setMfaVerified(capsRes.step_up_required.length === 0)
              setIsLoading(false)
              return
            }
          } catch {
            // Not signed in to BFF session
          }
        }

        const storedToken = sessionStorage.getItem('cad_access_token')
        if (storedToken) {
          const userClaims = resolveUserClaims(storedToken)
          if (userClaims && userClaims.userId && userClaims.role) {
            setUser({ id: userClaims.userId, email: userClaims.email })
            setClaims(userClaims)
            // Derive assurance STRICTLY from server JWT aal/acr claims (F-02, D-30)
            const hasServerMfa = Boolean(
              userClaims.acr === 'aal2' ||
                userClaims.acr === '2' ||
                (Array.isArray(userClaims.amr) &&
                  (userClaims.amr.includes('otp') || userClaims.amr.includes('webauthn'))),
            )
            setMfaVerified(hasServerMfa)
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
    setClaims((prev) => ({ ...prev, tenantId }))
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

      const userClaims = resolveUserClaims(accessToken, email)
      setUser({ id: userClaims.userId, email })
      setClaims(userClaims)
      const isMfa = Boolean(
        userClaims.acr === 'aal2' ||
          userClaims.acr === '2' ||
          (Array.isArray(userClaims.amr) &&
            (userClaims.amr.includes('otp') || userClaims.amr.includes('webauthn'))),
      )
      setMfaVerified(isMfa)

      if (isCadFlagEnabled('ns.cad.bff_client')) {
        try {
          const bffRes = await defaultBffClient.login({
            userId: userClaims.userId,
            tenantId: userClaims.tenantId,
            appRole: userClaims.role,
            acr: isMfa ? 2 : 1,
            amr: isMfa ? ['otp'] : ['pwd'],
          })
          if (bffRes.csrf_token) {
            defaultBffClient.setCsrfToken(bffRes.csrf_token)
          }
        } catch (bffErr) {
          console.warn('[CAD Auth] BFF session handshake error:', bffErr)
        }
      } else {
        sessionStorage.setItem('cad_access_token', accessToken)
        if (data.refresh_token) {
          sessionStorage.setItem('cad_refresh_token', data.refresh_token)
        }
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

    // Server-side assurance via token exchange or OTP step-up (F-02, ADR-004)
    try {
      const storedToken = sessionStorage.getItem('cad_access_token')
      if (!storedToken) return false

      const response = await fetch(
        `${env.apiUrl || 'http://localhost:8080/api'}/v1/auth/mfa/verify`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${storedToken}`,
          },
          body: JSON.stringify({ code: code.trim() }),
        },
      ).catch(() => null)

      if (response && response.ok) {
        const resData = await response.json().catch(() => ({}))
        if (resData.access_token) {
          sessionStorage.setItem('cad_access_token', resData.access_token)
          const updatedClaims = resolveUserClaims(resData.access_token)
          setClaims(updatedClaims)
          const verified = Boolean(
            updatedClaims.acr === 'aal2' ||
              updatedClaims.acr === '2' ||
              (Array.isArray(updatedClaims.amr) &&
                (updatedClaims.amr.includes('otp') || updatedClaims.amr.includes('webauthn'))),
          )
          setMfaVerified(verified)
          return verified
        }
      }
      return false // Fail closed: unverified code denied
    } catch {
      return false
    }
  }

  const signOut = async () => {
    if (isCadFlagEnabled('ns.cad.bff_client')) {
      await defaultBffClient.logout().catch(() => {})
    }
    sessionStorage.removeItem('cad_access_token')
    sessionStorage.removeItem('cad_refresh_token')
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
