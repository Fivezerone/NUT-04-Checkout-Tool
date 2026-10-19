import { createClient } from '@supabase/supabase-js';

// Vite replaces import.meta.env.VITE_* at build time (NOT process.env).
// Values are baked into the bundle from the .env file at the project root.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    '[NUT-04] Missing Supabase credentials. ' +
    'Create a .env file at the project root with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. ' +
    'See .env.example for the required format.'
  );
}

/**
 * Custom Auth storage adapter for Chrome Extensions (Manifest V3).
 *
 * Supabase v2 stores its session JWT under a key derived from the project URL.
 * We persist it in chrome.storage.local so the session survives across:
 *   - popup opens/closes (separate JS contexts every time)
 *   - browser restarts (localStorage is cleared; chrome.storage.local is not)
 *   - MV3 service-worker wakeups
 *
 * Critical correctness notes:
 *   - `data[key] || null` would coerce an empty string to null — use explicit check instead.
 *   - Wrap every call in try/catch so a storage quota error doesn't crash the whole auth flow.
 *   - Guard `typeof chrome` so the module can be imported in vitest without a browser shim.
 */
const chromeStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
    try {
      const data = await chrome.storage.local.get(key);
      const value = data[key];
      // Explicit null/undefined check — empty string is a valid stored value
      return (value !== undefined && value !== null) ? String(value) : null;
    } catch (err) {
      // Log non-sensitive diagnostic; return null for cache-miss semantics on read
      console.warn('[chromeStorageAdapter] getItem error (key redacted):', (err as Error)?.message);
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      throw new Error('[chromeStorageAdapter] Chrome storage unavailable — session cannot be persisted');
    }
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (err) {
      // Re-throw so Supabase auth knows the write failed (F-04)
      throw new Error('[chromeStorageAdapter] setItem failed: ' + (err as Error)?.message, { cause: err });
    }
  },
  removeItem: async (key: string): Promise<void> => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    try {
      await chrome.storage.local.remove(key);
    } catch (err) {
      throw new Error('[chromeStorageAdapter] removeItem failed: ' + (err as Error)?.message, { cause: err });
    }
  },
};

import { SESSION_STORAGE_KEY } from '../../../shared/session-key.mjs';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: chromeStorageAdapter,
    storageKey: SESSION_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * Explicit session re-hydration for MV3 service workers (call this on wakeup).
 * In the UI layer, `supabase.auth.getSession()` already triggers this internally.
 */
export const rehydrateSession = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
};

// D-22: all user-linked storage keys that must be cleared on sign-out.
// partial_onboarding holds name/email/DOB/gender/condition/M-Pesa in cleartext.
// onboarding_completed must be cleared so it cannot bypass onboarding for the next account.
const USER_STORAGE_KEYS = [
  SESSION_STORAGE_KEY,
  'partial_onboarding',
  'user_account',
  'user_preferences',
  'user_payment',
  'onboarding_completed',
  'activePaymentRef',
  'activePaymentMethod',
  'nutri_entitlement',
  'nutriscore_is_premium',
] as const;

/**
 * Signs the current user out of Supabase and clears ALL user-linked local storage.
 * Centralised here so all callers (Settings, dashboard guard) use one path.
 * D-22: partial_onboarding (PII) and onboarding_completed are now included so
 * shared-PC users don't see previous user's health data or skip onboarding.
 */
export const signOutUser = async (): Promise<void> => {
  try {
    await supabase.auth.signOut();
  } catch { /* network offline — still clear local flags */ }
  try {
    await chrome.storage.local.remove([...USER_STORAGE_KEYS]);
    // Also clear theme from localStorage (not chrome.storage)
    try { localStorage.removeItem('nutriscore_theme'); } catch { /* sandboxed page */ }
  } catch { /* ignore */ }
};

export interface ChromeExtensionStorage {
  onboarding_completed: boolean;
  user_account: {
    fullName: string;
    email: string;
    dob?: string;
    gender?: string;
  };
  user_preferences: {
    healthMode: boolean;
    notificationFrequency: "realtime" | "daily" | "weekly" | "off";
    selectedTags: string[];
    termsAccepted: boolean;
    privacyAccepted: boolean;
    consentTimestamp: string | null;
  };
  user_payment: {
    method: string;
    paymentRef: string;
    amount: number;
  };
  nutriscore_is_premium?: boolean | string;
}

const onboardingKey = (userId: string) => { if (!userId) throw new Error("userId is required"); return `nutri:onboarding:${userId}`; };
type OnboardingKeyValue = { completed: boolean; updatedAt: number };
export const getOnboardingCompleted = async (userId: string) => ((await chrome.storage.local.get(onboardingKey(userId)))[onboardingKey(userId)] as OnboardingKeyValue | undefined)?.completed === true;
export const setOnboardingCompleted = (userId: string, completed: boolean) =>
  chrome.storage.local.set({ [onboardingKey(userId)]: { completed, updatedAt: Date.now() } });

