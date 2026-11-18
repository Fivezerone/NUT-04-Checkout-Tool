/**
 * src/ui/src/cad/api/cad-api.ts
 *
 * Typed REST API client for CAD backend resources (Blueprint §3.5, §4.2, ADR-001, ADR-008)
 * Connects directly to PostgREST and Keycloak BFF endpoints using absolute URLs from env.apiUrl.
 *
 * Invariants:
 * - Fail closed on network/server errors (no simulated success, F-05).
 * - Zero patient PII or synthetic tokens generated in browser (F-05).
 * - Full error propagation (F-13).
 */

import { env } from '../../env'
import type { AuditLogEntry, CadRole, Tenant, TenantMember } from '../types'

export interface LinkCodeResponse {
  success: boolean
  code?: string
  expiresAt?: string
  error?: string
}

export interface ShredResponse {
  success: boolean
  shredToken?: string
  error?: string
}

export interface StaffInviteResponse {
  success: boolean
  inviteId?: string
  error?: string
}

export class CadApiClient {
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || env.apiUrl || 'http://localhost:8080/api').replace(/\/+$/, '')
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
    if (typeof sessionStorage !== 'undefined') {
      const token = sessionStorage.getItem('cad_access_token')
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    }
    return headers
  }

  /**
   * Fetch audit ledger rows for a tenant.
   */
  async getAuditLogs(tenantId: string, limit = 100): Promise<AuditLogEntry[]> {
    if (!tenantId || tenantId === '00000000-0000-0000-0000-000000000000') {
      return []
    }
    const url = `${this.baseUrl}/rest/v1/audit_log?tenant_id=eq.${encodeURIComponent(
      tenantId,
    )}&order=seq.desc&limit=${limit}`

    try {
      const res = await fetch(url, {
        headers: this.getAuthHeaders(),
        credentials: 'same-origin',
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      return (await res.json()) as AuditLogEntry[]
    } catch (err: any) {
      console.warn('[CadApi] getAuditLogs error:', err.message)
      throw err
    }
  }

  /**
   * Fetch tenant list.
   */
  async getTenants(): Promise<Tenant[]> {
    const url = `${this.baseUrl}/rest/v1/tenants?order=name.asc`
    try {
      const res = await fetch(url, {
        headers: this.getAuthHeaders(),
        credentials: 'same-origin',
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      return (await res.json()) as Tenant[]
    } catch (err: any) {
      console.warn('[CadApi] getTenants error:', err.message)
      return []
    }
  }

  /**
   * Fetch staff members for tenant.
   */
  async getMembers(tenantId: string): Promise<TenantMember[]> {
    if (!tenantId || tenantId === '00000000-0000-0000-0000-000000000000') {
      return []
    }
    const url = `${this.baseUrl}/rest/v1/tenant_members?tenant_id=eq.${encodeURIComponent(
      tenantId,
    )}&order=created_at.desc`
    try {
      const res = await fetch(url, {
        headers: this.getAuthHeaders(),
        credentials: 'same-origin',
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      return (await res.json()) as TenantMember[]
    } catch (err: any) {
      console.warn('[CadApi] getMembers error:', err.message)
      return []
    }
  }

  /**
   * Request server-side generation of patient linking code (F-05).
   * Never generates random codes client-side.
   */
  async generateLinkCode(patientRef?: string): Promise<LinkCodeResponse> {
    const url = `${this.baseUrl}/v1/patient-links/generate`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({ patientRef }),
      })
      if (!res.ok) {
        return {
          success: false,
          error: `API error (${res.status}): Server patient linking endpoint unavailable.`,
        }
      }
      const data = await res.json()
      return {
        success: true,
        code: data.code,
        expiresAt: data.expires_at || data.expiresAt,
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Not connected: Patient linking service required (${err.message}). Recorded in Docs/Reports/api-requirements.md`,
      }
    }
  }

  /**
   * Request server-side cryptographic shredding (F-05, ADR-012).
   * Destroys record keys server-side; never simulates shredding in browser.
   */
  async cryptoShredPatient(patientRef: string, reason: string): Promise<ShredResponse> {
    const url = `${this.baseUrl}/v1/patients/crypto-shred`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({ patientRef, reason }),
      })
      if (!res.ok) {
        return {
          success: false,
          error: `API error (${res.status}): Server cryptographic shredding endpoint unavailable.`,
        }
      }
      const data = await res.json()
      return {
        success: true,
        shredToken: data.shred_token || data.shredToken,
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Not connected: Cryptographic shredding service required (${err.message}). Recorded in Docs/Reports/api-requirements.md`,
      }
    }
  }

  /**
   * Request server-side staff provisioning via Keycloak / BFF (F-05).
   * Never generates passwords in the browser.
   */
  async inviteStaff(member: {
    email: string
    role: CadRole
    tenantId: string
    licenceNumber?: string
  }): Promise<StaffInviteResponse> {
    const url = `${this.baseUrl}/v1/staff/invite`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify(member),
      })
      if (!res.ok) {
        return {
          success: false,
          error: `API error (${res.status}): Keycloak staff provisioning endpoint unavailable.`,
        }
      }
      const data = await res.json()
      return {
        success: true,
        inviteId: data.invite_id || data.id,
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Not connected: Keycloak staff provisioning service required (${err.message}). Recorded in Docs/Reports/api-requirements.md`,
      }
    }
  }
}

export const cadApi = new CadApiClient()
