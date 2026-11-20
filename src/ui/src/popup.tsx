import * as React from "react";
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Popup } from "./app/components/Popup";
import { ThemeProvider } from "./app/context/ThemeContext";
import type { ChromeExtensionStorage } from "./services/storage";
import { SESSION_STORAGE_KEY } from "../../shared/session-key.mjs";
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
  const [basketGrade, setBasketGrade] = useState<'A' | 'B' | 'C' | 'D' | 'E' | null>(null);

  const [authState, setAuthState] = useState<PopupAuthState>('checking');
  const [userData, setUserData] = useState<Partial<ChromeExtensionStorage> | null>(null);

  /** Resolve auth state directly from OIDC local storage without bundling heavy REST client */
  async function resolveAuthState() {
    try {
      const local = typeof chrome !== "undefined" && chrome.storage?.local
        ? await (chrome.storage.local.get([
            SESSION_STORAGE_KEY,
            'partial_onboarding',
            'user_preferences',
            'user_account',
            'onboarding_completed',
            'nutri_entitlement',
            'nutriscore_is_premium'
          ]) as Promise<Record<string, any>>)
        : {} as Record<string, any>;

      const session = local[SESSION_STORAGE_KEY] || null;
      const storageData = {
        partial_onboarding: local.partial_onboarding,
        user_preferences: local.user_preferences,
        user_account: local.user_account
      };

      let isOnboarded = !!local.onboarding_completed;
      let isPremium = local.nutriscore_is_premium === true || !!local.nutri_entitlement;

      if (local.nutri_entitlement) {
        const ent = local.nutri_entitlement;
        if (ent.tier === 'premium' || ent.tier === 'clinical') {
          isPremium = true;
          isOnboarded = true;
        }
      }

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
    } catch (e) {
      console.warn('[popup] resolveAuthState error (showing returning state):', e);
      setAuthState('returning');
    }
  }

  useEffect(() => {
    resolveAuthState();

    // ── Basket grade session sync ─────────────────────────────────────────
    if (typeof chrome !== "undefined" && chrome.storage?.session) {
      chrome.storage.session.get(['basket_grade'], (data) => {
        if (data?.basket_grade) setBasketGrade(data.basket_grade as any);
      });
    }

    // ── Storage change listener ───────────────────────────────────────────
    const storageListener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName?: string,
    ) => {
      if (areaName === 'session') {
        if (changes.basket_grade) {
          setBasketGrade((changes.basket_grade.newValue as any) || null);
        }
      }
      if (!areaName || areaName === 'local') {
        const authKeyChanged = Object.keys(changes).some(
          (k) =>
            k === SESSION_STORAGE_KEY ||
            k === 'onboarding_completed' ||
            k === 'nutri_entitlement',
        );
        if (authKeyChanged || changes.user_account || changes.user_preferences) {
          resolveAuthState();
        }
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
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    } else {
      window.open("dashboard.html", "_blank");
    }
  };

  /**
   * handleOpenAuth — navigates unauthenticated or incomplete patients to the
   * care enrollment and consent gate inside dashboard.html.
   */
  const handleOpenAuth = () => {
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({
        url: chrome.runtime.getURL("dashboard.html"),
      });
    } else {
      window.open("dashboard.html", "_blank");
    }
  };

  return (
    <ThemeProvider>
      <Popup
        siteActive={siteActive}
        siteName={siteName}
        scoredCount={scoredCount}
        totalCount={totalCount}
        basketGrade={basketGrade}
        userData={userData}
        onOpenDashboard={handleOpenDashboard}
        hasActiveSession={authState === 'loggedIn' || authState === 'incomplete'}
        isIncomplete={authState === 'incomplete'}
        onboardingCompleted={authState === 'returning' || authState === 'loggedIn'}
        onOpenAuth={handleOpenAuth}
      />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<PopupRoot />);
