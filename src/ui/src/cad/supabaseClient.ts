// src/ui/src/cad/supabaseClient.ts
// Supabase client instance tailored for Clinic Admin Dashboard (CAD) web application

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://mock.supabase.co'
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'mock-key'

const isExtensionContext = typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)

export const cadSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: isExtensionContext
      ? {
          getItem: async (key: string): Promise<string | null> => {
            const data = await chrome.storage.local.get(key)
            return (data[key] as string) || null
          },
          setItem: async (key: string, value: string): Promise<void> => {
            await chrome.storage.local.set({ [key]: value })
          },
          removeItem: async (key: string): Promise<void> => {
            await chrome.storage.local.remove(key)
          },
        }
      : typeof window !== 'undefined'
        ? window.localStorage
        : undefined,
    storageKey: 'cad_supabase_auth_session',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})

