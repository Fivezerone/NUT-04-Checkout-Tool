// services/api/src/bff/session.mjs
// BFF Session Store & Security Layer (ADR-004, Findings F-01, F-02, X-01; Blueprint §3.5)

import { randomBytes, createHash } from 'node:crypto'

export const COOKIE_NAME = '__Host-ns_sid'
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes
export const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000 // 8 hours

export class SessionManager {
  constructor(store) {
    this.store = store
    this.sessions = new Map() // sid -> session record
    this.denylist = new Set() // sid -> revoked
  }

  reset() {
    this.sessions.clear()
    this.denylist.clear()
  }

  generateCsrfSecret() {
    return randomBytes(24).toString('hex')
  }

  parseSessionCookie(cookieHeader) {
    if (!cookieHeader || typeof cookieHeader !== 'string') return null
    const parts = cookieHeader.split(';')
    for (const part of parts) {
      const [key, val] = part.trim().split('=')
      if (key === COOKIE_NAME) return val
    }
    return null
  }

  createSetCookieHeader(sid, maxAgeSeconds = 28800) {
    return `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`
  }

  createClearCookieHeader() {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
  }

  async createSession({ userId, tenantId, appRole, acr = 1, amr = [], encryptedTokens = {} }) {
    const sid = `ns_sid_${randomBytes(24).toString('hex')}`
    const now = Date.now()
    const csrfSecret = this.generateCsrfSecret()

    const session = {
      sid,
      user_id: String(userId),
      tenant_id: String(tenantId),
      app_role: String(appRole),
      acr: Number(acr),
      amr: Array.isArray(amr) ? amr : [],
      encrypted_tokens: encryptedTokens,
      csrf_secret: csrfSecret,
      created_at: new Date(now).toISOString(),
      idle_expires_at: new Date(now + IDLE_TIMEOUT_MS).toISOString(),
      absolute_expires_at: new Date(now + ABSOLUTE_TIMEOUT_MS).toISOString(),
    }

    this.sessions.set(sid, session)
    return session
  }

  async getSession(sid, now = Date.now()) {
    if (!sid) return null

    // Check denylist
    if (this.denylist.has(sid)) {
      return null
    }

    const session = this.sessions.get(sid)
    if (!session) return null

    // Check absolute expiration
    if (new Date(session.absolute_expires_at).getTime() <= now) {
      this.sessions.delete(sid)
      return null
    }

    // Check idle expiration
    if (new Date(session.idle_expires_at).getTime() <= now) {
      this.sessions.delete(sid)
      return null
    }

    // Refresh idle expiration
    session.idle_expires_at = new Date(now + IDLE_TIMEOUT_MS).toISOString()
    this.sessions.set(sid, session)

    return { ...session }
  }

  async revokeSession(sid) {
    if (!sid) return false
    this.sessions.delete(sid)
    this.denylist.add(sid)
    return true
  }

  isDenylisted(sid) {
    return this.denylist.has(sid)
  }

  /**
   * Enforces CSRF token and origin for unsafe HTTP methods.
   */
  validateCsrf(req, session) {
    const method = (req.method || 'GET').toUpperCase()
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return { valid: true }
    }

    const csrfHeader = req.headers['x-ns-csrf'] || req.headers['X-NS-CSRF']
    if (!csrfHeader || csrfHeader !== session.csrf_secret) {
      return { valid: false, reason: 'Invalid or missing X-NS-CSRF header' }
    }

    const origin = req.headers['origin'] || req.headers['Origin']
    const host = req.headers['host'] || req.headers['Host']
    if (origin && host) {
      try {
        const originUrl = new URL(origin)
        if (originUrl.host !== host) {
          return { valid: false, reason: 'Cross-origin request rejected' }
        }
      } catch {
        return { valid: false, reason: 'Malformed origin header' }
      }
    }

    return { valid: true }
  }

  /**
   * Enforces Multi-Factor Authentication requirement (F-01, F-02).
   * All non-patient roles require server assurance acr >= 2 and amr containing otp or webauthn.
   */
  validateMfaAssurance(session) {
    if (session.app_role === 'patient') {
      return { valid: true }
    }

    const hasAcr = session.acr >= 2
    const hasAmr =
      session.amr &&
      (session.amr.includes('otp') ||
        session.amr.includes('webauthn') ||
        session.amr.includes('mfa'))

    if (!hasAcr || !hasAmr) {
      return {
        valid: false,
        reason:
          'Step-up authentication required: non-patient roles require acr >= 2 with MFA assurance',
        code: 'STEP_UP_REQUIRED',
      }
    }

    return { valid: true }
  }
}
