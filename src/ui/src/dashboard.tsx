import * as React from "react";
import { useState, useEffect } from "react";
// @ts-ignore
window.React = React;
import { createRoot } from "react-dom/client";
import { Dashboard } from "./app/components/Dashboard";
import { OnboardingWizard, type UserProfile } from "./app/components/OnboardingWizard";
import { SubscriptionExpiredPage } from "./app/components/SubscriptionExpiredPage";
import { Toaster } from "sonner";
import { ThemeProvider } from "./app/context/ThemeContext";
import { supabase, signOutUser, savePremiumStatus, getOnboardingCompleted, setOnboardingCompleted } from "./services/storage";
import { isSubscriptionExpired, getDaysRemainingFromExpiry } from "./app/lib/subscriptionUtils";
import "./styles/index.css";

/**
 * applyPersonalization — DOM-level greeting update for the static HTML scaffold.
 *
 * SOURCE OF TRUTH FIX: The display name is now read exclusively from
 * ExtensionStorage (chrome.storage.local → user_account.fullName), which
 * is the value the user sets in the Options/Settings page.
 *
 * Previously, the dashboard read from IndexedDB (profileName) while the popup
 * read from chrome.storage.local — producing two different names for the same
 * account (e.g. "Good afternoon, joe" vs "Hi, Alex" in the snapshot).
 */
function applyPersonalization(profile: UserProfile) {
  const { name, initials, primaryMetric } = profile;

  // 1. Dynamic Greeting
  const hour = new Date().getHours();
  const timeStr = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const greetingEl = document.getElementById("user-greeting");
  const subtitleEl = document.getElementById("user-subtitle");
  if (greetingEl) greetingEl.textContent = `${timeStr}, ${name.split(' ')[0]}`;
  if (subtitleEl) subtitleEl.textContent = `Welcome to your shopping analytics`;

  // 2. Avatar
  const avatarEl = document.getElementById("user-avatar-badge");
  if (avatarEl) avatarEl.textContent = initials;

  // 3. Metric legend sort (primary metric sorted first)
  const metricList = document.getElementById("nutrient-legend-list");
  if (metricList) {
    const items = Array.from(metricList.children);
    items.sort((a) => ((a.textContent ?? "").includes(primaryMetric) ? -1 : 1));
    items.forEach((item) => metricList.appendChild(item));
  }

  // 4. Ledger empty state
  const ledgerEmptyState = document.getElementById("ledger-empty-msg");
  if (ledgerEmptyState) {
    ledgerEmptyState.replaceChildren();
    const wrap = document.createElement("div");
    wrap.style.cssText = "padding:48px 0;text-align:center;";

    const h4 = document.createElement("h4");
    h4.style.cssText = "font-weight:700;color:#334155;margin-bottom:4px;";
    h4.textContent = `Ready to track your ${primaryMetric}?`;

    const p = document.createElement("p");
    p.style.cssText = "font-size:0.75rem;color:#64748b;margin-bottom:16px;";
    p.textContent = "Add items to your cart to activate real-time alerts.";

    wrap.append(h4, p);
    ledgerEmptyState.appendChild(wrap);
  }
}

// ── Subscription + profile check (Supabase is sole source of truth) ────────────

type AuthState = 'checking' | 'unauthenticated' | 'active' | 'trialing' | 'basic' | 'offline' | 'expired';

// D-11: definitive JWT error codes that warrant a sign-out
const DEFINITIVE_AUTH_ERRORS = new Set(['PGRST301', '401', '403']);

interface SubscriptionResult {
  kind: 'ok' | 'transient';
  subStatus: AuthState;
  daysRemaining: number;
  profile: UserProfile | null;
  onboardingCompleted: boolean;
}

async function checkSubscriptionAndProfile(userId: string, fallbackName: string): Promise<SubscriptionResult> {
  const TRANSIENT: SubscriptionResult = { kind: 'transient', subStatus: 'offline', daysRemaining: 0, profile: null, onboardingCompleted: false };
  try {
    const { data: row, error } = await supabase
      .from("users")
      .select(`
        full_name, condition, metric, notification_frequency,
        onboarding_completed
      `)
      .eq("id", userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          kind: 'ok',
          subStatus: "trialing",
          daysRemaining: 30,
          profile: buildProfile(fallbackName, 'general', 'General'),
          onboardingCompleted: false
        };
      }
      // D-11: only sign out on definitive JWT/auth errors; treat everything else as transient
      if (DEFINITIVE_AUTH_ERRORS.has(error.code)) {
        console.error("[checkSubscription] Definitive auth error — signing out:", error.code);
        await signOutUser();
        return { kind: 'ok', subStatus: "unauthenticated", daysRemaining: 0, profile: null, onboardingCompleted: false };
      }
      console.warn("[checkSubscription] Transient DB error (session preserved):", error.code, error.message);
      return TRANSIENT;
    }

    const { data: ent, error: entError } = await supabase.rpc('get_my_entitlement');
    if (entError) {
      console.warn("[checkSubscription] Transient entitlement error:", entError);
      return TRANSIENT;
    }

    const r = row as any;
    // F-09: Use ever_premium to correctly distinguish basic vs expired
    const isActive = ent.tier === 'premium' && !isSubscriptionExpired(ent.premium_expires_at, ent.server_now);
    const resolved = isActive ? 'active' : ent.ever_premium ? 'expired' : 'basic';
    const days = getDaysRemainingFromExpiry(ent.premium_expires_at, ent.server_now);

    if (!isActive) {
      // Expired or basic: do not show premium dashboard
      return { kind: 'ok', subStatus: resolved as AuthState, daysRemaining: 0, profile: null, onboardingCompleted: !!r.onboarding_completed };
    }

    const profile = buildProfile(
      r.full_name?.trim() || fallbackName,
      r.condition || "general",
      r.metric   || "General"
    );

    return {
      kind: 'ok',
      subStatus: resolved as AuthState,
      daysRemaining: days,
      profile,
      onboardingCompleted: !!r.onboarding_completed
    };
  } catch (err) {
    // D-11: network/AbortError → transient (keep session!); don't sign out
    console.warn("[checkSubscription] Network error — offline state (session preserved):", err);
    return TRANSIENT;
  }
}

