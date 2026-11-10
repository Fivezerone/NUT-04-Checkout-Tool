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

/** Noop Supabase-shaped object — all calls resolve to null until Stage C. */
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: (_event: unknown, _cb: unknown) => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
    signOut: async () => ({ error: null }),
  },
  from: (_table: string) => ({
    select: (_cols?: string) => ({
      eq: (_col: string, _val: unknown) => ({
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        limit: (_n: number) => ({ data: [], error: null }),
      }),
      limit: (_n: number) => Promise.resolve({ data: [], error: null }),
    }),
  }),
  rpc: async (_fn: string, _args?: unknown) => ({ data: null, error: null }),
}

/** Sign out stub — clears the OIDC session key from chrome.storage. */
export async function signOutUser(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove(SESSION_STORAGE_KEY)
    }
  } catch {
    // ignore
  }
}

/** Onboarding completion stub — no-op until OIDC adapter is wired. */
export async function setOnboardingCompleted(_userId: string, _completed: boolean): Promise<void> {
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
  getOnboardingData: async (_userId?: string) => null,
  updatePreferences: async (_prefs: Record<string, unknown>) => {},
}

