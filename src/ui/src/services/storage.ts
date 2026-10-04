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
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
      const data = await chrome.storage.local.get(key);
      const value = data[key];
      // Explicit null/undefined check — empty string is a valid stored value
      return (value !== undefined && value !== null) ? String(value) : null;
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
      await chrome.storage.local.set({ [key]: value });
    } catch { /* storage quota or permission error — silently ignore */ }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
      await chrome.storage.local.remove(key);
    } catch { /* silently ignore */ }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: chromeStorageAdapter,
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

export const ExtensionStorage = {
  getOnboardingData: async (): Promise<Partial<ChromeExtensionStorage>> => {
    const data = await chrome.storage.local.get([
      'onboarding_completed',
      'user_account',
      'user_preferences',
      'user_payment',
      'partial_onboarding',
      'nutriscore_is_premium'
    ]);

    if (data.onboarding_completed) {
      return data;
    }

    // Substitute partial onboarding data so options/settings page reflects it before final checkout
    const partial = data.partial_onboarding || {};
    return {
      onboarding_completed: false,
      user_account: {
        fullName: partial.fullName || "Guest",
        email: partial.email || "",
        dob: partial.dob || "",
        gender: partial.gender || ""
      },
      user_preferences: {
        healthMode: partial.condition && partial.condition !== "general",
        notificationFrequency: partial.notificationFrequency || "realtime",
        selectedTags: [partial.condition, partial.metric].filter(Boolean),
        termsAccepted: partial.termsAccepted || false,
        privacyAccepted: partial.privacyAccepted || false,
        consentTimestamp: null
      }
    };
  },

  setOnboardingComplete: async (data: Omit<ChromeExtensionStorage, 'onboarding_completed'>): Promise<void> => {
    await chrome.storage.local.set({
      onboarding_completed: true,
      ...data,
    });
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

  setActivePayment: async (ref: string | null, method: 'mpesa' | 'paystack' | null): Promise<void> => {
    if (!ref || !method) {
      await chrome.storage.local.remove(['activePaymentRef', 'activePaymentMethod']);
    } else {
      await chrome.storage.local.set({ activePaymentRef: ref, activePaymentMethod: method });
    }
  },

  getActivePayment: async (): Promise<{ ref: string | null, method: 'mpesa' | 'paystack' | null }> => {
    const data = await chrome.storage.local.get(['activePaymentRef', 'activePaymentMethod']);
    return {
      ref: data.activePaymentRef || null,
      method: data.activePaymentMethod || null
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
