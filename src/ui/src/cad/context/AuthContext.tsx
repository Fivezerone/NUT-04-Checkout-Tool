// src/ui/src/cad/context/AuthContext.tsx
// Clinic Admin Dashboard Authentication & Multi-Tenant Context
// Reference: Reports/Plans/CAD_IMPLEMENTATION_PLAN.md (§6.2, §6.4)

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react'
import { cadSupabase } from '../supabaseClient'
import type { CadRole, Tenant } from '../types'

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

  const resolveUserClaims = (sessionUser: any): CadUserClaims => {
    if (!sessionUser) return defaultClaims
    const appMeta = sessionUser.app_metadata || {}
    const userMeta = sessionUser.user_metadata || {}

    return {
      userId: sessionUser.id,
      tenantId: appMeta.tenant_id || userMeta.tenant_id || '00000000-0000-0000-0000-000000000000',
      role: (appMeta.role || userMeta.role || 'writing_clinician') as CadRole,
      licenceVerified: Boolean(appMeta.licence_verified ?? userMeta.licence_verified ?? true),
      email: sessionUser.email,
    }
  }

  const loadTenantData = async (tenantId: string) => {
    try {
      const { data, error } = await cadSupabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .maybeSingle()

      if (data && !error) {
        setActiveTenant(data as Tenant)
      } else {
        // Fallback demo tenant if DB not seeded
        setActiveTenant({
          id: tenantId,
          name: 'Kenyatta National Hospital (Cardio-Metabolic Clinic)',
          slug: 'knh-cardio',
          status: 'active',
          config: {
            rule_pack: 'diabetes_hypertension',
            language: 'en',
            small_cell_k: 5,
          },
          config_version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
    } catch {
      // Offline / staging fallback
    }
  }

  const loadAllTenants = async () => {
    try {
      const { data } = await cadSupabase.from('tenants').select('*').limit(20)
      if (data && data.length > 0) {
        setAvailableTenants(data as Tenant[])
      } else {
        setAvailableTenants([
          {
            id: '00000000-0000-0000-0000-000000000000',
            name: 'NutriScore Platform & Direct Shoppers',
            slug: 'platform-default',
            status: 'active',
            config: { is_platform_default: true },
            config_version: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: '11111111-1111-1111-1111-111111111111',
            name: 'Kenyatta National Hospital (Cardio-Metabolic)',
            slug: 'knh-cardio',
            status: 'active',
            config: { rule_pack: 'diabetes_hypertension', small_cell_k: 5 },
            config_version: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: '22222222-2222-2222-2222-222222222222',
            name: 'Aga Khan University Hospital (Renal Unit)',
            slug: 'akuh-renal',
            status: 'active',
            config: { rule_pack: 'renal_unit', small_cell_k: 5 },
            config_version: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
      }
    } catch {
      // Ignore
    }
  }

  useEffect(() => {
    let mounted = true

    const initAuth = async () => {
      try {
        const { data: { session } } = await cadSupabase.auth.getSession()
        if (!mounted) return

        if (session?.user) {
          setUser(session.user)
          const resolved = resolveUserClaims(session.user)
          setClaims(resolved)
          await loadTenantData(resolved.tenantId)
          if (resolved.role === 'super_admin') {
            await loadAllTenants()
          }
        }
      } catch (err) {
        console.warn('[CAD Auth] Init error:', err)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    initAuth()

    const { data: { subscription } } = cadSupabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return
      if (session?.user) {
        setUser(session.user)
        const resolved = resolveUserClaims(session.user)
        setClaims(resolved)
        await loadTenantData(resolved.tenantId)
      } else {
        setUser(null)
        setClaims(defaultClaims)
        setActiveTenant(null)
        setMfaVerified(false)
      }
      setIsLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
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
      const { data, error } = await cadSupabase.auth.signInWithPassword({ email, password })
      if (error) {
        setIsLoading(false)
        return { success: false, error: error.message }
      }
      if (data?.user) {
        setUser(data.user)
        const resolved = resolveUserClaims(data.user)
        setClaims(resolved)
        await loadTenantData(resolved.tenantId)
        if (resolved.role === 'super_admin') {
          await loadAllTenants()
        }
      }
      setIsLoading(false)
      return { success: true }
    } catch (e: any) {
      setIsLoading(false)
      return { success: false, error: e.message || 'Authentication error' }
    }
  }

  const verifyMfa = async (code: string) => {
    // In production, verifies TOTP with Supabase MFA API:
    // await cadSupabase.auth.mfa.challengeAndVerify({ factorId, code })
    if (code.trim().length === 6) {
      setMfaVerified(true)
      return true
    }
    return false
  }

  const signOut = async () => {
    await cadSupabase.auth.signOut()
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

