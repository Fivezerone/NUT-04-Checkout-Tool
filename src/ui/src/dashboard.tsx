// src/ui/src/dashboard.tsx
// Shopper Dashboard (Patient Shopping Analytics)
// Reference: CAD-Only Identity & Onboarding Rollback (Phase 4)

import * as React from "react";
import { useState, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ShopperShell } from "./app/components/ShopperShell";
import { ThemeProvider } from "./app/context/ThemeContext";
import { supabase, signOutUser, setOnboardingCompleted } from "./services/storage";
import { AlertTriangle } from "lucide-react";
import "./styles/index.css";

import type { ConsentAcceptance } from "./app/components/ConsentGate";
const ConsentGate = lazy(() =>
  import("./app/components/ConsentGate").then((m) => ({ default: m.ConsentGate })),
);

interface UserProfile {
  name: string;
  initials: string;
  condition: string;
  primaryMetric: string;
  isFirstTime?: boolean;
  patientName?: string;
  patientEmail?: string;
  clinician?: string;
  clinic?: string;
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
          } catch (storageErr) {
            console.debug("[Dashboard] Local storage pre-flight read failed:", storageErr);
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

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <p className="text-[12px] text-muted font-medium">Loading Shopper Dashboard...</p>
      </div>
    );
  }

  if (authState === 'offline') {
    return (
      <ThemeProvider>
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center bg-canvas">
          <p className="text-[14px] font-semibold text-strong">Connection Offline</p>
          <p className="text-[12px] text-muted">Could not verify clinic enrollment status.</p>
          <button
            type="button"
            className="px-4 py-2 text-[12px] rounded-xl bg-brand-mint text-brand-navy font-semibold hover:bg-brand-mint/90 transition cursor-pointer"
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
            <div className="min-h-screen flex items-center justify-center bg-canvas">
              <p className="text-[12px] text-muted">Loading...</p>
            </div>
          }
        >
          <ConsentGate
            onAccept={async (_acceptance: ConsentAcceptance) => {
              await setOnboardingCompleted();
              setAuthState("active");
            }}
          />
        </Suspense>
      </ThemeProvider>
    );
  }

  // Suspended or deactivated by clinic admin
  if (authState === "suspended") {
    return (
      <ThemeProvider>
        <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6 text-center font-sans">
          <div className="w-12 h-12 bg-status-warning-subtle text-status-warning rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-xs">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-[16px] font-bold text-strong">Clinical Care Enrollment Paused</h2>
          <p className="text-[12px] text-muted max-w-sm mt-1.5 leading-relaxed">
            Your clinical nutrition monitoring has been paused or deactivated by your clinical care team. Please contact your primary clinic to review your care enrollment.
          </p>
          <button
            type="button"
            onClick={() => signOutUser().then(() => window.location.reload())}
            className="mt-5 px-4 py-2 border border-border-control hover:bg-surface-raised text-strong rounded-xl text-[12px] font-semibold transition cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-canvas">
        <ShopperShell onBack={() => window.close()} />
      </div>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<DashboardRoot />);
