import * as React from "react";
// @ts-ignore
window.React = React;
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Popup } from "./app/components/Popup";
import { BlueThemeProvider } from "./app/context/BlueThemeProvider";
import { ExtensionStorage, ChromeExtensionStorage, supabase, setOnboardingCompleted } from "./services/storage";
import { isSubscriptionExpired } from "./app/lib/subscriptionUtils";
import "./styles/index.css";

/**
 * User auth state as seen by the popup.
 *
 *  'checking'      – async init not yet complete (render nothing to avoid flash)
 *  'loggedIn'      – valid session + onboarding done → "View Shopping Analytics"
 *  'incomplete'    – valid session + onboarding NOT done → "Finish Sign Up"
 *  'returning'     – no session + onboarding done → "Log In"
 *  'new'           – no session + never onboarded → "Sign Up"
 */
type PopupAuthState = 'checking' | 'loggedIn' | 'incomplete' | 'returning' | 'new';

function PopupRoot() {
  const [siteActive, setSiteActive] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [scoredCount, setScoredCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [authState, setAuthState] = useState<PopupAuthState>('checking');
  const [userData, setUserData] = useState<Partial<ChromeExtensionStorage> | null>(null);

  /** Run both async checks in parallel so there is exactly ONE state transition
   *  (no flash from 'new'→'loggedIn' or 'returning'→'loggedIn'). */
  async function resolveAuthState() {
    try {
      // PERF: Read session from local cache and local storage in parallel (<5ms total)
      const [{ data: { session } }, storageData, local] = await Promise.all([
        supabase.auth.getSession(),
        ExtensionStorage.getOnboardingData(),
        typeof chrome !== "undefined" && chrome.storage?.local
          ? (chrome.storage.local.get(['onboarding_completed', 'nutri_entitlement', 'nutriscore_is_premium']) as Promise<Record<string, any>>)
          : Promise.resolve({} as Record<string, any>)
      ]);

      let isOnboarded = !!storageData?.onboarding_completed || local?.onboarding_completed === true;
      let isPremium = local?.nutriscore_is_premium === true || !!local?.nutri_entitlement;

      if (local?.nutri_entitlement) {
        const ent = local.nutri_entitlement;
        const expired = ent.tier !== 'premium' || isSubscriptionExpired(ent.premium_expires_at, ent.server_now);
        if (!expired || ent.tier === 'premium') {
          isPremium = true;
          isOnboarded = true;
        }
      }

      // PERF: Paint popup shell IMMEDIATELY (<10ms perceived load time, eliminates blank delay)
      setUserData({
        ...storageData,
        onboarding_completed: isOnboarded,
        nutriscore_is_premium: isPremium
      });

      if (session) {
        setAuthState(isOnboarded ? 'loggedIn' : 'incomplete');
      } else {
        setAuthState(isOnboarded ? 'returning' : 'new');
      }

      // Non-blocking background revalidation (Stale-While-Revalidate)
      if (session?.user?.id) {
        Promise.all([
          typeof chrome !== "undefined" && chrome.runtime?.sendMessage
            ? new Promise<boolean>((resolve) => {
                chrome.runtime.sendMessage({ action: "CHECK_TIER", userId: session.user.id }, (response) => {
                  resolve(!chrome.runtime.lastError && response?.tier === "premium");
                });
              })
            : Promise.resolve(false),
          supabase
            .from('users')
            .select('onboarding_completed, is_premium')
            .eq('id', session.user.id)
            .maybeSingle(),
          supabase.rpc('get_my_entitlement')
        ])
          .then(async ([swTierIsPremium, profileRes, entRes]) => {
            let updatedOnboarded = isOnboarded;
            let updatedPremium = isPremium || swTierIsPremium;

            if (profileRes?.data) {
              if (profileRes.data.onboarding_completed) updatedOnboarded = true;
              if (profileRes.data.is_premium === true) updatedPremium = true;
            }

            if (entRes?.data) {
              const ent = entRes.data;
              const expired = ent.tier !== 'premium' || isSubscriptionExpired(ent.premium_expires_at, ent.server_now);
              if (!expired || ent.tier === 'premium') {
                updatedPremium = true;
                updatedOnboarded = true;
              }
            }

            if (updatedPremium) {
              updatedOnboarded = true;
              setOnboardingCompleted(session.user.id, true).catch(() => {});
              if (typeof chrome !== "undefined" && chrome.storage?.local) {
                chrome.storage.local.set({
                  onboarding_completed: true,
                  nutriscore_is_premium: true
                }).catch(() => {});
              }
            }

            setUserData(prev => prev ? {
              ...prev,
              onboarding_completed: updatedOnboarded,
              nutriscore_is_premium: updatedPremium
            } : prev);

            setAuthState(updatedOnboarded ? 'loggedIn' : 'incomplete');
          })
          .catch((err) => {
            console.warn("[Popup] remote profile background verification warning:", err);
          });
      }
    } catch (e) {
      // D-11: never leave popup stuck at 'checking' — fall back to returning so
      // the user can at least open the dashboard and investigate.
      console.warn('[popup] resolveAuthState error (showing returning state):', e);
      setAuthState('returning');
    }
  }

  useEffect(() => {
    resolveAuthState();

    // ── Storage change listener ───────────────────────────────────────────
    // Re-resolve whenever auth tokens or onboarding state change.
    // Supabase v2 stores the session under a key derived from the project URL,
    // e.g. "sb-<project-ref>-auth-token". We match any key that starts with "sb-"
    // to catch token refresh events without hard-coding the project ref.
    const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      const authKeyChanged = Object.keys(changes).some(
        (k) => k.startsWith('sb-') || k === 'onboarding_completed'
      );
      if (authKeyChanged || changes.user_account || changes.user_preferences) {
        resolveAuthState();
      }
    };

    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(storageListener);
    }

    // ── Page stats (active tab NutriScore activity) ──────────────────────
    function fetchStats() {
      if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          if (tab?.id && tab.url) {
            let url: URL;
            try { url = new URL(tab.url); } catch { return; }
            chrome.tabs.sendMessage(tab.id, { action: "GET_PAGE_STATS" }, (response) => {
              if (chrome.runtime.lastError) {
                setSiteActive(false);
              } else if (response) {
                setSiteActive(true);
                setSiteName(url.hostname.replace("www.", ""));
                setScoredCount(response.count || 0);
                setTotalCount(response.total || 0);
              }
            });
          }
        });
      }
    }

    fetchStats();

    const msgListener = (msg: any) => {
      if (msg.action === "POPUP_STATS_UPDATE") fetchStats();
    };

    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(msgListener);
    }

    return () => {
      if (typeof chrome !== "undefined") {
        chrome.runtime?.onMessage?.removeListener(msgListener);
        chrome.storage?.onChanged?.removeListener(storageListener);
      }
    };
  }, []);

  // Don't render anything until we know the auth state — prevents flickering
  if (authState === 'checking') return null;

  // ── Navigation handlers ────────────────────────────────────────────────────

  const handleOpenDashboard = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  };

  /**
   * handleOpenAuth — the single entry point for unauthenticated or incomplete users.
   *
   * Button label and destination differ by state:
   *   'new'        → "Sign Up"        → onboarding.html?mode=signup
   *   'incomplete' → "Finish Sign Up" → onboarding.html?mode=signup
   *   'returning'  → "Log In"         → onboarding.html?mode=login
   *
   * After login/resume, redirectAfterLogin() in OnboardingWizard handles routing.
   */
  const handleOpenAuth = () => {
    const mode = authState === 'returning' ? "login" : "signup";
    chrome.tabs.create({
      url: chrome.runtime.getURL("onboarding.html") + `?mode=${mode}`,
    });
  };

  return (
    <BlueThemeProvider>
      <Popup
        siteActive={siteActive}
        siteName={siteName}
        scoredCount={scoredCount}
        totalCount={totalCount}
        userData={userData}
        onOpenDashboard={handleOpenDashboard}
        hasActiveSession={authState === 'loggedIn' || authState === 'incomplete'}
        isIncomplete={authState === 'incomplete'}
        onboardingCompleted={authState === 'returning' || authState === 'loggedIn'}
        onOpenAuth={handleOpenAuth}
      />
    </BlueThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<PopupRoot />);
