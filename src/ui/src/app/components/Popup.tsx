import React, { useState, useEffect } from 'react'
import { BarChart3, LogIn, Settings2, ShoppingBasket, Pause, Play, Clock, PanelRightOpen } from 'lucide-react'
import { ChromeExtensionStorage } from '../../services/storage'
import { GradeBadge, ConditionChip } from './ui'
import type { Grade } from '../lib/nutriscore'

interface PopupProps {
  siteActive: boolean
  siteName: string
  scoredCount: number
  totalCount?: number
  basketGrade?: Grade | null
  userData: Partial<ChromeExtensionStorage> | null
  onOpenDashboard: () => void
  hasActiveSession: boolean
  isIncomplete: boolean
  onboardingCompleted: boolean
  onOpenAuth: () => void
}

export function Popup({
  siteActive,
  siteName,
  scoredCount,
  totalCount = 0,
  basketGrade = null,
  userData,
  onOpenDashboard,
  hasActiveSession,
  isIncomplete,
  onboardingCompleted,
  onOpenAuth,
}: PopupProps) {
  const [isPaused, setIsPaused] = useState(false)
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false)

  // Restore pause state for active supermarket domain on mount/domain change (F-14)
  useEffect(() => {
    if (!siteName || typeof chrome === 'undefined' || !chrome.storage?.local) return
    const key = `paused_${siteName}`
    chrome.storage.local.get([key], (data) => {
      const until = data?.[key]
      if (until && typeof until === 'number' && until > Date.now()) {
        setIsPaused(true)
      } else {
        setIsPaused(false)
        if (until) {
          chrome.storage.local.remove([key]).catch(() => {})
        }
      }
    })
  }, [siteName])

  // Display name is derived from user_account fullName
  const displayName = userData?.user_account?.fullName?.split(' ')[0] ?? null

  const activeFocusTag =
    (userData?.user_preferences?.selectedTags && userData.user_preferences.selectedTags[0]) ||
    (userData?.user_account as any)?.condition ||
    'general'

  const handlePause = (durationMinutes: number) => {
    setIsPaused(true)
    setPauseMenuOpen(false)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        [`paused_${siteName}`]: Date.now() + durationMinutes * 60 * 1000,
      })
    }
  }

  const handleResume = () => {
    setIsPaused(false)
    setPauseMenuOpen(false)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.remove([`paused_${siteName}`])
    }
  }

  const handleOpenSidePanel = () => {
    if (typeof chrome !== 'undefined' && (chrome as any).sidePanel?.open) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          ;(chrome as any).sidePanel.open({ tabId: tabs[0].id })
        }
      })
    }
  }

  return (
    <div
      className="flex min-h-[460px] w-[360px] flex-col bg-surface text-foreground font-sans text-xs select-none"
      data-surface="shopper"
    >
      {/* 3px Brand gradient hairline (Section 4.2 / Section 4.4) */}
      <div className="h-[3px] w-full bg-gradient-to-r from-brand-mint via-brand-sun to-brand-coral shrink-0" />

      <div className="flex flex-1 flex-col justify-between p-4 gap-4">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-border-control/20 pb-3">
          <div className="flex items-center gap-2.5">
            <div
              className="grid size-9 place-items-center rounded-xl bg-brand-mint text-brand-navy shadow-xs font-black text-[16px]"
              aria-label="NutriScore icon"
            >
              N
            </div>
            <div>
              <p className="font-extrabold text-[14px] leading-tight text-strong">
                NutriScore
              </p>
              {displayName ? (
                <p className="text-[12px] font-medium text-muted">Hi, {displayName}</p>
              ) : (
                <p className="text-[12px] text-muted">Shopping Care Monitor</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              title="Open Side Panel"
              aria-label="Open Side Panel"
              onClick={handleOpenSidePanel}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-control text-strong hover:bg-surface-raised transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <PanelRightOpen className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Care Settings"
              aria-label="Care Settings"
              onClick={() => typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage && chrome.runtime.openOptionsPage()}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-control text-strong hover:bg-surface-raised transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Active Store Status & Per-Site Pause Toggle */}
        <div className="flex flex-col gap-2 rounded-xl border border-border-control/30 bg-surface-raised p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block size-2.5 rounded-full ${
                  siteActive && !isPaused ? 'bg-status-success animate-pulse' : 'bg-muted'
                }`}
                aria-hidden
              />
              <span className="text-[12px] font-semibold text-strong">
                {siteActive ? siteName : 'Not a supported supermarket'}
              </span>
            </div>
            {siteActive && (
              <span
                className={`text-[12px] font-bold uppercase tracking-wider ${
                  isPaused ? 'text-status-warning' : 'text-status-success'
                }`}
              >
                {isPaused ? 'Paused' : 'Monitoring'}
              </span>
            )}
          </div>

          {/* Pause controls for active retailer */}
          {siteActive && (
            <div className="flex items-center justify-between pt-1 border-t border-border-control/10 text-[12px]">
              <span className="text-muted">Extension scanning:</span>
              {isPaused ? (
                <button
                  type="button"
                  onClick={handleResume}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-navy hover:underline cursor-pointer"
                >
                  <Play className="w-3 h-3" />
                  Resume
                </button>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setPauseMenuOpen((p) => !p)}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-strong cursor-pointer"
                  >
                    <Pause className="w-3 h-3" />
                    Pause monitoring...
                  </button>
                  {pauseMenuOpen && (
                    <div className="absolute right-0 bottom-full mb-1 w-44 bg-surface rounded-xl border border-border-control shadow-md py-1 z-50 flex flex-col text-[12px]">
                      <button
                        type="button"
                        onClick={() => handlePause(60)}
                        className="px-3 py-1.5 text-left hover:bg-surface-raised text-foreground cursor-pointer flex items-center gap-1.5"
                      >
                        <Clock className="w-3.5 h-3.5 text-muted" />
                        Pause for 1 hour
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePause(24 * 60)}
                        className="px-3 py-1.5 text-left hover:bg-surface-raised text-foreground cursor-pointer flex items-center gap-1.5"
                      >
                        <Pause className="w-3.5 h-3.5 text-muted" />
                        Pause for today
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Active Health Profile Banner - Neutral chip with icon (Decision 2.2 #8) */}
        <div className="flex items-center justify-between border-b border-border-control/20 px-1 py-1 text-[12px]">
          <span className="font-semibold text-strong">Health Mode</span>
          <ConditionChip condition={activeFocusTag} size="sm" />
        </div>

        {/* Live Basket Quality Snapshot Card */}
        <div className="rounded-2xl border border-border-control/20 bg-surface p-4 shadow-xs flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12px] font-bold text-strong">
              <ShoppingBasket className="w-4 h-4 text-brand-mint" />
              <span>Current Basket</span>
            </div>
            {scoredCount > 0 && (
              <span className="text-[12px] font-semibold text-brand-navy">
                {scoredCount} {scoredCount === 1 ? 'item' : 'items'}
              </span>
            )}
          </div>

          {scoredCount > 0 ? (
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-3">
                {basketGrade ? (
                  <GradeBadge grade={basketGrade} size="md" />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-surface-raised border border-border-control flex items-center justify-center font-bold text-strong text-[14px]">
                    {scoredCount}
                  </div>
                )}
                <div>
                  <p className="text-[12px] font-bold text-strong">
                    {basketGrade ? `Live Grade: ${basketGrade}` : `${scoredCount} items graded`}
                  </p>
                  <p className="text-[12px] text-muted">
                    {totalCount > scoredCount
                      ? `${scoredCount} of ${totalCount} items rated`
                      : 'All items analyzed against limits'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-3 text-center text-[12px] text-muted leading-relaxed">
              Add products to your cart to see real-time Nutri-Score grades and clinical threshold guidance.
            </div>
          )}
        </div>

        {/* Single Primary Action Button (min 44px height) */}
        <div className="pt-2">
          {hasActiveSession && !isIncomplete ? (
            <button
              id="open-dashboard-btn"
              type="button"
              onClick={onOpenDashboard}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-mint text-brand-navy px-4 min-h-[44px] text-[12px] font-bold shadow-xs hover:bg-brand-mint/90 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <BarChart3 className="w-4 h-4" aria-hidden />
              <span>Open Shopper Dashboard</span>
            </button>
          ) : (
            <button
              id="open-auth-btn"
              type="button"
              onClick={onOpenAuth}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-mint text-brand-navy px-4 min-h-[44px] text-[12px] font-bold shadow-xs hover:bg-brand-mint/90 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <LogIn className="w-4 h-4" aria-hidden />
              <span>
                {isIncomplete ? 'Complete Care Consent' : 'Sign in with Clinic Credentials'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default Popup
