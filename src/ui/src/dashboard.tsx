import * as React from "react";
import { useState, useEffect } from "react";
// @ts-ignore
window.React = React;
import { createRoot } from "react-dom/client";
import { Dashboard } from "./app/components/Dashboard";
import { OnboardingWizard, type UserProfile } from "./app/components/OnboardingWizard";
import { getSettings } from "./app/lib/db";
import { Toaster } from "sonner";
import "./styles/index.css";

function applyPersonalization(profile: UserProfile) {
  const { name, initials, condition, primaryMetric } = profile;

  // 1. Dynamic Greeting
  const hour = new Date().getHours();
  const timeStr = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const greetingEl = document.getElementById("user-greeting");
  const subtitleEl = document.getElementById("user-subtitle");
  if (greetingEl) greetingEl.textContent = `${timeStr}, ${name}`;
  if (subtitleEl) subtitleEl.textContent = `Welcome to your shopping analytics`;

  // 2. Avatar
  const avatarEl = document.getElementById("user-avatar-badge");
  if (avatarEl) avatarEl.textContent = initials;

  // 3. Positive reinforcement alert
  const alertContainer = document.getElementById("health-alerts-container");
  if (alertContainer) {
    alertContainer.replaceChildren();
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "display:flex;align-items:center;gap:12px;border-radius:8px;padding:10px 16px;" +
      "border:1px solid #6ee7b7;background:#ecfdf5;color:#064e3b;";
    wrap.innerHTML = `<span style="font-size:1.25rem;">🌟</span>`;
    
    const label = document.createElement("div");
    label.style.cssText = "font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#065f46;";
    label.textContent = "Streak Active";
    
    const body = document.createElement("div");
    body.style.cssText = "font-size:0.75rem;font-weight:500;";
    body.textContent = `0 limit breaches for ${primaryMetric} in your last cart!`;
    
    const textCol = document.createElement("div");
    textCol.append(label, body);
    wrap.appendChild(textCol);
    alertContainer.appendChild(wrap);
  }

  // 4. Metric legend sort
  const metricList = document.getElementById("nutrient-legend-list");
  if (metricList) {
    const items = Array.from(metricList.children);
    items.sort(a => (a.textContent ?? "").includes(primaryMetric) ? -1 : 1);
    items.forEach(item => metricList.appendChild(item));
  }

  // 5. Friendly empty state
  const ledgerEmptyState = document.getElementById("ledger-empty-msg");
  if (ledgerEmptyState) {
    ledgerEmptyState.replaceChildren();
    const wrap = document.createElement("div");
    wrap.style.cssText = "padding:48px 0;text-align:center;";
    wrap.innerHTML = `<div style="font-size:2.5rem;margin-bottom:8px;">🥗</div>`;
    
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

function DashboardRoot() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function initProfile() {
      try {
        const p = await getSettings();
        if (p && p.profileName && p.initials) {
          const mappedProfile = {
            name: p.profileName,
            initials: p.initials,
            condition: p.condition,
            primaryMetric: p.primaryMetric
          };
          setProfile(mappedProfile);
          document.documentElement.setAttribute('data-health-condition', p.condition);
        }
      } catch (err) {
        console.warn("Failed to load settings from DB", err);
      }
      setReady(true);
    }
    initProfile();
  }, []);

  useEffect(() => {
    if (profile) {
      applyPersonalization(profile);
    }
  }, [profile]); // Only re-run when the profile object reference changes.

  const handleOnboardingComplete = (p: UserProfile) => {
    setProfile(p);
  };

  if (!ready) return null;

  return (
    <>
      {!profile && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}
      <div className="min-h-screen overflow-auto" style={{ backgroundColor: "var(--background)" }}>
        <Dashboard onBack={() => window.close()} />
        <Toaster position="bottom-center" />
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<DashboardRoot />);

