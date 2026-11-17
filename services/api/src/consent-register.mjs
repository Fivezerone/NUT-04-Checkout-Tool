// services/api/src/consent-register.mjs
// Consent Register & Verification Engine (Blueprint §3.9 N9; Findings X-08; Invariant T-08)

const STATUTORY_PURPOSES = new Set(['C1', 'C2', 'C3', 'C4'])

const PURPOSE_MAPPINGS = {
  clinician_link: 'C1',
  purchase_timeline: 'C2',
  diary: 'C3',
  de_identified_aggregates: 'C4',
  payer_analytics: 'C4',
}

export function normalizePurpose(purpose) {
  if (STATUTORY_PURPOSES.has(purpose)) return purpose
  return PURPOSE_MAPPINGS[purpose] || null
}

export class ConsentRegisterService {
  constructor(store) {
    this.store = store
    // Local cache: consentRef -> { active: boolean, cachedAt: number, purpose: string }
    this.cache = new Map()
    this.CACHE_TTL_MS = 30 * 1000 // 30 seconds
  }

  clearCache() {
    this.cache.clear()
  }

  async registerConsent(entry) {
    if (!entry.consent_ref || typeof entry.consent_ref !== 'string') {
      throw new Error('consent_ref is required')
    }
    if (!entry.patient_ref || typeof entry.patient_ref !== 'string') {
      throw new Error('patient_ref is required')
    }
    const normPurpose = normalizePurpose(entry.purpose)
    if (!normPurpose) {
      throw new Error(`Invalid purpose: ${entry.purpose}. Must be C1, C2, C3, or C4.`)
    }
    if (!entry.notice_hash || typeof entry.notice_hash !== 'string') {
      throw new Error('notice_hash is required')
    }

    const saved = await this.store.saveConsent({
      ...entry,
      purpose: normPurpose,
    })

    // Invalidate cache on change
    this.cache.delete(entry.consent_ref)
    return saved
  }

  async revokeConsent(consentRef, revokedAt = new Date().toISOString()) {
    if (!consentRef) return null
    const result = await this.store.revokeConsent(consentRef, revokedAt)
    // Push invalidation: purge immediately from cache
    this.cache.delete(consentRef)
    return result
  }

  async getConsent(consentRef) {
    if (!consentRef) return null
    return this.store.getConsent(consentRef)
  }

  /**
   * Evaluates active consent status for the given purpose.
   * Throws if underlying store is unreachable (fail closed on 503).
   * Caches positive and negative results for 30 seconds.
   */
  async hasActiveConsent(consentRef, requiredPurpose = 'C2', now = Date.now()) {
    if (!consentRef || typeof consentRef !== 'string') {
      return false
    }

    const targetCategory = normalizePurpose(requiredPurpose) || requiredPurpose

    const cached = this.cache.get(consentRef)
    if (cached && now - cached.cachedAt < this.CACHE_TTL_MS && cached.purpose === targetCategory) {
      return cached.active
    }

    // Load from authoritative store — throws if store unreachable (fail-closed)
    const record = await this.store.getConsent(consentRef)

    if (!record) {
      this.cache.set(consentRef, { active: false, cachedAt: now, purpose: targetCategory })
      return false
    }

    if (record.revoked_at) {
      this.cache.set(consentRef, { active: false, cachedAt: now, purpose: targetCategory })
      return false
    }

    if (record.expires_at) {
      const expTime = new Date(record.expires_at).getTime()
      if (!Number.isNaN(expTime) && expTime <= now) {
        this.cache.set(consentRef, { active: false, cachedAt: now, purpose: targetCategory })
        return false
      }
    }

    const grantedTime = new Date(record.granted_at).getTime()
    if (!Number.isNaN(grantedTime) && grantedTime > now) {
      this.cache.set(consentRef, { active: false, cachedAt: now, purpose: targetCategory })
      return false
    }

    const entryCategory = normalizePurpose(record.purpose) || record.purpose
    const active = entryCategory === targetCategory

    this.cache.set(consentRef, { active, cachedAt: now, purpose: targetCategory })
    return active
  }
}
