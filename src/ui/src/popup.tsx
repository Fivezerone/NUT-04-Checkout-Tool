import * as React from "react";
// @ts-ignore
window.React = React;
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Popup } from "./app/components/Popup";
import { BlueThemeProvider } from "./app/context/BlueThemeProvider";
import { ExtensionStorage, ChromeExtensionStorage, supabase } from "./services/storage";
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
      const [storageData, { data: { session } }] = await Promise.all([
        ExtensionStorage.getOnboardingData(),
        supabase.auth.getSession(),
      ]);

      if (storageData.onboarding_completed) {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ action: "CHECK_TIER" }, (response) => {
            const isPremium = response?.tier === "premium";
            setUserData({ ...storageData, nutriscore_is_premium: isPremium });
          });
        } else {
          // Fallback or dev mode normalizer
          const isPremium = storageData.nutriscore_is_premium === true || (typeof storageData.nutriscore_is_premium === 'string' && storageData.nutriscore_is_premium.length > 10);
          setUserData({ ...storageData, nutriscore_is_premium: isPremium });
        }
      }

      if (session) {
        if (!storageData.onboarding_completed) {
          setAuthState('incomplete');
        } else {
          setAuthState('loggedIn');
        }
      } else if (storageData.onboarding_completed) {
        setAuthState('returning');
      } else {
        setAuthState('new');
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
        onboardingCompleted={authState === 'returning' || authState === 'loggedIn'}
        onOpenAuth={handleOpenAuth}
      />
    </BlueThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<PopupRoot />);
