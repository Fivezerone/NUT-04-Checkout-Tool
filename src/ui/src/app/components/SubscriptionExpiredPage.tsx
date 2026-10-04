/**
 * SubscriptionExpiredPage.tsx
 *
 * Shown to users whose 30-day premium window has elapsed.
 * Presents a clear expiry notice and a prominent renewal CTA
 * that re-opens the OnboardingWizard at the payment step.
 */

import React from 'react';
import { AlertCircle, RefreshCw, ShoppingCart } from 'lucide-react';

interface SubscriptionExpiredPageProps {
  /** Called when the user clicks "Renew" — opens the onboarding payment step. */
  onRenew?: () => void;
}

export function SubscriptionExpiredPage({ onRenew }: SubscriptionExpiredPageProps) {
  const handleRenew = () => {
    if (onRenew) {
      onRenew();
    } else if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      // Fallback: open the onboarding wizard at the payment step in a new tab.
      chrome.tabs.create({
        url: chrome.runtime.getURL('onboarding.html') + '?mode=renew',
      });
    } else {
      window.location.href = '/onboarding.html?mode=renew';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background:
          'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
      }}
    >
      <div className="w-full max-w-md rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/10">
        {/* ── Banner ─────────────────────────────────────────────────── */}
        <div
          className="px-8 pt-10 pb-8 text-center"
          style={{
            background:
              'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
          }}
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/10 ring-2 ring-white/20 mb-5">
            <AlertCircle size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            Subscription Expired
          </h1>
          <p className="mt-2 text-red-100 text-sm leading-relaxed">
            Your 30-day premium access period has ended.
            <br />
            Renew now to continue tracking your nutrition.
          </p>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div className="bg-white px-8 py-7 space-y-5">
          {/* What you lose without a subscription */}
          <ul className="space-y-2 text-sm text-slate-600">
            {[
              'Real-time NutriScore grading at checkout',
              'Personalised health alerts & smart cart analysis',
              'Full shopping analytics dashboard',
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span className="mt-0.5 text-red-400 shrink-0">✕</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <hr className="border-slate-100" />

          {/* Pricing reminder */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                30-Day Premium Access
              </p>
              <p className="text-2xl font-extrabold text-slate-900 mt-0.5">
                Ksh 189
                <span className="text-sm font-medium text-slate-400 ml-1">
                  / 30 days
                </span>
              </p>
            </div>
            <ShoppingCart size={28} className="text-slate-300" />
          </div>

          {/* CTA */}
          <button
            id="renew-subscription-btn"
            type="button"
            onClick={handleRenew}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-white font-semibold text-sm tracking-wide transition-all hover:opacity-90 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            style={{
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
            }}
          >
            <RefreshCw size={16} aria-hidden />
            Renew Premium Access
          </button>

          <p className="text-center text-xs text-slate-400">
            Secure checkout via M-Pesa or Card.
          </p>
        </div>
      </div>
    </div>
  );
}
