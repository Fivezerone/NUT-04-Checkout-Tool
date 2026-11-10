// src/shared/auth-provider.ts
// Auth provider interface and OIDC stub.
//
// STAGE A (A-03): SupabaseAuthProvider removed (supabaseClient.ts deleted).
// TODO (Stage C): Replace OidcCodePkceProvider stub with real Keycloak implementation.

import type { CanonicalClaims } from './claims'

export interface ClinicCredentialInput {
  email: string
  password: string
}

export interface AuthProvider {
  signInWithClinicCredentials(input: ClinicCredentialInput): Promise<CanonicalClaims>
  refresh(): Promise<CanonicalClaims | null>
  signOut(): Promise<void>
  currentClaims(): Promise<CanonicalClaims | null>
}

export type ClaimsDecoder = (token: string | null | undefined) => CanonicalClaims | null

/** Stage C contract — will be wired to Keycloak PKCE flow. */
export class OidcCodePkceProvider implements AuthProvider {
  async signInWithClinicCredentials(): Promise<CanonicalClaims> {
    throw new Error('OIDC provider is not yet configured — awaiting Stage C.')
  }

  async refresh(): Promise<CanonicalClaims | null> {
    throw new Error('OIDC provider is not yet configured — awaiting Stage C.')
  }

  async signOut(): Promise<void> {
    throw new Error('OIDC provider is not yet configured — awaiting Stage C.')
  }

  async currentClaims(): Promise<CanonicalClaims | null> {
    return null
  }
}
