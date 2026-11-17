/**
 * src/ui/src/cad/api/bff-client.ts
 *
 * Backend-For-Frontend (BFF) HTTP Client for CAD (Blueprint §3.5, §4.2; ADR-004)
 * Flag: ns.cad.bff_client
 *
 * Invariants:
 * - Credentials: 'same-origin' binds cookie __Host-ns_sid automatically.
 * - X-NS-CSRF header attached on unsafe HTTP methods.
 * - RFC 9457 Problem Details parsed on non-2xx responses.
 * - Zero patient PII or clinic identifiers stored in sessionStorage or logs.
 */

import { isCadFlagEnabled } from '../flags'

export interface ProblemDetailsError {
  type: string
  title: string
  status: number
  code: string
  trace_id?: string
  detail?: string
  retry_after_s?: number
}

export class BffError extends Error {
  public status: number
  public code: string
  public traceId?: string
  public problem?: ProblemDetailsError

  constructor(problem: ProblemDetailsError) {
    super(problem.detail || problem.title || `BFF Error ${problem.status}`)
    this.name = 'BffError'
    this.status = problem.status
    this.code = problem.code || 'UNKNOWN_ERROR'
    this.traceId = problem.trace_id
    this.problem = problem
  }
}

export interface CapabilitiesResponse {
  caps: string[]
  caps_hash: string
  step_up_required: string[]
  tenant: {
    id: string
    label: string
  }
}

export class BffClient {
  private baseUrl: string
  private csrfToken: string | null = null
  private customFetch?: typeof fetch

  constructor(baseUrl: string = '', customFetch?: typeof fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.customFetch = customFetch
  }

  setCsrfToken(token: string | null): void {
    this.csrfToken = token
  }

  getCsrfToken(): string | null {
    return this.csrfToken
  }

  isBffEnabled(): boolean {
    return isCadFlagEnabled('ns.cad.bff_client')
  }

  async request<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const fetchFn = this.customFetch || (typeof fetch !== 'undefined' ? fetch : null)
    if (!fetchFn) {
      throw new Error('No fetch implementation available in current runtime')
    }

    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    const url = `${this.baseUrl}${path}`

    const method = (options.method || 'GET').toUpperCase()
    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
      ...((options.headers as Record<string, string>) || {}),
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json'
      if (this.csrfToken) {
        headers['X-NS-CSRF'] = this.csrfToken
      }
    }

    const fetchOptions: RequestInit = {
      ...options,
      method,
      headers,
      credentials: 'same-origin', // Cookie __Host-ns_sid sent automatically
    }

    const response = await fetchFn(url, fetchOptions)

    if (!response.ok) {
      let problem: ProblemDetailsError
      try {
        problem = await response.json()
      } catch {
        problem = {
          type: 'about:blank',
          title: response.statusText,
          status: response.status,
          code: `HTTP_${response.status}`,
        }
      }
      throw new BffError(problem)
    }

    return response.json() as Promise<T>
  }

  async getCapabilities(): Promise<CapabilitiesResponse> {
    return this.request<CapabilitiesResponse>('/v1/capabilities', { method: 'GET' })
  }

  async login(payload: Record<string, any>): Promise<{ ok: boolean; csrf_token?: string }> {
    const res = await this.request<{ ok: boolean; csrf_token?: string }>('/v1/auth/session', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    if (res.csrf_token) {
      this.setCsrfToken(res.csrf_token)
    }
    return res
  }

  async logout(): Promise<void> {
    try {
      await this.request('/v1/auth/logout', { method: 'POST' })
    } finally {
      this.setCsrfToken(null)
    }
  }

  async verifyAudit(): Promise<{ status: string; checked: number; roots_verified: number }> {
    return this.request('/v1/audit/verify', { method: 'GET' })
  }
}

export const defaultBffClient = new BffClient()
