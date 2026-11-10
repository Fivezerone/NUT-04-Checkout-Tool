// src/ui/src/services/storage.ts
// OIDC Session Adapter & PostgREST REST Client for NutriScore Extension & CAD
// Reference: Stage C Implementation Plan (Phase C5: REST/OIDC Data Wiring)

import { SESSION_STORAGE_KEY } from '../../../shared/session-key.mjs'

export { SESSION_STORAGE_KEY }

export interface ChromeExtensionStorage {
  onboarding_completed?: boolean
  nutriscore_is_premium?: boolean
  user_preferences?: Record<string, any>
  tenant_id?: string
  tenant_name?: string
  [key: string]: any
}

export interface OidcTokens {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_at?: number
  claims?: {
    sub: string
    email?: string
    role?: string
    tenant_id?: string
    name?: string
  }
}

/** REST / PostgREST Client Adapter */
class PostgrestQueryBuilder {
  private table: string
  private endpoint: string
  private queryParams: Record<string, string> = {}
  private headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  }

  constructor(table: string, baseUrl = '/rest/v1') {
    this.table = table
    this.endpoint = `${baseUrl}/${table}`
  }

  select(columns = '*'): this {
    this.queryParams['select'] = columns
    return this
  }

  eq(column: string, value: unknown): this {
    this.queryParams[column] = `eq.${value}`
    return this
  }

  neq(column: string, value: unknown): this {
    this.queryParams[column] = `neq.${value}`
    return this
  }

  order(column: string, options: { ascending?: boolean } = { ascending: true }): this {
    this.queryParams['order'] = `${column}.${options.ascending ? 'asc' : 'desc'}`
    return this
  }

  limit(count: number): this {
    this.queryParams['limit'] = String(count)
    return this
  }

  private buildUrl(): string {
    const params = new URLSearchParams(this.queryParams).toString()
    return params ? `${this.endpoint}?${params}` : this.endpoint
  }

  async single(): Promise<{ data: any; error: any }> {
    try {
      this.headers['Accept'] = 'application/vnd.pgrst.object+json'
      if (typeof fetch === 'function') {
        const res = await fetch(this.buildUrl(), { headers: this.headers })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        const data = await res.json()
        return { data, error: null }
      }
      return { data: null, error: null }
    } catch (err: any) {
      return { data: null, error: err }
    }
  }

  async maybeSingle(): Promise<{ data: any; error: any }> {
    try {
      this.limit(1)
      if (typeof fetch === 'function') {
        const res = await fetch(this.buildUrl(), { headers: this.headers })
        if (res.status === 406 || res.status === 404) return { data: null, error: null }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        const data = await res.json()
        const item = Array.isArray(data) ? data[0] ?? null : data
        return { data: item, error: null }
      }
      return { data: null, error: null }
    } catch {
      return { data: null, error: null }
    }
  }

  then(resolve: any, reject?: any): Promise<any> {
    return (async () => {
      try {
        if (typeof fetch === 'function') {
          const res = await fetch(this.buildUrl(), { headers: this.headers })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          return { data: Array.isArray(data) ? data : [data], error: null }
        }
        return { data: [], error: null }
      } catch (err) {
        return { data: [], error: err }
      }
    })().then(resolve, reject)
  }
}

/**
 * Modern REST / OIDC client layer providing backwards-compatible shape for
 * legacy call sites during the UI Overhaul.
 */
export const supabase = {
  auth: {
    getSession: async (): Promise<{ data: { session: any }; error: any }> => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          const res = await chrome.storage.local.get(SESSION_STORAGE_KEY)
          const session = res[SESSION_STORAGE_KEY] || null
          return { data: { session }, error: null }
        }
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(SESSION_STORAGE_KEY)
          const session = raw ? JSON.parse(raw) : null
          return { data: { session }, error: null }
        }
      } catch {
        // ignore
      }
      return { data: { session: null }, error: null }
    },
    onAuthStateChange: (_event: unknown, _cb: unknown) => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
    signOut: async (): Promise<{ error: any }> => {
      await signOutUser()
      return { error: null }
    },
  },
  from: (table: string) => new PostgrestQueryBuilder(table),
  rpc: async (_fn: string, _args?: unknown): Promise<{ data: any; error: any }> => ({ data: null as any, error: null }),
}

export const USER_STORAGE_KEYS = [
  SESSION_STORAGE_KEY,
  'nutri_entitlement',
  'onboarding_completed',
  'partial_onboarding',
  'user_health_profile',
]

/** Strips PII before persistence */
export const setPartialOnboardingData = async (data: Record<string, any>): Promise<void> => {
  const { mpesaPhone: _m, dob: _d, gender: _g, ...safeData } = data
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ partial_onboarding: safeData })
  }
}

/** Save entitlement status */
export const savePremiumStatus = async (entitlement: Record<string, any>): Promise<void> => {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ nutri_entitlement: entitlement })
    chrome.runtime?.sendMessage?.({ action: 'REFRESH_ENTITLEMENT' })
  }
}

/** Sign out — removes active credentials and local session tokens */
export const signOutUser = async (): Promise<void> => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove(USER_STORAGE_KEYS)
    }
    if (typeof localStorage !== 'undefined') {
      USER_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k))
    }
  } catch {
    // ignore
  }
};


/** Mark onboarding / care enrollment completed */
export async function setOnboardingCompleted(_userId?: string, completed = true): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ onboarding_completed: completed })
  }
}

/** Minimal chrome.storage-backed extension storage */
export const ChromeExtensionStorage = {
  get: async <T>(key: string): Promise<T | null> => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null
    const result = await chrome.storage.local.get(key)
    return (result[key] ?? null) as T | null
  },
  set: async (key: string, value: unknown): Promise<void> => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return
    await chrome.storage.local.set({ [key]: value })
  },
}

/** Extension storage helper for preferences and onboarding data */
export const ExtensionStorage = {
  getOnboardingData: async (_userId?: string): Promise<Record<string, any> | null> => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null
    const data = await chrome.storage.local.get(['partial_onboarding', 'user_preferences', 'user_account'])
    return data || null
  },
  updatePreferences: async (prefs: Record<string, unknown>) => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const existing = (await chrome.storage.local.get('user_preferences'))?.user_preferences || {}
      await chrome.storage.local.set({ user_preferences: { ...existing, ...prefs } })
    }
  },
}
