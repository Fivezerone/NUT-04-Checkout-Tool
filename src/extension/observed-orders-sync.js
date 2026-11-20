/**
 * NutriScore CAD Phase 8 — Extension Observed Cart Ledger Sync
 *
 * Reference: Blueprint §4.3, Decision D6, Amendment A6, Finding A-06
 *
 * Points extension cart ledger sync at observed-orders endpoint.
 * Authenticated via memory-only Dietary Profile Token (DPT) with DPoP proof.
 *
 * Strictly event logging: no transaction, routing, stock, or settlement logic.
 */

;(function (root) {
  'use strict'

  function canonicalStringify(val) {
    if (val === null || typeof val !== 'object') return JSON.stringify(val)
    if (Array.isArray(val)) return `[${val.map(canonicalStringify).join(',')}]`
    const keys = Object.keys(val).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(val[k])}`).join(',')}}`
  }

  async function sha256Hex(str) {
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
        return Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      }
    } catch (e) {
      console.debug('[ObservedOrdersSync] Subtle crypto digest unavailable, falling back:', e)
    }

    try {
      // Node.js fallback in test / toolchain environment
      if (typeof require === 'function') {
        const cryptoMod = require('node:crypto')
        return cryptoMod.createHash('sha256').update(str).digest('hex')
      }
    } catch (e) {
      console.debug('[ObservedOrdersSync] Node crypto unavailable, falling back:', e)
    }

    // Deterministic string hash fallback (browser fallback without subtle)
    let h1 = 0xdeadbeef
    let h2 = 0x41c64e6d
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i)
      h1 = Math.imul(h1 ^ ch, 2654435761)
      h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0')
  }

  async function syncObservedCartToBackend(options) {
    const {
      retailer,
      items,
      totalKes,
      dptToken,
      dpopProof,
      idempotencyKey,
      backendUrl = (typeof NUTRI_CONFIG !== 'undefined' &&
        (NUTRI_CONFIG.GATEWAY_URL || NUTRI_CONFIG.API_URL)) ||
        '/api',
    } = options

    if (!retailer) {
      throw new Error('retailer is required')
    }
    if (!dptToken) {
      throw new Error('dptToken is required')
    }
    if (!dpopProof) {
      throw new Error('dpopProof is required')
    }

    const endpoint = `${backendUrl.replace(/\/+$/, '')}/v1/commerce/observed-orders`

    const payloadCore = {
      retailer,
      total_kes: totalKes !== undefined ? Number(totalKes) : null,
      items: (items || []).map((it) => ({
        sku_id: it.sku_id || it.productId || it.id,
        qty: Number(it.quantity || it.qty) || 1,
        unit_price_kes: Number(it.priceSnapshot || it.unit_price_kes) || 0.0,
      })),
    }

    // A-06 Hotfix: Derive deterministic key from payload hash so retries share the same key
    const payloadHash = await sha256Hex(canonicalStringify(payloadCore))
    const key = idempotencyKey || `obs-${retailer}-${payloadHash}`

    const payload = {
      ...payloadCore,
      idempotency_key: key,
    }

    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      Authorization: `DPoP ${dptToken}`,
      DPoP: dpopProof,
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`observed-orders sync failed (${response.status}): ${errText}`)
    }

    return await response.json()
  }

  const exportObj = {
    syncObservedCartToBackend,
    canonicalStringify,
    sha256Hex,
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportObj
  } else {
    root.NutriObservedOrdersSync = exportObj
  }
})(typeof globalThis !== 'undefined' ? globalThis : self)
