/**
 * @license SPDX-License-Identifier: Apache-2.0
 * src/extension/flags.js — Signed Remote Feature Flag Manifest Client.
 * Reference: Blueprint §3.8, §5.1, §5.6 (WP-03, ADR-5)
 *
 * Responsibilities:
 *   - Offline-first cache in chrome.storage.local with bundle defaults.
 *   - Alarm-driven manifest polling every 5 minutes (staggered).
 *   - Fail-static: verify/network errors leave existing evaluated state untouched.
 *   - Ed25519 signature verification against pinned root public key.
 *   - Strict monotonic sequence enforcement (seq > current_seq, anti-rollback).
 *   - FNV-1a cohort bucketing: bucket = fnv1a32(installId + ':' + flag) % 100 < cohort_pct.
 *   - Kill switches: ns.global.neutral, ns.retailer.<retailer>.enabled.
 */

;(function (root) {
  'use strict'

  const STORAGE_KEY = 'nutri_flag_manifest'
  const INSTALL_ID_KEY = 'nutri_install_id'
  const FLAGS_TYP = 'ns-flags+json'

  // Default pinned public key for Stage A / production flags verification
  // 32-byte Ed25519 raw public key (or can be configured for tests via setPinnedPublicKeyForTest)
  let pinnedPublicKey = new Uint8Array([
    0xba, 0xf5, 0xf8, 0xef, 0x30, 0x80, 0xe8, 0xf0, 0xd5, 0x71, 0x99, 0x96, 0xe3, 0x80, 0x40, 0x07,
    0xc0, 0x2c, 0x20, 0x91, 0xd7, 0xaf, 0xe6, 0x70, 0x62, 0xde, 0x0f, 0x28, 0xfa, 0x55, 0xd7, 0x05,
  ])

  // Bundled default flag states (all features default to false; retailers default to enabled)
  const BUNDLE_DEFAULTS = Object.freeze({
    'ns.obs.sdk': false,
    'ns.global.neutral': false,
    'ns.scoring.v5': false,
    'ns.policy.v2': false,
    'ns.nme.v2': false,
    'ns.ledger.v2': false,
    'ns.scanner.v2': false,
    'ns.catalog.verify_v2': false,
    'ns.ui.closed_shadow': false,
    'ns.telemetry.v2': false,
    'ns.token.v2': false,
    'ns.bff.enforce': false,
    'ns.sse': false,
    'ns.cad.bff_client': false,
    'ns.cad.strict_states': false,
    'ns.retailer.carrefour.enabled': true,
    'ns.retailer.naivas.enabled': true,
    'ns.retailer.quickmart.enabled': true,
  })

  // In-memory state
  let currentManifest = null
  let currentSeq = 0
  let evaluatedFlags = { ...BUNDLE_DEFAULTS }
  let cachedInstallId = null
  let extensionVersion = '0.0.1'

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function fnv1a32(s) {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h >>> 0
  }

  function bucketForFlag(installId, flagName) {
    return fnv1a32(`${installId}:${flagName}`) % 100
  }

  function parseSemver(v) {
    if (!v || typeof v !== 'string') return [0, 0, 0]
    return v.split('.').map((p) => parseInt(p, 10) || 0)
  }

  function compareSemver(v1, v2) {
    const [maj1, min1, pat1] = parseSemver(v1)
    const [maj2, min2, pat2] = parseSemver(v2)
    if (maj1 !== maj2) return maj1 - maj2
    if (min1 !== min2) return min1 - min2
    return pat1 - pat2
  }

  function stableStringify(value) {
    if (value === null) return 'null'
    if (value === undefined) return undefined
    const t = typeof value
    if (t === 'boolean' || t === 'string') return JSON.stringify(value)
    if (t === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Non-finite number')
      return JSON.stringify(value)
    }
    if (Array.isArray(value)) {
      const items = value.map((v) => {
        const s = stableStringify(v)
        return s === undefined ? 'null' : s
      })
      return '[' + items.join(',') + ']'
    }
    if (t === 'object') {
      const keys = Object.keys(value).sort()
      const parts = []
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(value, k) && value[k] !== undefined) {
          const v = stableStringify(value[k])
          if (v !== undefined) parts.push(JSON.stringify(k) + ':' + v)
        }
      }
      return '{' + parts.join(',') + '}'
    }
    return undefined
  }

  function decodeBase64Url(str) {
    const norm = str.replace(/-/g, '+').replace(/_/g, '/')
    const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4))
    const padded = norm + pad

    if (typeof atob === 'function') {
      const binary = atob(padded)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes
    } else if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(padded, 'base64'))
    }
    throw new Error('Base64 decode unavailable')
  }

  // ── Verification & Evaluation ────────────────────────────────────────────────

  async function verifySignature(canonicalBody, sigBase64Url, pubKey) {
    try {
      const dataBytes = new TextEncoder().encode(canonicalBody)
      const sigBytes = decodeBase64Url(sigBase64Url)

      // Use SubtleCrypto (Web/ServiceWorker)
      if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
        let cryptoKey
        const rawBytes = pubKey instanceof Uint8Array ? pubKey : decodeBase64Url(pubKey)
        cryptoKey = await globalThis.crypto.subtle.importKey(
          'raw',
          rawBytes,
          { name: 'Ed25519' },
          false,
          ['verify'],
        )
        return await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, cryptoKey, sigBytes, dataBytes)
      }

      // Fallback to Node.js crypto in test / CLI environment
      if (typeof Buffer !== 'undefined') {
        const { verify, createPublicKey } = require('node:crypto')
        const raw = pubKey instanceof Uint8Array ? pubKey : decodeBase64Url(pubKey)
        const spkiPrefix = Buffer.from([
          0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        ])
        const spki = Buffer.concat([spkiPrefix, Buffer.from(raw)])
        const keyObj = createPublicKey({ key: spki, format: 'der', type: 'spki' })
        return verify(null, Buffer.from(dataBytes), keyObj, Buffer.from(sigBytes))
      }

      return false
    } catch {
      return false
    }
  }

  function evaluateManifest(manifest, installId, extVer = extensionVersion) {
    const result = { ...BUNDLE_DEFAULTS }
    if (!manifest || !manifest.flags || typeof manifest.flags !== 'object') {
      return result
    }

    for (const [name, cfg] of Object.entries(manifest.flags)) {
      if (!cfg || typeof cfg !== 'object') continue

      if (!cfg.enabled) {
        result[name] = false
        continue
      }

      // Version gate: if extension is older than required minimum, flag is disabled
      if (cfg.min_ext_ver && compareSemver(extVer, cfg.min_ext_ver) < 0) {
        result[name] = false
        continue
      }

      // Explicit ID allowlist overrides cohort percentage
      if (Array.isArray(cfg.allow_ids) && cfg.allow_ids.includes(installId)) {
        result[name] = true
        continue
      }

      // Deterministic cohort assignment via FNV-1a
      const cohortPct = typeof cfg.cohort_pct === 'number' ? cfg.cohort_pct : 0
      const bucket = bucketForFlag(installId, name)
      result[name] = bucket < cohortPct
    }

    return result
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async function getInstallId() {
    if (cachedInstallId) return cachedInstallId

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const data = await chrome.storage.local.get(INSTALL_ID_KEY)
        if (data[INSTALL_ID_KEY]) {
          cachedInstallId = data[INSTALL_ID_KEY]
          return cachedInstallId
        }
      } catch {}
    }

    // Generate random UUID
    let newId
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
      newId = globalThis.crypto.randomUUID()
    } else {
      newId = 'id-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
    }

    cachedInstallId = newId
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        await chrome.storage.local.set({ [INSTALL_ID_KEY]: newId })
      } catch {}
    }
    return cachedInstallId
  }

  async function loadFlags() {
    const installId = await getInstallId()

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const data = await chrome.storage.local.get(STORAGE_KEY)
        const cached = data[STORAGE_KEY]
        if (cached && cached.manifest && typeof cached.manifest.seq === 'number') {
          currentManifest = cached.manifest
          currentSeq = cached.manifest.seq
          evaluatedFlags = evaluateManifest(currentManifest, installId)
          return evaluatedFlags
        }
      } catch {}
    }

    evaluatedFlags = { ...BUNDLE_DEFAULTS }
    return evaluatedFlags
  }

  async function applyManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') {
      return { valid: false, error: 'Invalid manifest format' }
    }
    if (manifest.typ !== FLAGS_TYP) {
      return { valid: false, error: `Invalid manifest typ: expected ${FLAGS_TYP}, got ${manifest.typ}` }
    }
    if (typeof manifest.seq !== 'number' || !Number.isInteger(manifest.seq)) {
      return { valid: false, error: 'Manifest seq must be an integer' }
    }

    // Anti-rollback enforcement: seq must be strictly monotonic
    if (manifest.seq <= currentSeq) {
      return {
        valid: false,
        error: `Anti-rollback rejection: incoming seq ${manifest.seq} <= current seq ${currentSeq}`,
      }
    }

    // Freshness enforcement: reject future timestamps (> 5 min in future)
    if (manifest.issued_at) {
      const issuedTime = new Date(manifest.issued_at).getTime()
      if (isNaN(issuedTime) || issuedTime > Date.now() + 5 * 60 * 1000) {
        return { valid: false, error: 'Manifest timestamp is invalid or in future' }
      }
    }

    if (!manifest.sig) {
      return { valid: false, error: 'Missing manifest signature' }
    }

    // Reconstruct canonical body for signature verification
    const body = {
      flags: manifest.flags,
      issued_at: manifest.issued_at,
      kid: manifest.kid,
      seq: manifest.seq,
      typ: manifest.typ,
    }

    const canonicalBody = stableStringify(body)
    const valid = await verifySignature(canonicalBody, manifest.sig, pinnedPublicKey)
    if (!valid) {
      return { valid: false, error: 'Invalid Ed25519 signature on flag manifest' }
    }

    // Manifest verified successfully: update state
    const installId = await getInstallId()
    currentManifest = manifest
    currentSeq = manifest.seq
    evaluatedFlags = evaluateManifest(manifest, installId)

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        await chrome.storage.local.set({
          [STORAGE_KEY]: {
            manifest,
            evaluatedFlags,
            updatedAt: new Date().toISOString(),
          },
        })
      } catch {}
    }

    return { valid: true, seq: currentSeq }
  }

  async function refreshFlags(url = 'https://api.nutriscore.co.ke/v1/flags/manifest.json', fetchImpl = globalThis.fetch) {
    try {
      if (typeof fetchImpl !== 'function') return false
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        if (typeof NutriObs !== 'undefined') NutriObs.count('flag_manifest_invalid', 1)
        return false // fail-static: leave existing flags untouched
      }
      const manifest = await res.json()
      const result = await applyManifest(manifest)
      if (!result.valid) {
        if (typeof NutriObs !== 'undefined') NutriObs.count('flag_manifest_invalid', 1)
        return false
      }
      return true
    } catch {
      if (typeof NutriObs !== 'undefined') NutriObs.count('flag_manifest_invalid', 1)
      return false // fail-static
    }
  }

  function isEnabled(flagName) {
    if (Object.prototype.hasOwnProperty.call(evaluatedFlags, flagName)) {
      return Boolean(evaluatedFlags[flagName])
    }
    // Unknown flags default to false
    return false
  }

  function getFlagState(flagName) {
    return evaluatedFlags[flagName] ?? false
  }

  function getAllFlags() {
    return { ...evaluatedFlags }
  }

  function setPinnedPublicKeyForTest(key) {
    pinnedPublicKey = key instanceof Uint8Array ? key : decodeBase64Url(key)
  }

  function setInstallIdForTest(id) {
    cachedInstallId = id
    evaluatedFlags = evaluateManifest(currentManifest, id)
  }

  function setExtensionVersionForTest(ver) {
    extensionVersion = ver
    if (currentManifest) {
      evaluatedFlags = evaluateManifest(currentManifest, cachedInstallId)
    }
  }

  function resetForTest() {
    currentManifest = null
    currentSeq = 0
    evaluatedFlags = { ...BUNDLE_DEFAULTS }
    cachedInstallId = null
    extensionVersion = '0.0.1'
  }

  const exportObj = {
    loadFlags,
    refreshFlags,
    applyManifest,
    isEnabled,
    getFlagState,
    getAllFlags,
    getInstallId,
    evaluateManifest,
    fnv1a32,
    bucketForFlag,
    setPinnedPublicKeyForTest,
    setInstallIdForTest,
    setExtensionVersionForTest,
    resetForTest,
    BUNDLE_DEFAULTS,
    FLAGS_TYP,
  }

  if (typeof self !== 'undefined') {
    self.NutriFlags = exportObj
  }
  if (typeof window !== 'undefined') {
    window.NutriFlags = exportObj
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportObj
  }
})(typeof globalThis !== 'undefined' ? globalThis : self)
