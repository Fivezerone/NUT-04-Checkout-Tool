/**
 * src/extension/entitlement.js  — global NutriEntitlement
 *
 * ES256 JWT verifier for the NutriScore entitlement token.
 * Runs in the service worker (MV3); uses WebCrypto only — no network.
 *
 * STAGE A (A-11b): @supabase/supabase-js package removed (A-04). The internal
 * getSupabase() accessor pattern is PRESERVED for reference. The auth.getSession()
 * call will be replaced with the OIDC session key (nutri_oidc_session) in
 * Stage C (TODO(Stage C): replace supabase.auth.getSession with OIDC token
 * lookup from chrome.storage; see ADR-0005).
 *
 * Rules:
 *  - Only accepts alg === "ES256" (ECDSA P-256 / SHA-256).
 *  - Looks up the signing key by "kid" in NUTRI_CONFIG.ENTITLEMENT_PUBLIC_KEYS.
 *  - Rejects unknown kid, wrong iss, sub !== session user id, expired exp.
 *  - Clock-rollback guard: persists { maxLocalSeen, lastServerNow } in
 *    chrome.storage.local under key "nutri_time_guard". If Date.now()
 *    is more than 5 minutes behind maxLocalSeen, treats tier as "basic".
 *  - Token stored at chrome.storage.local["nutri_entitlement"].
 *  - No code path reads isPremium from settings.
 */

/* global NUTRI_CONFIG, NutriSupabase */