export const ExtensionStorage = {
  getOnboardingData: async (userId?: string): Promise<Partial<ChromeExtensionStorage>> => {
    const data = await chrome.storage.local.get([
      'user_account',
      'user_preferences',
      'user_payment',
      'partial_onboarding',
      'nutriscore_is_premium'
    ]);

    const isCompleted = userId ? await getOnboardingCompleted(userId) : false;

    if (isCompleted) {
      return { ...data, onboarding_completed: true };
    }

    // Substitute partial onboarding data so options/settings page reflects it before final checkout
    interface PartialOnboarding {
      fullName?: string;
      email?: string;
      condition?: string;
      notificationFrequency?: string;
      metric?: string;
      termsAccepted?: boolean;
      privacyAccepted?: boolean;
    }
    const partial: PartialOnboarding = data.partial_onboarding || {};
    return {
      onboarding_completed: false,
      user_account: {
        fullName: partial.fullName || "Guest",
        email: partial.email || ""
      },
      user_preferences: {
        healthMode: !!(partial.condition && partial.condition !== "general"),
        notificationFrequency: (partial.notificationFrequency || "realtime") as ChromeExtensionStorage['user_preferences']['notificationFrequency'],
        selectedTags: [partial.condition, partial.metric].filter(Boolean) as string[],
        termsAccepted: partial.termsAccepted || false,
        privacyAccepted: partial.privacyAccepted || false,
        consentTimestamp: null
      }
    };
  },

  setOnboardingComplete: async (userId: string, data: Omit<ChromeExtensionStorage, 'onboarding_completed'>): Promise<void> => {
    await setOnboardingCompleted(userId, true);
    await chrome.storage.local.set(data);
    // Clean up partial data
    await chrome.storage.local.remove('partial_onboarding');
  },

  setPartialOnboardingData: async (data: any): Promise<void> => {
    // D-22: strip fields that must not persist in cleartext storage
    // mpesaPhone, dob and gender are only needed transiently during signup.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { mpesaPhone: _m, dob: _d, gender: _g, ...safeData } = data || {};
    await chrome.storage.local.set({ partial_onboarding: safeData });
  },

  getPartialOnboardingData: async (): Promise<any> => {
    const data = await chrome.storage.local.get('partial_onboarding');
    return data.partial_onboarding || {};
  },

  updatePreferences: async (preferences: Partial<ChromeExtensionStorage['user_preferences']>): Promise<void> => {
    const current = await chrome.storage.local.get('user_preferences');
    await chrome.storage.local.set({
      user_preferences: { ...(current.user_preferences || {}), ...preferences },
    });
  },

  clearAll: async (): Promise<void> => {
    await chrome.storage.local.clear();
  },

  setActivePayment: async (ref: string | null, method: 'mpesa' | 'paystack' | null, userId?: string): Promise<void> => {
    // F-15: use user-scoped keys if userId is available, else fall back to global keys
    const refKey = userId ? `activePaymentRef:${userId}` : 'activePaymentRef';
    const methodKey = userId ? `activePaymentMethod:${userId}` : 'activePaymentMethod';
    if (!ref || !method) {
      await chrome.storage.local.remove([refKey, methodKey]);
      // Also clear legacy global keys on clear
      if (userId) await chrome.storage.local.remove(['activePaymentRef', 'activePaymentMethod']);
    } else {
      await chrome.storage.local.set({ [refKey]: ref, [methodKey]: method });
    }
  },

  getActivePayment: async (userId?: string): Promise<{ ref: string | null, method: 'mpesa' | 'paystack' | null }> => {
    // F-15: prefer user-scoped key, then fall back to legacy global key
    const refKey = userId ? `activePaymentRef:${userId}` : 'activePaymentRef';
    const methodKey = userId ? `activePaymentMethod:${userId}` : 'activePaymentMethod';
    const data = await chrome.storage.local.get([refKey, methodKey, 'activePaymentRef', 'activePaymentMethod']);
    // Prefer user-scoped value; fall back only if no userId-scoped value exists
    const ref = (userId ? data[refKey] : null) ?? data['activePaymentRef'] ?? null;
    const method = (userId ? data[methodKey] : null) ?? data['activePaymentMethod'] ?? null;
    return {
      ref: (ref as string | undefined) || null,
      method: (method as 'mpesa' | 'paystack' | undefined) || null
    };
  },
};

/**
 * D-04: Persists the user's premium token to chrome.storage.local under the
 * key the SW reads (`nutri_entitlement`), then signals the SW to adopt it
 * immediately — eliminating the activation lag where badges stay "basic" until
 * the next SW wake cycle.
 *
 * Previously wrote to `nutriscore_is_premium` (a dead UI-only key) and to
 * IndexedDB `isPremium` (no longer read by the SW). Both writes are removed.
 */
export const savePremiumStatus = async (token: string | false): Promise<void> => {
  try {
    if (token) {
      await chrome.storage.local.set({ nutri_entitlement: token });
    } else {
      await chrome.storage.local.remove('nutri_entitlement');
    }
  } catch { /* quota error — SW will re-fetch on next wake */ }

  // Signal the SW to refresh its in-memory tier immediately.
  // Fire-and-forget: ignore the response and don't throw if the SW is sleeping.
  try {
    await chrome.runtime.sendMessage({ action: 'REFRESH_ENTITLEMENT' });
  } catch { /* SW may be sleeping — it will pick up the token on next wake */ }
};
