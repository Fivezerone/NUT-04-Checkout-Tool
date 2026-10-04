import * as React from "react";
import { useState, useEffect } from "react";
// @ts-ignore
window.React = React;
import { createRoot } from "react-dom/client";
import { Dashboard } from "./app/components/Dashboard";
import { OnboardingWizard, type UserProfile } from "./app/components/OnboardingWizard";
import { Toaster } from "sonner";
import { ThemeProvider } from "./app/context/ThemeContext";
import { supabase, signOutUser, savePremiumStatus } from "./services/storage";
import { resolveSubscriptionStatus, getDaysRemaining } from "./app/lib/subscriptionUtils";
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

type AuthState = 'checking' | 'unauthenticated' | 'active' | 'trialing' | 'basic';

interface SubscriptionResult {
  subStatus: AuthState;
  daysRemaining: number;
  profile: UserProfile | null;
  onboardingCompleted: boolean;
}

async function checkSubscriptionAndProfile(userId: string, fallbackName: string): Promise<SubscriptionResult> {
  try {
    const { data: row, error } = await supabase
      .from("users")
      .select(`
        full_name, condition, metric, notification_frequency,
        payment_received_at, subscription_status, onboarding_completed, trial_started_at
      `)
      .eq("id", userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { 
          subStatus: "trialing", 
          daysRemaining: 30, 
          profile: buildProfile(fallbackName, 'general', 'General'),
          onboardingCompleted: false 
        };
      }
      // Real DB error — sign out and force re-login. Do not allow stale local access.
      console.error("[checkSubscription] DB error:", JSON.stringify(error, null, 2));
      await signOutUser();
      return { subStatus: "unauthenticated", daysRemaining: 0, profile: null, onboardingCompleted: false };
    }

    const r = row as any;
    const resolved = resolveSubscriptionStatus(r.subscription_status, r.payment_received_at, r.trial_started_at);
    const days = getDaysRemaining(r.payment_received_at, r.trial_started_at);

    // Sync expiry to DB (optimistic UI update)
    // SEC-003: This client-side write is now just a harmless no-op / UI optimistic update.
    // The server-side trigger (enforce_billing_state) is the sole authority for expiry.
    if (resolved === "expired" && r.subscription_status !== "expired") {
      await supabase
        .from("users")
        .update({ subscription_status: "expired", is_premium: false })
        .eq("id", userId);
    }

    if (resolved === "expired" || resolved === "basic") {
      // Expired or Basic — redirect to onboarding/renew to upgrade
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        window.location.href = chrome.runtime.getURL("onboarding.html") + "?mode=renew";
      }
      return { subStatus: "unauthenticated", daysRemaining: 0, profile: null, onboardingCompleted: false };
    }

    const profile = buildProfile(
      r.full_name?.trim() || fallbackName,
      r.condition || "general",
      r.metric   || "General"
    );

    return { 
      subStatus: resolved as AuthState, 
      daysRemaining: days, 
      profile, 
      onboardingCompleted: !!r.onboarding_completed 
    };
  } catch (err) {
    console.error("[checkSubscription] Unexpected error:", err);
    // Hard failure — sign out and send to login rather than guessing.
    await signOutUser();
    return { subStatus: "unauthenticated", daysRemaining: 0, profile: null, onboardingCompleted: false };
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

  useEffect(() => {
    async function init() {
      // ── 1. Verify Supabase session ────────────────────────────────────────
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setAuthState("unauthenticated");
        setReady(true);
        return;
      }

      // ── 2. Load profile + check subscription from Supabase (single query) ──
      //    Supabase is the sole source of truth for account data.
      //    If the subscription is expired, checkSubscriptionAndProfile() signs
      //    the user out and redirects — no render needed in that case.
      const fallbackName =
        user.user_metadata?.full_name ||
        user.email?.split('@')[0] ||
        "User";

      const { subStatus, profile: fetchedProfile } =
        await checkSubscriptionAndProfile(user.id, fallbackName);

      if (subStatus === "unauthenticated") {
        // Either was expired (already redirected) or DB hard-failed.
        // Show login in case the redirect hasn't fired yet.
        setAuthState("unauthenticated");
        setReady(true);
        return;
      }

      // ── 3. Check onboarding completion in Supabase ────────────────────────
      //    The DB is the gate; we use it to sync the local UI hint.
      //    We also check local storage to defeat DB read-replica lag which
      //    can bounce the user back to the wizard immediately after payment.
      const local = await chrome.storage.local.get('onboarding_completed');
      if (!fetchedProfile?.onboardingCompleted && !local.onboarding_completed) {
        window.location.href = chrome.runtime.getURL("onboarding.html");
        return;
      }
      
      // Sync DB state to local storage for the popup
      await chrome.storage.local.set({ onboarding_completed: true });

      if (subStatus === "active") {
        try {
          const { data } = await supabase.functions.invoke('get-premium-token');
          if (data?.token) await savePremiumStatus(data.token);
        } catch (err) {
          console.warn('Failed to fetch premium token:', err);
        }
      } else {
        await savePremiumStatus(false);
      }

      setProfile(fetchedProfile);
      setAuthState(subStatus);
      setReady(true);
    }

    init();
  }, []);

  // Apply DOM-level personalization whenever profile changes
  useEffect(() => {
    if (profile) applyPersonalization(profile);
  }, [profile]);

  const handleOnboardingComplete = (p?: UserProfile) => {
    if (p) setProfile(p);
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!ready) return null;

  // ── Unauthenticated (or just signed out) — show login modal ─────────────
  if (authState === "unauthenticated") {
    return (
      <ThemeProvider>
        <OnboardingWizard initialMode="login" onComplete={handleOnboardingComplete} />
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
