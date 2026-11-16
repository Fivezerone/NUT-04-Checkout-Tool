// src/ui/src/env.ts
// NUT-04 Environment Validation & Safe Configuration Boundary (§5.1, D-29)

export interface AppEnv {
  apiUrl: string
  oidcIssuer: string
  oidcClientId: string
  clinicalRetentionYears: number
  isDev: boolean
  isTest: boolean
}

function resolveEnv(): AppEnv {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : ({} as Record<string, string>)
  const isDev = Boolean(metaEnv.DEV)
  const isTest = Boolean(metaEnv.MODE === 'test')

  const apiUrl = metaEnv.VITE_API_URL || (isDev ? 'http://localhost:8080/api' : 'https://localhost:8443/api')
  const oidcIssuer = metaEnv.VITE_OIDC_ISSUER || (isDev ? 'http://localhost:8080/auth/realms/nutriscore' : 'https://localhost:8443/auth/realms/nutriscore')
  const oidcClientId = metaEnv.VITE_OIDC_CLIENT_ID || 'cad-web-ui'
  const clinicalRetentionYears = Number(metaEnv.CLINICAL_RETENTION_YEARS || 20)

  return {
    apiUrl,
    oidcIssuer,
    oidcClientId,
    clinicalRetentionYears,
    isDev,
    isTest,
  }
}

export const env = resolveEnv()

/**
 * Validates configuration and returns null if healthy or error message if corrupted.
 */
export function validateEnvironment(): string | null {
  if (!env.apiUrl) {
    return 'Missing API gateway URL configuration (VITE_API_URL).'
  }
  if (!env.oidcIssuer) {
    return 'Missing Keycloak OIDC issuer configuration (VITE_OIDC_ISSUER).'
  }
  return null
}

