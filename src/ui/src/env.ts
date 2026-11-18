// src/ui/src/env.ts
// NUT-04 Environment Validation & Safe Configuration Boundary (§5.1, D-29)

export interface AppEnv {
  apiUrl: string
  oidcIssuer: string
  oidcClientId: string
  isDev: boolean
  isTest: boolean
  isProd: boolean
}

function resolveEnv(): AppEnv {
  const metaEnv =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as Record<string, string | boolean>)
      : {}
  const isDev = Boolean(metaEnv.DEV)
  const isTest = Boolean(metaEnv.MODE === 'test')
  const isProd = Boolean(metaEnv.PROD)

  // In production, require explicit environment URLs — never default to localhost (D-29)
  const defaultApi = isDev ? 'http://localhost:8080/api' : isTest ? 'http://localhost:8080/api' : ''
  const defaultIssuer = isDev
    ? 'http://localhost:8080/auth/realms/nutriscore'
    : isTest
      ? 'http://localhost:8080/auth/realms/nutriscore'
      : ''

  const apiUrl = (metaEnv.VITE_API_URL as string) || defaultApi
  const oidcIssuer = (metaEnv.VITE_OIDC_ISSUER as string) || defaultIssuer
  const oidcClientId = (metaEnv.VITE_OIDC_CLIENT_ID as string) || 'cad-web-ui'

  return {
    apiUrl,
    oidcIssuer,
    oidcClientId,
    isDev,
    isTest,
    isProd,
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

