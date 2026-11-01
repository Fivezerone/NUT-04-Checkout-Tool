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
  // Display name is derived from user_account fullName
  const displayName = userData?.user_account?.fullName?.split(' ')[0] ?? null;

  const handleNotificationChange = (freq: any) => {
    ExtensionStorage.updatePreferences({
      notificationFrequency: freq
    });
  };

  const activeFocusTag = (userData?.user_preferences?.selectedTags && userData.user_preferences.selectedTags[0]) 
    || (userData?.user_account as any)?.condition 
    || "general";
  const isGeneralWellness = !activeFocusTag || activeFocusTag === "general";
  const activeModeObj = HEALTH_MODES[activeFocusTag as keyof typeof HEALTH_MODES] as any;
  const tagColor = activeModeObj 
    ? { bg: activeModeObj.palette.accentBg, accent: activeModeObj.palette.primary, label: activeModeObj.palette.primary } 
    : { bg: 'var(--color-info-subtle)', label: 'var(--color-info-text)', accent: 'var(--color-info-border)' };

  return (
    <div className="flex h-full w-full flex-col bg-[color:var(--color-surface)] text-[color:var(--color-text)]">
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[color:var(--color-border-subtle)] px-4 pb-3 pt-4">
          <div className="flex items-center gap-2">
            <div
              className="grid size-10 place-items-center rounded-lg shadow-sm"
              style={{ backgroundColor: "var(--ns-grade-a)", color: "var(--ns-on-grade-a)" }}
            >
              <span style={{ fontWeight: 800 }}>N</span>
            </div>
            <div>
              <p className="leading-tight text-[color:var(--color-text-strong)]" style={{ fontWeight: 800, fontSize: "1.05rem", paddingLeft: "2px" }}>
                NutriScore
              </p>
              {displayName && (
                <p className="pl-0.5 text-sm font-medium text-[color:var(--color-text-muted)]">
                  Hi, {displayName}
                </p>
              )}
            </div>
          </div>
          <button 
            title="Settings" 
            onClick={() => chrome.runtime.openOptionsPage()}
            className="ui-icon-button"
          >
            <Settings2 size={18} />
          </button>
        </div>

        {/* Active Health Profile Banner */}
        {userData?.user_preferences && (
          <div className="flex items-center justify-between border-b border-[color:var(--color-border-subtle)] px-4 py-3">
            <span className="text-sm font-semibold text-[color:var(--color-text-strong)]">Health Mode</span>
            {isGeneralWellness ? (
              <span className="ui-status ui-status-neutral">
                General Wellness
              </span>
            ) : (
              <span 
                className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider shadow-sm"
                style={{ backgroundColor: tagColor.bg, color: tagColor.label, borderColor: tagColor.accent, borderWidth: 2 }}
              >
                {activeModeObj?.label || activeFocusTag}
              </span>
            )}
          </div>
        )}

        {/* Status indicator */}
        <div className="mx-4 mt-4 flex items-center gap-3 rounded-xl border border-[color:var(--color-border-subtle)] bg-[color:var(--color-canvas-subtle)] px-3 py-3">
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
          <span className="font-medium text-[color:var(--color-text-strong)]" style={{ fontSize: "0.875rem" }}>
            {siteActive ? `Active on ${siteName}` : "Not a supported store"}
          </span>
        </div>

        {/* Session metrics */}
        <div className="ui-card mx-4 mt-3 flex items-center justify-center px-3 py-3">
          <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)", fontWeight: 500 }}>
            <span style={{ fontWeight: 800, color: "var(--foreground)" }}>{scoredCount}</span>
            {(totalCount ?? 0) > 0 ? ` of ${totalCount} items graded` : " items graded"}
          </span>
        </div>

        {/* Action button — auth & consent aware */}
        <div className="p-4 pt-4">
          {hasActiveSession && !isIncomplete ? (
            /* Authenticated & Enrolled with Consent: open the shopping analytics dashboard */
            <button
              id="open-dashboard-btn"
              type="button"
              onClick={onOpenDashboard}
              className="ui-button ui-button-primary min-h-11 w-full"
            >
              <BarChart3 size={16} aria-hidden />
              <span>Open shopper dashboard</span>
            </button>
          ) : (
            /* Unauthenticated or Incomplete Consent: open clinic sign-in or consent gate */
            <button
              id="open-auth-btn"
              type="button"
              onClick={onOpenAuth}
              className="ui-button ui-button-primary min-h-11 w-full"
            >
              <LogIn size={16} aria-hidden />
              <span>
                {isIncomplete ? "Complete Care Consent" : "Sign in with Clinic Credentials"}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
