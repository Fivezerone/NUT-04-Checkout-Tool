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

export interface SupabaseAuthLike {
  auth: {
    signInWithPassword(input: ClinicCredentialInput): Promise<{
      data: { session: { access_token: string } | null }
      error: { message: string } | null
    }>
    refreshSession(): Promise<{
      data: { session: { access_token: string } | null }
      error: { message: string } | null
    }>
    getSession(): Promise<{ data: { session: { access_token: string } | null } }>
    signOut(): Promise<{ error: { message: string } | null }>
  }
}

export type ClaimsDecoder = (token: string | null | undefined) => CanonicalClaims | null

/** Stage A adapter. The Supabase client remains isolated behind this seam. */
export class SupabaseAuthProvider implements AuthProvider {
  constructor(
    private readonly client: SupabaseAuthLike,
    private readonly decode: ClaimsDecoder,
  ) {}

  async signInWithClinicCredentials(input: ClinicCredentialInput): Promise<CanonicalClaims> {
    const { data, error } = await this.client.auth.signInWithPassword(input)
    const claims = this.decode(data.session?.access_token)
    if (error || !claims) throw new Error('Invalid clinic credentials')
    return claims
  }

  async refresh(): Promise<CanonicalClaims | null> {
    const { data, error } = await this.client.auth.refreshSession()
    return error ? null : this.decode(data.session?.access_token)
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut()
    if (error) throw new Error('Unable to sign out')
  }

  async currentClaims(): Promise<CanonicalClaims | null> {
    const { data } = await this.client.auth.getSession()
    return this.decode(data.session?.access_token)
  }
}

/** Stage B contract only; it deliberately contains no network implementation. */
export class OidcCodePkceProvider implements AuthProvider {
  async signInWithClinicCredentials(): Promise<CanonicalClaims> {
    throw new Error('OIDC provider is not configured before sovereign-cloud cutover')
  }

  async refresh(): Promise<CanonicalClaims | null> {
    throw new Error('OIDC provider is not configured before sovereign-cloud cutover')
  }

  async signOut(): Promise<void> {
    throw new Error('OIDC provider is not configured before sovereign-cloud cutover')
  }

  async currentClaims(): Promise<CanonicalClaims | null> {
    return null
  }
}
