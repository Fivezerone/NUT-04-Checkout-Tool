// src/shared/session-key.mjs
// STAGE A (A-07): renamed from nutri_supabase_session to nutri_oidc_session (decision 7).
// TODO (Stage C): OidcAuthProvider reads/writes this key in chrome.storage.local.
export const SESSION_STORAGE_KEY = 'nutri_oidc_session'