function buildProfile(name: string, condition: string, primaryMetric: string): UserProfile {
  const initials = name
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";
  return { name, initials, condition, primaryMetric, isFirstTime: false };
}

// ── Root component ────────────────────────────────────────────────────────────

function DashboardRoot() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  // D-11: increment to re-trigger init() from the retry button
  const [bootKey, setBootKey] = useState(0);

  useEffect(() => {
    async function init() {
      try {
        // D-11: use getSession() (reads from local cache — no network call)
        // instead of getUser() which makes a network request and returns {user:null} offline.
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setAuthState("unauthenticated");
          setReady(true);
          return;
        }

        const fallbackName =
          session.user.user_metadata?.full_name ||
          session.user.email?.split('@')[0] ||
          "User";

        const result = await checkSubscriptionAndProfile(session.user.id, fallbackName);

        // D-11: transient errors (network down) → offline state, NOT sign-out
        if (result.kind === 'transient') {
          setAuthState('offline');
          setReady(true);
          return;
        }

        if (result.subStatus === "unauthenticated") {
          // Either was expired (already redirected) or definitive auth failure.
          setAuthState("unauthenticated");
          setReady(true);
          return;
        }

        // F-10: Server profile's onboarding_completed is authoritative.
        // Local cache CANNOT override a server false (F-10 remediation).
        // If DB says incomplete, always redirect to onboarding — even if local cache says complete.
        if (!result.onboardingCompleted) {
          window.location.href = chrome.runtime.getURL("onboarding.html");
          return;
        }

        // Cache the server-authoritative completion to avoid repeat DB calls on next load
        await setOnboardingCompleted(session.user.id, true);

        if (result.subStatus === "active") {
          try {
            const { data, error } = await supabase.functions.invoke("entitlement", { method: "POST" });
            if (error) throw error;
            if (data?.tier === "premium" && data?.token) await savePremiumStatus(data.token);
            else await savePremiumStatus(false);
          } catch (error) {
            console.warn("[DashboardRoot] entitlement refresh failed:", error);
            // Preserve previously valid entitlement on transient failure; never synthesize premium.
          }
        } else {
          await savePremiumStatus(false);
        }

        setProfile(result.profile);
        setAuthState(result.subStatus);
        setReady(true);
      } catch (e) {
        // D-11: top-level guard — never leave a blank white page on any error
        console.error('[DashboardRoot] init() uncaught error:', e);
        setAuthState('offline');
        setReady(true);
      }
    }

    init();
  }, [bootKey]);  // D-11: re-run when bootKey changes (retry after offline)

  // D-11: retry from offline — reset state and re-run init()
  const retryInit = () => {
    setReady(false);
    setAuthState('checking');
    setBootKey(k => k + 1);
  };

  // Apply DOM-level personalization whenever profile changes
  useEffect(() => {
    if (profile) applyPersonalization(profile);
  }, [profile]);

  const handleOnboardingComplete = (p?: UserProfile) => {
    if (p) setProfile(p);
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  // D-11: never return null — blank white page on any error is unacceptable
  if (!ready) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );

  // D-11: offline / transient failure — show retry instead of blank page or sign-out
  if (authState === 'offline') return (
    <ThemeProvider>
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm font-semibold">Could not connect to NutriScore servers.</p>
        <p className="text-xs text-muted-foreground">Check your connection, then tap Retry. Your account is safe.</p>
        <button
          className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition"
          onClick={retryInit}
        >Retry</button>
      </div>
    </ThemeProvider>
  );

  // ── Unauthenticated (or just signed out) — show login modal ─────────────
  if (authState === "unauthenticated") {
    return (
      <ThemeProvider>
        <OnboardingWizard initialMode="login" onComplete={handleOnboardingComplete} />
      </ThemeProvider>
    );
  }

  // D-12: expired — show the polished SubscriptionExpiredPage (not a redirect)
  if (authState === 'expired') {
    return (
      <ThemeProvider>
        <SubscriptionExpiredPage />
      </ThemeProvider>
    );
  }

  // D-12: basic — show an upgrade prompt inline (not a redirect loop)
  if (authState === 'basic') {
    return (
      <ThemeProvider>
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm font-semibold">You're on the Basic plan.</p>
          <p className="text-xs text-muted-foreground">Upgrade to Premium to unlock NutriScore analysis and health alerts.</p>
          <button
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition"
            onClick={() => {
              if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
                window.location.href = chrome.runtime.getURL('onboarding.html') + '?mode=renew';
              }
            }}
          >Upgrade to Premium</button>
        </div>
      </ThemeProvider>
    );
  }

  // ── Authenticated + active or trialing subscription ────────────────────────
  return (
    <ThemeProvider>
      {!profile && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}
      <div
        className="min-h-screen overflow-auto"
        style={{ backgroundColor: "var(--background)" }}
      >
        <Dashboard onBack={() => window.close()} />
        <Toaster position="bottom-center" />
      </div>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<DashboardRoot />);
