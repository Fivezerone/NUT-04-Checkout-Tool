/**
 * src/extension/entitlement.js  — global NutriEntitlement
 *
 * ES256 JWT verifier for the NutriScore entitlement token.
 * Runs in the service worker (MV3); uses WebCrypto only — no network.
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

  // ── Clock-rollback guard ───────────────────────────────────────────────────
  async function updateTimeGuard(serverNow) {
    const stored = (await chrome.storage.local.get(TIME_GUARD_KEY))[TIME_GUARD_KEY] ?? {};
    const maxLocalSeen = Math.max(stored.maxLocalSeen ?? 0, Date.now());
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
   * @param {string} token
   * @param {string} expectedSub  — the current session user.id
   */
  async function verifyToken(token, expectedSub) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return { valid: false, reason: "malformed" };

      const [headerB64, payloadB64, sigB64] = parts;

      // Decode header
      const header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));
      if (header.alg !== "ES256") return { valid: false, reason: "alg_rejected" };

      const kid = header.kid;
      const keys = (NUTRI_CONFIG?.ENTITLEMENT_PUBLIC_KEYS ?? []);
      const jwk = keys.find(k => k.kid === kid);
      if (!jwk) return { valid: false, reason: "unknown_kid" };

      // Verify signature
      const publicKey = await importPublicKey(jwk);
      const dataToVerify = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
      const sigBytes = base64urlDecode(sigB64);
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" }, publicKey, sigBytes, dataToVerify
      );
      if (!valid) return { valid: false, reason: "bad_signature" };

      // Decode payload
      const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));

      // Claim checks
      if (payload.iss !== EXPECTED_ISS) return { valid: false, reason: "wrong_iss" };
      if (payload.sub !== expectedSub)  return { valid: false, reason: "wrong_sub" };
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!payload.exp || payload.exp <= nowSeconds) return { valid: false, reason: "expired" };

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
   * @returns {Promise<"premium"|"basic">}
   */
  async function refresh() {
    try {
      const supabase = NutriSupabase.create(
        NUTRI_CONFIG.SUPABASE_URL,
        NUTRI_CONFIG.SUPABASE_ANON_KEY
      );
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        await clear();
        return "basic";
      }

      const res = await fetch(
        `${NUTRI_CONFIG.SUPABASE_URL}/functions/v1/entitlement`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = await res.json();
      await updateTimeGuard(data.server_now ? new Date(data.server_now).getTime() : null);

      if (data.tier === "premium" && data.token) {
        await chrome.storage.local.set({ [STORAGE_KEY]: data.token });
        return "premium";
      }

      // Basic — delete token and premium assessment data
      await clear();
      return "basic";
    } catch (e) {
      console.error("[NutriEntitlement] refresh failed:", e.message);
      return "basic";
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

  return { resolveTier, refresh, clear, verifyToken };
})();
