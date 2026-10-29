// src/ui/src/dashboard.tsx
// Shopper Dashboard (Patient Shopping Analytics)
// Reference: CAD-Only Identity & Onboarding Rollback (Phase 4)

import * as React from "react";
import { useState, useEffect, lazy, Suspense } from "react";
// @ts-ignore
window.React = React;
import { createRoot } from "react-dom/client";
import { Dashboard } from "./app/components/Dashboard";
import { ThemeProvider } from "./app/context/ThemeContext";
import { supabase, signOutUser, setOnboardingCompleted } from "./services/storage";
import { AlertTriangle } from "lucide-react";
import "./styles/index.css";

// Lazy-load OnboardingWizard for unauthenticated users or consent gate
const OnboardingWizard = lazy(() =>
  import("./app/components/OnboardingWizard").then((m) => ({ default: m.OnboardingWizard }))
);
type UserProfile = import("./app/components/OnboardingWizard").UserProfile;

/**
 * applyPersonalization — DOM-level greeting update for the static HTML scaffold.
 * Greet with first name only per Phase 4 requirements.
 */
function applyPersonalization(profile: UserProfile) {
  const { name, initials, primaryMetric } = profile;

  // 1. Dynamic Greeting with FIRST NAME ONLY
  const firstName = name.trim().split(" ")[0] || "Shopper";
  const hour = new Date().getHours();
  const timeStr = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const greetingEl = document.getElementById("user-greeting");
  const subtitleEl = document.getElementById("user-subtitle");
  if (greetingEl) greetingEl.textContent = `${timeStr}, ${firstName}`;
  if (subtitleEl) subtitleEl.textContent = "Shopper Dashboard — Shopping Analytics";

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

// D-11: definitive JWT error codes that warrant a sign-out
const DEFINITIVE_AUTH_ERRORS = new Set(['PGRST301', '401', '403']);

type AuthState =
  | "checking"
  | "unauthenticated"
  | "active"
  | "suspended"
  | "consent_required"
  | "offline";

interface SubscriptionResult {
  kind: 'ok' | 'transient';
  subStatus: AuthState;
  profile: UserProfile | null;
  onboardingCompleted: boolean;
}

type EnrollmentResult = SubscriptionResult;

async function checkEnrollmentAndProfile(userId: string, fallbackName: string): Promise<SubscriptionResult> {
  const TRANSIENT: SubscriptionResult = {
    kind: 'transient',
    subStatus: "offline",
    profile: null,
    onboardingCompleted: false,
  };

  try {
    const [memberResult, userResult, consentResult] = await Promise.all([
      supabase
        .from("tenant_members")
        .select("status, role, tenant_id")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("users")
        .select("full_name, condition, metric, onboarding_completed")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("consents")
        .select("id")
        .eq("patient_id", userId)
        .eq("consent_version", "2.0")
        .maybeSingle(),
    ]);

    const member = memberResult.data;
    const userRow = userResult.data;
    const consent = consentResult.data;

    // 1. If member record is suspended or deactivated -> block with clear clinical message
    if (member && (member.status === "suspended" || member.status === "deactivated")) {
      return {
        kind: "ok",
        subStatus: "suspended",
        profile: null,
        onboardingCompleted: false,
      };
    }

    // 2. If consent has not been granted -> require consent gate
    if (!consent?.id) {
      return {
        kind: "ok",
        subStatus: "consent_required",
        profile: null,
        onboardingCompleted: false,
      };
    }

    const fullName = userRow?.full_name?.trim() || fallbackName;
    const profile = buildProfile(
      fullName,
      userRow?.condition || "general",
      userRow?.metric || "Target Nutrients"
    );

    return {
      kind: "ok",
      subStatus: "active",
      profile,
      onboardingCompleted: true,
    };
  } catch (err) {
    console.warn("[checkEnrollmentAndProfile] Network error — offline state:", err);
    return TRANSIENT;
  }
}

// Alias for D-11 backwards-compatibility
const checkSubscriptionAndProfile = checkEnrollmentAndProfile;

function buildProfile(name: string, condition: string, primaryMetric: string): UserProfile {
  const firstName = name.trim().split(" ")[0] || "Shopper";
  const initials =
    name
      .split(" ")
      .map((w: string) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "PT";
  return { name: firstName, initials, condition, primaryMetric, isFirstTime: false };
}

function DashboardRoot() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [bootKey, setBootKey] = useState(0);

  useEffect(() => {
    async function init() {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setAuthState("unauthenticated");
          setReady(true);
          return;
        }

        const fallbackName =
          session.user.user_metadata?.full_name ||
          session.user.email?.split("@")[0] ||
          "Patient";

        // Optimistic render from local storage if previously consented
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          try {
            const local = (await chrome.storage.local.get([
              "patient_consent_accepted",
              "user_account",
            ])) as Record<string, any>;

            if (local.patient_consent_accepted && local.user_account?.fullName) {
              setProfile(
                buildProfile(
                  local.user_account.fullName,
                  local.user_account.condition || "general",
                  local.user_account.metric || "Target Nutrients"
                )
              );
              setAuthState("active");
              setReady(true);
            }
          } catch {
            // Ignore
          }
        }

        const result = await checkSubscriptionAndProfile(session.user.id, fallbackName);

        if (result.kind === "transient") {
          setAuthState((prev) => (prev === "active" ? prev : 'offline'));
          setReady(true);
          return;
        }

        if (result.subStatus === "active" && result.profile && result.onboardingCompleted) {
          setProfile(result.profile);
          setAuthState("active");
          setOnboardingCompleted(session.user.id, true).catch(() => {});
        } else {
          setAuthState(result.subStatus);
        }

        setReady(true);
      } catch (e) {
        console.error("[DashboardRoot] init() error:", e);
        setAuthState('offline');
        setReady(true);
      }
    }

    init();
  }, [bootKey]);

  const retryInit = () => {
    setReady(false);
    setAuthState("checking");
    setBootKey((k) => k + 1);
  };

  useEffect(() => {
    if (profile) applyPersonalization(profile);
  }, [profile]);

  const handleOnboardingComplete = (p?: UserProfile) => {
    if (p) {
      setProfile(p);
      setAuthState("active");
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500 font-medium">Loading Shopper Dashboard...</p>
      </div>
    );
  }

  if (authState === 'offline') {
    return (
      <ThemeProvider>
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center bg-slate-50">
          <p className="text-sm font-semibold text-slate-800">Connection Offline</p>
          <p className="text-xs text-slate-500">Could not verify clinic enrollment status.</p>
          <button
            type="button"
            className="px-4 py-2 text-xs rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition"
            onClick={retryInit}
          >
            Retry
          </button>
        </div>
      </ThemeProvider>
    );
  }

  if (authState === "unauthenticated" || authState === "consent_required") {
    return (
      <ThemeProvider>
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center">
              <p className="text-sm text-slate-400">Loading...</p>
            </div>
          }
        >
          <OnboardingWizard onComplete={handleOnboardingComplete} />
        </Suspense>
      </ThemeProvider>
    );
  }

  // Suspended or deactivated by clinic admin
  if (authState === "suspended") {
    return (
      <ThemeProvider>
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center font-sans">
          <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-slate-900">Clinical Care Enrollment Paused</h2>
          <p className="text-xs text-slate-600 max-w-sm mt-1.5 leading-relaxed">
            Your clinical nutrition monitoring has been paused or deactivated by your clinical care team. Please contact your primary clinic to review your care enrollment.
          </p>
          <button
            type="button"
            onClick={() => signOutUser().then(() => (window.location.href = "onboarding.html"))}
            className="mt-5 px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition"
          >
            Sign Out
          </button>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div
        className="min-h-screen overflow-auto"
        style={{ backgroundColor: "var(--background)" }}
      >
        <Dashboard onBack={() => window.close()} />
      </div>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<DashboardRoot />);
