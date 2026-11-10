// src/ui/src/services/storage.ts
// Storage adapter stub.
//
// STAGE A (A-07): Original storage.ts (Supabase createClient) was deleted.
// This stub re-exports the same symbols as no-ops so popup.tsx, dashboard.tsx,
// and Options.tsx continue to compile.
//
// TODO (Stage C): Replace with real OIDC session adapter backed by chrome.storage.local.

import { SESSION_STORAGE_KEY } from '../../../shared/session-key.mjs'

export { SESSION_STORAGE_KEY }

export interface ChromeExtensionStorage {
  onboarding_completed?: boolean
  nutriscore_is_premium?: boolean
  user_preferences?: Record<string, any>
  [key: string]: any
}

const fakeBuilder: any = {
  select: () => fakeBuilder,
  eq: () => fakeBuilder,
  neq: () => fakeBuilder,
  order: () => fakeBuilder,
  limit: () => fakeBuilder,
  single: async () => ({ data: null as any, error: null }),
  maybeSingle: async () => ({ data: null as any, error: null }),
  then: (resolve: any) => Promise.resolve({ data: [] as any[], error: null }).then(resolve),
}

/** Noop Supabase-shaped object — all calls resolve to null until Stage C. */
export const supabase: any = {
  auth: {
    getSession: async () => ({ data: { session: null as any }, error: null }),
    onAuthStateChange: (_event: unknown, _cb: unknown) => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
    signOut: async () => ({ error: null }),
  },
  from: (_table: string) => fakeBuilder,
  rpc: async (_fn: string, _args?: unknown) => ({ data: null as any, error: null }),
}

export const USER_STORAGE_KEYS = [
  SESSION_STORAGE_KEY,
  'nutri_entitlement',
  'onboarding_completed',
  'partial_onboarding',
]

/** Strips PII: mpesaPhone: _m, dob: _d, gender: _g, ...safeData */
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

/** Sign out stub — clears user storage keys from chrome.storage and localStorage. */
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


/** Onboarding completion stub — no-op until OIDC adapter is wired. */
export async function setOnboardingCompleted(_userId?: string, _completed?: boolean): Promise<void> {
  // TODO (Stage C): persist via chrome.storage.local or REST call
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

/** Legacy extension storage helper — stubs only. */
export const ExtensionStorage = {
  getOnboardingData: async (_userId?: string): Promise<Record<string, any> | null> => null,
  updatePreferences: async (_prefs: Record<string, unknown>) => {},
}
