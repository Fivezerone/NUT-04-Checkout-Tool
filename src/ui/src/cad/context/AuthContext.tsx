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
// TODO (Stage C): import { OidcAuthProvider } from '../../../../shared/auth-provider'

interface CadUserClaims {
  userId: string
  tenantId: string
  role: CadRole
  licenceVerified: boolean
  email?: string
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

  const resolveUserClaims = (accessToken: string | null | undefined, email?: string): CadUserClaims => ({
    ...toCadUserClaims(claimsFromAccessToken(accessToken)),
    email,
  })

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
        // TODO (Stage C): call OidcAuthProvider.getSession() here.
        // For now, start unauthenticated.
      } catch (err) {
        console.warn('[CAD Auth] Init error:', err)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    initAuth()

    // TODO (Stage C): subscribe to OidcAuthProvider.onAuthStateChange here.

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

  const signIn = async (_email: string, _password: string) => {
    // TODO (Stage C): delegate to OidcAuthProvider.signIn().
    setIsLoading(false)
    return { success: false, error: 'Auth provider not yet configured — awaiting Stage C.' }
  }

  const verifyMfa = async (code: string) => {
    // B-01: removed any-6-char stub that accepted any TOTP code.
    // TODO (Stage C): call OidcAuthProvider.verifyMfa() with real Keycloak TOTP.
    if (!code || code.trim().length !== 6 || !/^\d{6}$/.test(code.trim())) {
      return false
    }
    throw new Error('MFA verification not yet wired — awaiting Stage C OIDC adapter.')
  }

  const signOut = async () => {
    // TODO (Stage C): call OidcAuthProvider.signOut().
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
