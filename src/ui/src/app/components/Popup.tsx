import { BarChart3, LogIn, Settings2 } from "lucide-react";
import { ChromeExtensionStorage, ExtensionStorage } from "../../services/storage";
import { HEALTH_MODES } from "../../../../shared/health-modes.mjs";
import { getSettings, saveSettings } from "../lib/db";
import { CentralStorage, MultiLayerStorage } from "../../../../shared/storage";

interface PopupProps {
  siteActive: boolean;
  siteName: string;
  scoredCount: number;
  totalCount?: number;
  userData: Partial<ChromeExtensionStorage> | null;
  onOpenDashboard: () => void;
  /**
   * True when a valid Supabase session is detected in chrome.storage.local.
   */
  hasActiveSession: boolean;
  /** True if the user has an active session but did not complete onboarding (aborted payment). */
  isIncomplete: boolean;
  /** True if the user has already completed onboarding (used to distinguish signup vs login flow). */
  onboardingCompleted: boolean;
  /** Called when the auth CTA is clicked for an unauthenticated user. */
  onOpenAuth: () => void;
}

export function Popup({
  siteActive,
  siteName,
  scoredCount,
  totalCount,
  userData,
  onOpenDashboard,
  hasActiveSession,
  isIncomplete,
  onboardingCompleted,
  onOpenAuth,
}: PopupProps) {
  // Single source of truth for the user's display name: the Options page
  // writes fullName to chrome.storage.local (user_account), which is what
  // ExtensionStorage returns. The IDB profileName is only used as fallback.
  const displayName = userData?.user_account?.fullName?.split(' ')[0] ?? null;
  const handleToggleHealthMode = () => {
    if (!userData?.user_preferences) return;
    const isNowActive = !userData.user_preferences.healthMode;
    ExtensionStorage.updatePreferences({
      healthMode: isNowActive
    });
    
    // Sync the toggled theme to IndexedDB for Dashboard / content script usage
    const selectedDisease = (userData.user_preferences.selectedTags && userData.user_preferences.selectedTags[0]) || "general";
    // If the user turns OFF the health mode toggle, we revert to general wellness. 
    // If ON, we use the selected disease.
    const newTheme = isNowActive && selectedDisease !== "general" ? selectedDisease : "general";
    
    MultiLayerStorage.updateDraft({ uiTheme: newTheme }).then(() => {
      MultiLayerStorage.commitDraftToLive();
    });
    
    getSettings().then(settings => {
      saveSettings({ ...settings, activeTheme: newTheme as any }).catch(console.warn);
    });
  };

  const handleNotificationChange = (freq: any) => {
    ExtensionStorage.updatePreferences({
      notificationFrequency: freq
    });
  };

  return (
    <div className="bg-white flex flex-col w-full h-full">
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 pt-4 border-b border-slate-50">
          <div className="flex items-center gap-2">
            <div
              className="grid size-8 place-items-center rounded-lg shadow-sm"
              style={{ backgroundColor: "var(--ns-grade-a)", color: "#fff" }}
            >
              <span style={{ fontWeight: 800 }}>N</span>
            </div>
            <div>
              <p className="text-slate-800 leading-tight" style={{ fontWeight: 800, fontSize: "1.05rem", paddingLeft: "2px" }}>
                NutriScore
              </p>
              {displayName && (
                <p className="text-xs text-slate-500 font-medium pl-0.5">
                  Hi, {displayName}
                </p>
              )}
            </div>
          </div>
          <button 
            title="Settings" 
            onClick={() => chrome.runtime.openOptionsPage()}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
          >
            <Settings2 size={18} />
          </button>
        </div>

        {/* Quick Toggles & Tags */}
        {userData?.user_preferences && (
          <div className="px-4 py-4 border-b border-slate-50 space-y-4">
            
            {userData.user_preferences.selectedTags && userData.user_preferences.selectedTags.length > 0 && userData.user_preferences.selectedTags[0] !== "general" && (
              (() => {
                const tag = userData.user_preferences.selectedTags[0];
                const modeObj = HEALTH_MODES[tag as keyof typeof HEALTH_MODES] as any;
                const tc = modeObj ? { bg: modeObj.palette.accentBg, accent: modeObj.palette.primary, label: modeObj.palette.primary } : { bg: '#eff6ff', label: '#1d4ed8', accent: '#bfdbfe' };
                return (
                  <div className="flex flex-wrap gap-1.5">
                    <span 
                      className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                      style={{ backgroundColor: tc.bg, color: tc.label, border: `2px solid ${tc.accent}66` }}
                    >
                      {tag}
                    </span>
                  </div>
                );
              })()
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Health Mode</span>
              <button 
                onClick={handleToggleHealthMode}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${userData.user_preferences.healthMode ? 'bg-blue-600' : 'bg-slate-200'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${userData.user_preferences.healthMode ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        )}

        {/* Status indicator */}
        <div className="mx-4 mt-4 flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 border border-slate-100">
          <span
            className={siteActive ? "ns-pulse" : ""}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: siteActive
                ? "var(--ns-grade-a)"
                : "var(--muted-foreground)",
            }}
            aria-hidden
          />
          <span className="text-slate-700 font-medium" style={{ fontSize: "0.82rem" }}>
            {siteActive ? `Active on ${siteName}` : "Not a supported store"}
          </span>
        </div>

        {/* Session metrics */}
        <div className="mx-4 mt-3 flex items-center justify-center rounded-xl border border-slate-100 px-3 py-3 shadow-sm bg-white">
          <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)", fontWeight: 500 }}>
            <span style={{ fontWeight: 800, color: "var(--foreground)" }}>{scoredCount}</span>
            {(totalCount ?? 0) > 0 ? ` of ${totalCount} items graded` : " items graded"}
          </span>
        </div>

        {/* Action button — auth-aware */}
        <div className="p-4 pt-4">
          {hasActiveSession && !isIncomplete ? (
            userData?.nutriscore_is_premium ? (
              /* Authenticated & Onboarded & Premium: open the shopping analytics dashboard */
              <button
                id="open-dashboard-btn"
                type="button"
                onClick={onOpenDashboard}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-white transition-all hover:opacity-90 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black font-semibold tracking-wide"
                style={{ backgroundColor: "var(--shell-primary, #2563eb)" }}
              >
                <BarChart3 size={16} aria-hidden />
                <span style={{ fontSize: "0.88rem" }}>View Shopping Analytics</span>
              </button>
            ) : (
              /* Authenticated & Onboarded & Basic: prompt upgrade */
              <button
                id="upgrade-dashboard-btn"
                type="button"
                onClick={() => {
                  chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") + "?mode=renew" });
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-white transition-all hover:opacity-90 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black font-semibold tracking-wide"
                style={{ backgroundColor: "#1e293b" }}
              >
                <BarChart3 size={16} aria-hidden />
                <span style={{ fontSize: "0.88rem" }}>Upgrade to Premium to View Shopping Analytics</span>
              </button>
            )
          ) : (
            /* Unauthenticated or Incomplete: open onboarding wizard (sign-up/resume) or login modal */
            <button
              id="open-auth-btn"
              type="button"
              onClick={onOpenAuth}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-white transition-all hover:opacity-90 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black font-semibold tracking-wide"
              style={{ backgroundColor: "var(--shell-primary, #2563eb)" }}
            >
              <LogIn size={16} aria-hidden />
              <span style={{ fontSize: "0.88rem" }}>
                {isIncomplete 
                  ? 'Finish Sign Up' 
                  : (onboardingCompleted ? 'Log In to Your Account' : 'Sign Up — It\'s Free to Start')}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
