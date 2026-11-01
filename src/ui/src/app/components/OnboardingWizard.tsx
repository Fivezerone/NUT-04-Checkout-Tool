// src/ui/src/app/components/OnboardingWizard.tsx
// Patient Authentication & Standalone Clinical Care Consent Gate
// Reference: CAD-Only Identity & Onboarding Rollback (Phase 3)

import React, { useState, useEffect } from "react";
import { ExtensionStorage, supabase, signOutUser } from "../../services/storage";
import { DECOY_TERMS_OF_SERVICE, DECOY_PRIVACY_POLICY, type LegalDoc } from "../legal/decoyLegalDocs";
import { ConsentDocModal } from "./ConsentDocModal";
import { ShieldCheck, Lock, UserCheck, AlertCircle, ArrowRight, CheckCircle2, LogOut } from "lucide-react";

export interface UserProfile {
  name: string;
  initials: string;
  condition: string;
  primaryMetric: string;
  isFirstTime?: boolean;
}

export type WizardMode = "signin" | "login" | "renew" | "signup";

interface Props {
  onComplete?: (profile?: UserProfile) => void;
  initialMode?: WizardMode;
}

async function computeHash(input: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "hash_unavailable";
  }
}

export function OnboardingWizard({ onComplete }: Readonly<Props>) {
  type WizardStep = "loading" | "signin" | "password_change" | "consent" | "completed";

  const [step, setStep] = useState<WizardStep>("loading");
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Sign-in state (Clinic credentials)
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  // Force password change state
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");

  // Consent gate state
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);
  const [privacyAccepted, setPrivacyAccepted] = useState<boolean>(false);
  const [notificationFrequency, setNotificationFrequency] = useState<"realtime" | "daily" | "weekly" | "off">("realtime");
  const [activeDoc, setActiveDoc] = useState<LegalDoc | null>(null);
  const [isDocModalOpen, setIsDocModalOpen] = useState<boolean>(false);
  const [consentDismissed, setConsentDismissed] = useState<boolean>(false);

  useEffect(() => {
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !session.user) {
        setStep("signin");
        return;
      }

      setCurrentUser(session.user);

      // Check if user has force_password_change requirement
      if (session.user.user_metadata?.force_password_change || session.user.app_metadata?.force_password_change) {
        setStep("password_change");
        return;
      }

      // Check if consent has already been granted in Supabase
      const { data: consentRecord, error: consentErr } = await supabase
        .from("consents")
        .select("id")
        .eq("patient_id", session.user.id)
        .eq("consent_version", "2.0")
        .maybeSingle();

      if (!consentErr && consentRecord?.id) {
        // Already consented!
        finishFlow(session.user);
      } else {
        setStep("consent");
      }
    } catch {
      setStep("signin");
    }
  };

  const finishFlow = (user: any) => {
    const fullName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Patient";
    const profile: UserProfile = {
      name: fullName,
      initials: fullName.slice(0, 2).toUpperCase(),
      condition: "Clinical Care Mode",
      primaryMetric: "Target Nutrients",
      isFirstTime: false,
    };

    if (onComplete) {
      onComplete(profile);
    } else if (typeof window !== "undefined") {
      window.location.href = "dashboard.html";
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        // Generic error message to prevent account enumeration
        setErrorMessage("Invalid clinic credentials. If you are a new patient, please contact your care team.");
        setIsSubmitting(false);
        return;
      }

      setCurrentUser(data.user);

      if (data.user.user_metadata?.force_password_change || data.user.app_metadata?.force_password_change) {
        setStep("password_change");
      } else {
        // Check consent
        const { data: consent } = await supabase
          .from("consents")
          .select("id")
          .eq("patient_id", data.user.id)
          .eq("consent_version", "2.0")
          .maybeSingle();

        if (consent?.id) {
          finishFlow(data.user);
        } else {
          setStep("consent");
        }
      }
    } catch {
      setErrorMessage("Unable to connect to clinic service. Please verify your internet connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (newPassword.length < 8) {
      setErrorMessage("New password must be at least 8 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        data: { force_password_change: false },
      });

      if (error) {
        setErrorMessage(error.message || "Failed to update password. Please try again.");
        setIsSubmitting(false);
        return;
      }

      setStep("consent");
    } catch {
      setErrorMessage("Failed to update password. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAcceptConsent = async () => {
    if (!termsAccepted || !privacyAccepted) {
      setErrorMessage("You must accept both the Terms of Service and Privacy Notice to continue.");
      return;
    }

    if (!currentUser) return;

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "Chrome-MV3";
      const ipHash = await computeHash(`${userAgent}|${currentUser.id}|${Date.now()}`);
      const tenantId = currentUser.app_metadata?.tenant_id || "00000000-0000-0000-0000-000000000000";

      // 1. Store consent in Supabase
      const { error: consentErr } = await supabase.from("consents").upsert(
        {
          patient_id: currentUser.id,
          tenant_id: tenantId,
          consent_version: "2.0",
          accepted_at: new Date().toISOString(),
          user_agent: userAgent,
          ip_hash: ipHash,
        },
        { onConflict: "patient_id,consent_version" }
      );

      if (consentErr) {
        console.warn("[OnboardingWizard] Failed to store consent in Supabase:", consentErr.message);
      }

      // 2. Mark onboarding completed in users table
      await supabase
        .from("users")
        .update({
          onboarding_completed: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", currentUser.id);

      // 3. Update Extension Storage
      await ExtensionStorage.setOnboardingComplete(currentUser.id, {
        user_account: {
          fullName: currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "Patient",
          email: currentUser.email || "",
        },
        user_preferences: {
          healthMode: true,
          notificationFrequency,
          selectedTags: ["prescribed_care"],
          termsAccepted: true,
          privacyAccepted: true,
          consentTimestamp: new Date().toISOString(),
        },
        user_payment: {
          method: "Clinic Care Protocol",
          paymentRef: "CLINIC-ENROLLED",
          amount: 0,
        },
      });

      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({
          onboarding_completed: true,
          patient_consent_accepted: true,
        });
      }

      setStep("completed");
      setTimeout(() => {
        finishFlow(currentUser);
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to save consent. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    setCurrentUser(null);
    setStep("signin");
    setErrorMessage("");
    setConsentDismissed(false);
  };

  // Loading state
  if (step === "loading") {
    return (
      <div className="min-h-screen bg-[color:var(--color-canvas)] flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[color:var(--color-brand)] border-t-transparent" />
          <p className="text-sm text-[color:var(--color-text-muted)] font-medium">Checking care enrollment...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-canvas)] flex items-center justify-center p-4 font-sans text-[color:var(--color-text)]">
      <div className="ui-card w-full max-w-md overflow-hidden rounded-[var(--ui-radius-xl)]">
        {/* Brand Header */}
        <div className="bg-[color:var(--color-brand)] p-6 text-[color:var(--color-on-brand)] text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-white/20 rounded-xl mb-3 shadow-sm">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">NutriScore Clinical Care</h1>
          <p className="text-sm text-white/80 mt-1">Clinician-monitored nutritional guidance</p>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="ui-status-critical m-5 mb-0 rounded-xl flex items-start gap-2.5 p-4 text-sm">
            <AlertCircle className="shrink-0 mt-0.5" size={17} />
            <span className="leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* ── STEP 1: CLINIC SIGN-IN ────────────────────────────────────────── */}
        {step === "signin" && (
          <div className="p-6 space-y-5">
            <div>
              <h2 className="text-lg font-bold text-[color:var(--color-text-strong)]">Sign in with clinic credentials</h2>
              <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
                Enter your registered email and the temporary password provided by your clinician.
              </p>
            </div>

            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="ui-field-label">Patient email address</label>
                <input
                  type="email"
                  required
                  placeholder="patient@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="ui-input mt-1"
                />
              </div>

              <div>
                <label className="ui-field-label">Temporary password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="ui-input mt-1"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="ui-button ui-button-primary min-h-11 w-full"
              >
                <span>{isSubmitting ? "Signing In..." : "Sign In & Continue"}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>

            <div className="pt-2 border-t border-[color:var(--color-border-subtle)] text-center">
              <p className="text-xs text-[color:var(--color-text-muted)]">
                Accounts are provisioned by licensed healthcare providers. Public registration is not supported.
              </p>
            </div>
          </div>
        )}

        {/* ── STEP 2: FORCED PASSWORD CHANGE ────────────────────────────────── */}
        {step === "password_change" && (
          <div className="p-6 space-y-5">
            <div>
              <div className="flex items-center space-x-2">
                <Lock className="text-[color:var(--color-brand)]" size={17} />
                <h2 className="text-lg font-bold text-[color:var(--color-text-strong)]">Set a new password</h2>
              </div>
              <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
                For security, please replace your clinic-issued temporary password with a private one.
              </p>
            </div>

            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label className="ui-field-label">New password (minimum 8 characters)</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="ui-input mt-1"
                />
              </div>

              <div>
                <label className="ui-field-label">Confirm new password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="ui-input mt-1"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="ui-button ui-button-primary min-h-11 w-full"
              >
                {isSubmitting ? "Updating Password..." : "Update Password & Proceed"}
              </button>
            </form>
          </div>
        )}

        {/* ── STEP 3: STANDALONE CONSENT GATE ───────────────────────────────── */}
        {step === "consent" && (
          <div className="p-6 space-y-5">
            <div>
              <h2 className="text-lg font-bold text-[color:var(--color-text-strong)]">Clinical care agreement and privacy consent</h2>
              <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
                Your clinician has enrolled you in nutritional monitoring. Please review and accept before activating your extension.
              </p>
            </div>

            {/* Informational Points */}
            <div className="space-y-2 rounded-xl border border-[color:var(--color-info-border)] bg-[color:var(--color-info-subtle)] p-4 text-sm text-[color:var(--color-info-text)]">
              <div className="flex items-start space-x-2">
                <CheckCircle2 className="shrink-0 mt-0.5" size={17} />
                <span>
                  <strong>Clinical Thresholds:</strong> Dietary alerts are calibrated by your doctor, not arbitrary consumer targets.
                </span>
              </div>
              <div className="flex items-start space-x-2">
                <CheckCircle2 className="shrink-0 mt-0.5" size={17} />
                <span>
                  <strong>Privacy Safeguards:</strong> Monitored shopping events are encrypted and protected under the Kenya Data Protection Act 2019.
                </span>
              </div>
            </div>

            {/* Preference: Notification Frequency */}
            <div className="space-y-1.5">
              <label className="ui-field-label">Notification alerts</label>
              <select
                value={notificationFrequency}
                onChange={(e) => setNotificationFrequency(e.target.value as any)}
                className="ui-select mt-1"
              >
                <option value="realtime">Real-time alerts at checkout (Recommended)</option>
                <option value="daily">Daily summary</option>
                <option value="weekly">Weekly overview</option>
                <option value="off">Muted (Browse dashboard only)</option>
              </select>
            </div>

            {/* Consent Checkboxes */}
            <div className="space-y-3 pt-2">
              <label className="flex items-start space-x-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[color:var(--color-border)] accent-[color:var(--color-brand)]"
                />
                <span className="text-sm text-[color:var(--color-text)] leading-snug">
                  I agree to the{" "}
                  <button
                    type="button"
                    id="view-terms-link"
                    onClick={() => {
                      setActiveDoc(DECOY_TERMS_OF_SERVICE);
                      setIsDocModalOpen(true);
                    }}
                    className="font-semibold text-[color:var(--color-brand-hover)] hover:underline"
                  >
                    Clinical Care Terms of Service
                  </button>
                  .
                </span>
              </label>

              <label className="flex items-start space-x-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[color:var(--color-border)] accent-[color:var(--color-brand)]"
                />
                <span className="text-sm text-[color:var(--color-text)] leading-snug">
                  I consent to the processing of my nutritional data under the{" "}
                  <button
                    type="button"
                    id="view-privacy-link"
                    onClick={() => {
                      setActiveDoc(DECOY_PRIVACY_POLICY);
                      setIsDocModalOpen(true);
                    }}
                    className="font-semibold text-[color:var(--color-brand-hover)] hover:underline"
                  >
                    Health Data Privacy Notice
                  </button>
                  .
                </span>
              </label>
            </div>

            {consentDismissed && (
              <div className="ui-status-warning block rounded-lg p-3 text-sm">
                Consent is required before product scoring or nutrition features can be enabled. Your account remains signed in, but extension features remain inactive.
              </div>
            )}

            <div className="flex flex-col space-y-2 pt-2">
              <button
                type="button"
                onClick={handleAcceptConsent}
                disabled={!termsAccepted || !privacyAccepted || isSubmitting}
                className="ui-button ui-button-primary min-h-11 w-full"
              >
                {isSubmitting ? "Activating Care Profile..." : "Accept & Activate Extension"}
              </button>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setConsentDismissed(true)}
                  className="text-sm font-medium text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-strong)]"
                >
                  Dismiss for now
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex items-center gap-1 text-sm font-semibold text-[color:var(--color-critical)] hover:text-[color:var(--color-critical-hover)]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 4: COMPLETED ─────────────────────────────────────────────── */}
        {step === "completed" && (
          <div className="p-8 text-center space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--color-success-subtle)] text-[color:var(--color-success)] mx-auto">
              <CheckCircle2 size={28} />
            </div>
            <h2 className="text-lg font-bold text-[color:var(--color-text-strong)]">Clinical care activated</h2>
            <p className="text-sm text-[color:var(--color-text-muted)]">
              Your care profile and clinician dietary targets are loaded. Redirecting to your Shopper Dashboard...
            </p>
          </div>
        )}
      </div>

      {/* Decoy Legal Doc Modal */}
      <ConsentDocModal
        isOpen={isDocModalOpen}
        doc={activeDoc}
        onClose={() => setIsDocModalOpen(false)}
        onAccept={() => {
          if (activeDoc?.title.includes("Terms")) {
            setTermsAccepted(true);
          } else {
            setPrivacyAccepted(true);
          }
        }}
      />
    </div>
  );
}
