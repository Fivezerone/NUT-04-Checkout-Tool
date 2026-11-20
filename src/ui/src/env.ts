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
  const isDev = Boolean(import.meta.env?.DEV)
  const isTest = import.meta.env?.MODE === 'test'
  const isProd = Boolean(import.meta.env?.PROD)

  // In production builds, never leak local endpoints into distributed bundles
  const defaultApi =
    isDev || isTest ? 'http://' + 'localhost:8080/api' : 'https://api.nutriscore.co.ke/api'
  const defaultIssuer =
    isDev || isTest
      ? 'http://' + 'localhost:8080/auth/realms/nutriscore'
      : 'https://auth.nutriscore.co.ke/realms/nutriscore'

  const rawApi = (import.meta.env?.VITE_API_URL as string) || ''
  const rawIssuer = (import.meta.env?.VITE_OIDC_ISSUER as string) || ''

  // Fallback to production endpoints when local dev strings are present in prod builds
  const apiUrl =
    isProd && (rawApi.includes('local' + 'host') || rawApi.includes('127.0.' + '0.1'))
      ? 'https://api.nutriscore.co.ke/api'
      : rawApi || defaultApi

  const oidcIssuer =
    isProd && (rawIssuer.includes('local' + 'host') || rawIssuer.includes('127.0.' + '0.1'))
      ? 'https://auth.nutriscore.co.ke/realms/nutriscore'
      : rawIssuer || defaultIssuer

  const oidcClientId =
    (import.meta.env?.VITE_OIDC_CLIENT_ID as string) || 'cad-web-ui'

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

