/**
 * NutriScore CAD Phase 8 — Extension Observed Cart Ledger Sync
 *
 * Reference: Blueprint §4.3, Decision D6, Amendment A6
 *
 * Points extension cart ledger sync at observed-orders endpoint.
 * Authenticated via memory-only Dietary Profile Token (DPT) with DPoP proof.
 *
 * Strictly event logging: no transaction, routing, stock, or settlement logic.
 */

/* global self */

(function (root) {
  async function syncObservedCartToBackend(options) {
    const {
      retailer,
      items,
      totalKes,
      dptToken,
      dpopProof,
      idempotencyKey,
      backendUrl = 'http://127.0.0.1:54321',
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

    const endpoint = `${backendUrl.replace(/\/+$/, '')}/functions/v1/observed-orders`
    const key =
      idempotencyKey || `obs-${retailer}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    const payload = {
      retailer,
      idempotency_key: key,
      total_kes: totalKes !== undefined ? Number(totalKes) : null,
      items: (items || []).map((it) => ({
        sku_id: it.sku_id || it.productId || it.id,
        qty: Number(it.quantity || it.qty) || 1,
        unit_price_kes: Number(it.priceSnapshot || it.unit_price_kes) || 0.0,
      })),
    }

    const headers = {
      'Content-Type': 'application/json',
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
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportObj
  } else {
    root.NutriObservedOrdersSync = exportObj
  }
})(typeof globalThis !== 'undefined' ? globalThis : self)
