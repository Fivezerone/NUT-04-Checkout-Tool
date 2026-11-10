import React from "react";
import { BarChart3, LogIn, Settings2, ShoppingBasket } from "lucide-react";
import { ChromeExtensionStorage } from "../../services/storage";
import { GradeBadge, ConditionChip } from "./ui";
import type { Grade } from "../lib/nutriscore";
import { HEALTH_MODES } from "../../../../shared/health-modes.mjs";

interface PopupProps {
  siteActive: boolean;
  siteName: string;
  scoredCount: number;
  totalCount?: number;
  userData: Partial<ChromeExtensionStorage> | null;
  onOpenDashboard: () => void;
  hasActiveSession: boolean;
  isIncomplete: boolean;
  onboardingCompleted: boolean;
  onOpenAuth: () => void;
}

export function Popup({
  siteActive,
  siteName,
  scoredCount,
  totalCount = 0,
  userData,
  onOpenDashboard,
  hasActiveSession,
  isIncomplete,
  onboardingCompleted,
  onOpenAuth,
}: PopupProps) {
  // Display name is derived from user_account fullName
  const displayName = userData?.user_account?.fullName?.split(" ")[0] ?? null;

  const activeFocusTag =
    (userData?.user_preferences?.selectedTags && userData.user_preferences.selectedTags[0]) ||
    (userData?.user_account as any)?.condition ||
    "general";
  const isGeneralWellness = !activeFocusTag || activeFocusTag === "general";
  const activeModeObj = HEALTH_MODES[activeFocusTag as keyof typeof HEALTH_MODES] as any;
  const tagColor = activeModeObj
    ? { bg: activeModeObj.palette.accentBg, accent: activeModeObj.palette.primary, label: activeModeObj.palette.primary }
    : { bg: "var(--color-info-subtle)", label: "var(--color-info-text)", accent: "var(--color-info-border)" };

  // Typical grade placeholder for live snapshot (default B when active items exist)
  const estimatedBasketGrade: Grade = scoredCount > 0 ? "B" : "C";

  return (
    <div
      className="flex min-h-[460px] w-full max-w-[380px] flex-col bg-[color:var(--t-color-surface)] text-[color:var(--t-color-text-strong)]"
      data-surface="shopper"
    >
      {/* 3px Brand gradient hairline (Section 4.2: brand moments only) */}
      <div
        className="h-1 w-full"
        style={{
          background: "linear-gradient(90deg, #F04770 0%, #F78C6A 20%, #FFD167 40%, #06D7A0 60%, #108AB1 80%, #073A4B 100%)",
        }}
      />

      <div className="flex flex-1 flex-col justify-between p-4 space-y-4">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-[color:var(--t-color-border-subtle)] pb-3">
          <div className="flex items-center gap-2.5">
            <div
              className="grid size-9 place-items-center rounded-xl bg-[color:var(--t-color-action-primary)] text-white shadow-xs font-black text-lg"
              aria-label="NutriScore icon"
            >
              N
            </div>
            <div>
              <p className="font-extrabold text-base leading-tight text-[color:var(--t-color-text-strong)]">
                NutriScore
              </p>
              {displayName ? (
                <p className="text-xs font-medium text-[color:var(--t-color-text-muted)]">
                  Hi, {displayName}
                </p>
              ) : (
                <p className="text-xs text-[color:var(--t-color-text-muted)]">
                  Shopping Care Monitor
                </p>
              )}
            </div>
          </div>

          <button
            title="Settings"
            aria-label="Care Settings"
            onClick={() => chrome.runtime.openOptionsPage()}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--t-color-border-subtle)] text-[color:var(--t-color-text-muted)] hover:bg-[color:var(--t-color-surface-subtle)] hover:text-[color:var(--t-color-text-strong)] transition-colors"
          >
            <Settings2 size={16} />
          </button>
        </div>

        {/* Active Store Status */}
        <div className="flex items-center justify-between rounded-xl border border-[color:var(--t-color-border-subtle)] bg-[color:var(--t-color-surface-subtle)] px-3.5 py-2.5">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-block size-2.5 rounded-full ${siteActive ? "ns-pulse" : ""}`}
              style={{
                backgroundColor: siteActive ? "var(--t-color-action-primary)" : "var(--t-color-text-muted)",
              }}
              aria-hidden
            />
            <span className="text-xs font-semibold text-[color:var(--t-color-text-strong)]">
              {siteActive ? `Active on ${siteName}` : "Not a supported supermarket"}
            </span>
          </div>
          {siteActive && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--t-color-action-primary)]">
              Monitoring
            </span>
          )}
        </div>

        {/* Active Health Profile Banner: Displays mode badge with ConditionChip semantics */}
        <div className="flex items-center justify-between border-b border-[color:var(--t-color-border-subtle)] px-1 py-2">
          <span className="text-xs font-semibold text-[color:var(--t-color-text-strong)]">Health Mode</span>
          {isGeneralWellness ? (
            <span className="ui-status ui-status-neutral">
              General Wellness
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider shadow-xs"
              style={{
                backgroundColor: tagColor.bg,
                color: tagColor.label,
                borderColor: tagColor.accent,
                borderWidth: 1.5,
              }}
            >
              <ConditionChip condition={activeFocusTag} />
            </span>
          )}
        </div>

        {/* Live Basket Quality Snapshot Card */}
        <div className="rounded-2xl border border-[color:var(--t-color-border-subtle)] bg-[color:var(--t-color-surface)] p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-[color:var(--t-color-text-strong)]">
              <ShoppingBasket size={16} className="text-[color:var(--t-color-action-primary)]" />
              <span>Current Cart Basket</span>
            </div>
            {scoredCount > 0 && (
              <span className="text-xs font-semibold text-[color:var(--t-color-action-primary)]">
                {scoredCount} {scoredCount === 1 ? "item" : "items"}
              </span>
            )}
          </div>

          {scoredCount > 0 ? (
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-3">
                <GradeBadge grade={estimatedBasketGrade} size="md" />
                <div>
                  <p className="text-xs font-bold text-[color:var(--t-color-text-strong)]">
                    Basket Rating: Grade {estimatedBasketGrade}
                  </p>
                  <p className="text-[11px] text-[color:var(--t-color-text-muted)]">
                    {totalCount > scoredCount
                      ? `${scoredCount} of ${totalCount} items rated`
                      : `${scoredCount} items graded`}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-2 text-center text-xs text-[color:var(--t-color-text-muted)]">
              Add grocery items to your cart to see live Nutri-Score grades and clinical threshold guidance.
            </div>
          )}
        </div>

        {/* Actions Slot */}
        <div className="pt-2">
          {hasActiveSession && !isIncomplete ? (
            <button
              id="open-dashboard-btn"
              type="button"
              onClick={onOpenDashboard}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--t-color-action-primary)] px-4 py-3 text-xs font-bold text-white shadow-xs hover:opacity-95 transition-all"
            >
              <BarChart3 size={16} aria-hidden />
              <span>Open Shopper Dashboard</span>
            </button>
          ) : (
            <button
              id="open-auth-btn"
              type="button"
              onClick={onOpenAuth}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--t-color-action-primary)] px-4 py-3 text-xs font-bold text-white shadow-xs hover:opacity-95 transition-all"
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
export default Popup;