self.NutriEntitlement = (() => {
  const STORAGE_KEY      = "nutri_entitlement";
  const TIME_GUARD_KEY   = "nutri_time_guard";
  const EXPECTED_ISS     = "nutriscore-entitlement";
  const CLOCK_SKEW_MS    = 5 * 60 * 1000; // 5 minutes

  // F-11: lazily-resolved Supabase client accessor.
  // Set once at boot via NutriEntitlement.init(sbAccessor) so all calls
  // share the SW singleton instead of spawning a new client per refresh().
  let _getSupabase = null;
  function getSupabase() {
    if (_getSupabase) return _getSupabase();
    if (typeof NutriSupabase !== "undefined" && typeof NUTRI_CONFIG !== "undefined") {
      return NutriSupabase.create(NUTRI_CONFIG.API_URL, NUTRI_CONFIG.OIDC_ISSUER);
    }
    throw new Error(
      '[NutriEntitlement] getSupabase() called before init() and NutriSupabase unavailable.'
    );
  }

  // ── WebCrypto helpers ──────────────────────────────────────────────────────
  function base64urlDecode(str) {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/")
      + "=".repeat((4 - str.length % 4) % 4);
    const bin = atob(padded);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }

  async function importPublicKey(jwk) {
    return crypto.subtle.importKey(
      "jwk", jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false, ["verify"]
    );
  }

  async function importEd25519Key(jwkOrRaw) {
    if (jwkOrRaw.kty === "OKP" && jwkOrRaw.crv === "Ed25519") {
      return crypto.subtle.importKey(
        "jwk", jwkOrRaw,
        { name: "Ed25519" },
        false, ["verify"]
      );
    }
    const raw = jwkOrRaw instanceof Uint8Array ? jwkOrRaw : base64urlDecode(jwkOrRaw.x || jwkOrRaw);
    return crypto.subtle.importKey(
      "raw", raw,
      { name: "Ed25519" },
      false, ["verify"]
    );
  }

  // ── Clock-rollback guard ───────────────────────────────────────────────────
  async function updateTimeGuard(serverNow) {
    const stored = (await chrome.storage.local.get(TIME_GUARD_KEY))[TIME_GUARD_KEY] ?? {};
    let maxLocalSeen = Math.max(stored.maxLocalSeen ?? 0, Date.now());
    // D-07: a trusted server clock caps the high-water mark so a once-wrong
    // clock self-heals on the next successful refresh() rather than locking
    // the user out permanently.
    if (serverNow) maxLocalSeen = Math.min(maxLocalSeen, serverNow + CLOCK_SKEW_MS);
    await chrome.storage.local.set({
      [TIME_GUARD_KEY]: { maxLocalSeen, lastServerNow: serverNow ?? stored.lastServerNow }
    });
    return maxLocalSeen;
  }

  async function isClockRolledBack() {
    const stored = (await chrome.storage.local.get(TIME_GUARD_KEY))[TIME_GUARD_KEY];
    if (!stored) return false;
    return Date.now() < (stored.maxLocalSeen ?? 0) - CLOCK_SKEW_MS;
  }

  // ── Token verification ─────────────────────────────────────────────────────
  /**
   * Verify a raw JWT string. Returns { valid: true, payload } or { valid: false, reason }.
   * Supports legacy ES256 entitlement tokens and modern EdDSA / ns-profile+jwt tokens (ADR-3, WP-06).
   *
   * @param {string} token
   * @param {string|object} expectedSubOrPolicy — current session user.id or policy options
   * @param {object} [keysManifest]             — optional signed key manifest
   * @param {object} [revokedSnapshot]          — optional set/array of revoked jtis
   * @param {number} [customNow]                — current timestamp in seconds
   */
  async function verifyToken(token, expectedSubOrPolicy, keysManifest, revokedSnapshot, customNow) {
    try {
      if (!token || typeof token !== "string") return { valid: false, reason: "malformed" };
      if (token.length > 4096) return { valid: false, reason: "token_too_large" };

      const parts = token.split(".");
      if (parts.length !== 3) return { valid: false, reason: "malformed" };

      const [headerB64, payloadB64, sigB64] = parts;

      // Decode header
      const header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));
      const nowSeconds = customNow ?? Math.floor(Date.now() / 1000);
      const isPolicyObj = expectedSubOrPolicy && typeof expectedSubOrPolicy === "object";
      const isV2Flag = typeof self !== "undefined" && self.NutriFlags?.isEnabled?.("ns.token.v2");
      const isV2Token = header.alg === "EdDSA" || header.typ === "ns-profile+jwt" || isPolicyObj || isV2Flag;

      // Algorithm check & signature verification
      if (header.alg === "EdDSA") {
        const kid = header.kid;
        const keys = keysManifest?.keys ?? (NUTRI_CONFIG?.ENTITLEMENT_PUBLIC_KEYS ?? []);
        const keyDef = keys.find(k => k.kid === kid) || keys[0];
        if (!keyDef) return { valid: false, reason: "unknown_kid" };

        const publicKey = await importEd25519Key(keyDef);
        const dataToVerify = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
        const sigBytes = base64urlDecode(sigB64);
        const valid = await crypto.subtle.verify(
          { name: "Ed25519" }, publicKey, sigBytes, dataToVerify
        );
        if (!valid) return { valid: false, reason: "bad_signature" };
      } else if (header.alg === "ES256") {
        const kid = header.kid;
        const keys = (NUTRI_CONFIG?.ENTITLEMENT_PUBLIC_KEYS ?? []);
        const jwk = keys.find(k => k.kid === kid);
        if (!jwk) return { valid: false, reason: "unknown_kid" };

        const publicKey = await importPublicKey(jwk);
        const dataToVerify = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
        const sigBytes = base64urlDecode(sigB64);
        const valid = await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" }, publicKey, sigBytes, dataToVerify
        );
        if (!valid) return { valid: false, reason: "bad_signature" };
      } else {
        return { valid: false, reason: "alg_rejected" };
      }

      // Decode payload
      const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));

      // Claim checks
      if (isV2Token && header.typ === "ns-profile+jwt") {
        // Blueprint §2.7 profile token checks
        if (payload.iss !== "https://exchange.nutriscore.co.ke" && payload.iss !== EXPECTED_ISS) {
          return { valid: false, reason: "wrong_iss" };
        }
        if (isPolicyObj && expectedSubOrPolicy.aud && payload.aud !== expectedSubOrPolicy.aud) {
          return { valid: false, reason: "wrong_aud" };
        }
        if (typeof payload.aud !== "string" || !payload.aud.startsWith("ext:")) {
          return { valid: false, reason: "wrong_aud" };
        }
        if (payload.exp && payload.exp <= nowSeconds) return { valid: false, reason: "expired" };
        if (payload.nbf && payload.nbf > nowSeconds + 60) return { valid: false, reason: "not_yet_valid" };

        // Monotonic profile_ver check
        if (isPolicyObj && expectedSubOrPolicy.storedProfileVer !== undefined) {
          if (payload.profile_ver !== undefined && payload.profile_ver < expectedSubOrPolicy.storedProfileVer) {
            return { valid: false, reason: "rollback_detected" };
          }
        }

        // Revocation check
        if (revokedSnapshot) {
          const isRevoked = revokedSnapshot instanceof Set
            ? revokedSnapshot.has(payload.jti)
            : Array.isArray(revokedSnapshot) && revokedSnapshot.includes(payload.jti);
          if (isRevoked) return { valid: false, reason: "token_revoked" };
        }

        return { valid: true, payload };
      }

      // Legacy entitlement token checks
      if (payload.iss !== EXPECTED_ISS) return { valid: false, reason: "wrong_iss" };
      const expectedSub = typeof expectedSubOrPolicy === "string" ? expectedSubOrPolicy : expectedSubOrPolicy?.sub;
      if (expectedSub && payload.sub !== expectedSub) return { valid: false, reason: "wrong_sub" };
      if (!payload.exp || payload.exp <= nowSeconds) return { valid: false, reason: "expired" };
      if (payload.nbf && payload.nbf > nowSeconds + 60) return { valid: false, reason: "not_yet_valid" };

      return { valid: true, payload };
    } catch (e) {
      return { valid: false, reason: `error:${e.message}` };
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Resolve the current tier from the stored token.
   * Returns "premium" only if:
   *  - A token exists in chrome.storage.local
   *  - The token is cryptographically valid for the current session user
   *  - The clock has not been rolled back
   * Returns "basic" otherwise.
   *
   * @param {string} sessionUserId  — auth.session.user.id
   * @returns {Promise<{tier: "premium"|"basic", payload?: object}>}
   */
  async function resolveTier(sessionUserId) {
    if (!sessionUserId) return { tier: "basic" };

    // Clock-rollback guard
    if (await isClockRolledBack()) {
      console.warn("[NutriEntitlement] Clock rollback detected — forcing basic tier");
      return { tier: "basic" };
    }

    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    if (!stored) return { tier: "basic" };

    const result = await verifyToken(stored, sessionUserId);
    if (!result.valid) {
      console.warn("[NutriEntitlement] Token invalid:", result.reason);
      return { tier: "basic" };
    }
    return { tier: "premium", payload: result.payload };
  }

  /**
   * Fetch a fresh entitlement from the server and store it.
   * Updates the time guard with the server's clock.
   * If the server returns "basic", deletes any stored token and premium data.
   *
   * Concurrent calls coalesce onto the same in-flight promise (Fix #19).
   *
   * @returns {Promise<"premium"|"basic">}
   */
  let _refreshPromise = null;
  async function refresh() {
    if (_refreshPromise) return _refreshPromise;
    _refreshPromise = _doRefresh().finally(() => { _refreshPromise = null; });
    return _refreshPromise;
  }

  async function _doRefresh() {
    try {
      // F-11: use the SW singleton via getSupabase() — never create a new client here.
      const supabase = getSupabase();
      const { data: { session }, error } = await supabase.auth.getSession();

      if (!session) {
        // D-06: Only revoke on a DEFINITIVE auth failure.
        // Transient failures (network down, token refresh race) must NOT wipe premium.
        const definitive = error &&
          /refresh_token_not_found|invalid_grant|session_not_found/i.test(
            error.code || error.message || ''
          );
        if (!error || definitive) await clear();
        return (await resolveTier(null)).tier === 'premium' ? 'premium' : 'basic';
      }

      const res = await fetch(
        `${NUTRI_CONFIG.API_URL}/functions/v1/entitlement`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(5000), // D-06: 5s timeout prevents indefinite hang
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // A-05 / Blueprint §2.7:
      // 401, 403, 410 -> Definitive revocation: purge token, emit token_revoked
      if (res.status === 401 || res.status === 403 || res.status === 410) {
        await clear();
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          try {
            chrome.runtime.sendMessage({ type: 'token_revoked', status: res.status });
          } catch (_e) {
            console.debug('[Entitlement] Token revoked message broadcast error:', _e);
          }
        }
        return 'basic';
      }
      if (res.status === 304) return 'unchanged';
      // D-06: non-ok (429, 5xx, network) means a transient server error — keep whatever token we have
      if (!res.ok) return 'unchanged';

      const data = await res.json();
      await updateTimeGuard(data.server_now ? Date.parse(data.server_now) : null);

      if (data.tier === 'premium' && data.token) {
        await chrome.storage.local.set({ [STORAGE_KEY]: data.token });
        return 'premium';
      }
      // Only an explicit 'basic' response revokes the token
      if (data.tier === 'basic') {
        await clear();
        return 'basic';
      }
      return 'unchanged';
    } catch (e) {
      // D-06: catch means a network/abort error — do NOT wipe the token
      console.error('[NutriEntitlement] refresh error (token preserved):', e.message);
      return 'unchanged';
    }
  }

  /**
   * Remove entitlement token and premium assessments from storage.
   * Called on sign-out and on "basic" server responses.
   */
  async function clear() {
    await chrome.storage.local.remove(STORAGE_KEY);
    // premium_assessments are cleared by catalog-sync.js via NutriScoreDB.clearPremium()
  }

  /**
   * Accept a token pushed from the UI (e.g. right after payment).
   * Verifies it before storing so the SW never trusts an unverified string.
   *
   * @param {string} token — the JWT from the payment-status / entitlement edge function
   * @param {string} uid   — the current session user.id (for sub verification)
   * @returns {Promise<boolean>} true if the token was valid and stored
   */
  async function adopt(token, uid) {
    const r = await verifyToken(token, uid);
    if (r.valid) {
      await chrome.storage.local.set({ [STORAGE_KEY]: token });
    }
    return r.valid;
  }

  /**
   * Wire the SW's Supabase singleton into this module.
   * Must be called once at boot before the first refresh().
   * @param {() => object} sbAccessor  — a function returning the singleton client
   */
  function init(sbAccessor) {
    _getSupabase = sbAccessor;
  }

  return { init, resolveTier, refresh, clear, verifyToken, adopt };
})();
