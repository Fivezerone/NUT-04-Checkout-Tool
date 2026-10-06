import React, { useState, useEffect } from "react";

declare global {
  interface Window {
    PaystackPop: any;
  }
  var chrome: any;
}
import { useTheme } from "../context/ThemeContext";
import { ExtensionStorage, supabase, savePremiumStatus, signOutUser } from "../../services/storage";
import { usePaymentState } from "../hooks/usePaymentState";
import { isSubscriptionExpired } from "../lib/subscriptionUtils";
import { HEALTH_MODES } from "../../../../shared/health-modes.mjs";
import { persistOnboarding } from "../lib/persistOnboarding";
/** Canonical user profile shape used by the dashboard greeting and settings. */
export interface UserProfile {
  name: string;
  initials: string;
  condition: string;
  primaryMetric: string;
  isFirstTime?: boolean;
}

/**
 * Controls the initial view shown by the wizard:
 *   - 'signup'  (default) — full multi-step registration
 *   - 'login'             — email/password sign-in for existing accounts
 *   - 'renew'             — jumps directly to the payment step (subscription renewal)
 */
export type WizardMode = 'signup' | 'login' | 'renew';

interface Props {
  onComplete?: (profile?: UserProfile) => void;
  /** Starting mode. Defaults to 'signup'. Can be driven by the URL ?mode= param. */
  initialMode?: WizardMode;
}

export function OnboardingWizard({ onComplete, initialMode = 'signup' }: Readonly<Props>) {
  const { setTheme } = useTheme();
  const [step, setStep] = useState(1);

  // ── Mode: 'signup' | 'login' | 'renew' ──────────────────────────────────
  // 'renew' is treated identically to 'signup' but starts on step 4 (payment).
  const [wizardMode, setWizardMode] = useState<WizardMode>(initialMode);
  
  // Inline error display — replaces all alert() calls
  const [errorMessage, setErrorMessage] = useState("");
  // Prevents double-submit during async sign-up / payment flows
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setError = (msg: string) => {
    setErrorMessage(msg);
    setIsSubmitting(false);
  };
  const clearError = () => setErrorMessage("");

  // ── Login-mode state ────────────────────────────────────────────────────
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Step 1 State
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  
  // Step 2 State
  const [condition, setCondition] = useState("");
  const [metric, setMetric] = useState("");
  
  // Step 3 State
  const [notificationFrequency, setNotificationFrequency] = useState<"realtime" | "daily" | "weekly" | "off">("realtime");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  // Step 4 State (Tier)
  const [tier, setTier] = useState<"basic" | "premium">("premium");

  // Step 5 State (Payment)
  const [paymentMethod, setPaymentMethod] = useState<"Mobile Money" | "Bank Transfer">("Mobile Money");
  const [mpesaPhone, setMpesaPhone] = useState("");
  const packagePrice = 189.00;

  const [activePaymentRef, setActivePaymentRef] = useState<string | null>(null);
  const [activePaymentMethod, setActivePaymentMethod] = useState<'mpesa' | 'paystack' | null>(null);
  // D-10: separate error for profile-save failures after payment so we can offer a retry
  const [finishError, setFinishError] = useState<string | null>(null);

  const { status: paymentStatus, setStatus: setPaymentStatus } = usePaymentState({
    transactionRef: activePaymentRef,
    method: activePaymentMethod,
    onSuccess: async (ref, method, token) => {
      if (!token) {
        setError('Payment confirmed but entitlement is still syncing. Please wait a moment then try again.');
        return;
      }
      await savePremiumStatus(token);
      finishOnboarding(ref, method === 'mpesa' ? "Mobile Money" : "Card", token);
    },
    onError: async (msg) => {
      setError(msg);
      await ExtensionStorage.setActivePayment(null, null);
      setActivePaymentRef(null);
      setActivePaymentMethod(null);
    }
  });

  // ── Shared post-login router ─────────────────────────────────────────────
  /**
   * Called after ANY successful login (email/password or OAuth).
   * Checks subscription status BEFORE routing. Critical rules:
   *
   *   • Expired users  → onboarding.html?mode=renew  (payment modal)
   *     Session is KEPT ALIVE so Step 4 (payment) has a valid auth token.
   *     Signing out here would break the payment flow — do NOT add signOut.
   *
   *   • Active users   → dashboard.html
   *   • Not onboarded  → wizard step 2 (continue sign-up then pay)
   */
  const redirectAfterLogin = async (userId: string) => {
    // Check the local hint first — fast path, avoids DB round-trip for fresh sign-ups
    const local = await chrome.storage.local.get('onboarding_completed');

    if (!local.onboarding_completed) {
      // New user (never completed payment) — continue the wizard from step 3
      clearError();
      setIsSubmitting(false);
      setStep(3);
      setWizardMode('signup');
      return;
    }

    // Returning user — verify subscription status in Supabase before granting access
    try {
      const { data: row, error: dbError } = await supabase
        .from('users')
        .select('payment_received_at, subscription_status, onboarding_completed, trial_started_at')
        .eq('id', userId)
        .single();

      if (dbError && dbError.code !== 'PGRST116') {
        setError('Could not verify subscription status. Please try again.');
        setIsSubmitting(false);
        return;
      }

      const r = row as any;

      // Cross-check DB onboarding status (in case local hint is stale)
      if (!r?.onboarding_completed) {
        clearError();
        setIsSubmitting(false);
        setStep(3);
        setWizardMode('signup');
        return;
      }

      const paymentReceivedAt = r?.payment_received_at ?? null;
      const trialStartedAt    = r?.trial_started_at    ?? null;
      const dbStatus         = r?.subscription_status  ?? null;

      const expired =
        isSubscriptionExpired(paymentReceivedAt, trialStartedAt) || dbStatus === 'expired';

      if (expired) {
        // D-08: subscription_status only — is_premium is a billing column
        if (dbStatus !== 'expired') {
          await supabase
            .from('users')
            .update({ subscription_status: 'expired' })
            .eq('id', userId);
        }
        // D-04/D-08: use savePremiumStatus(false) which clears nutri_entitlement (the key SW reads)
        await savePremiumStatus(false);

        // Keep the session alive so they can process payment on the next step.
        // Redirect to the payment wizard.
        window.location.href = chrome.runtime.getURL('onboarding.html') + '?mode=renew';
        return;
      }
    } catch (err: any) {
      console.error('[redirectAfterLogin] DB check failed:', err);
      setError('System Error: ' + (err?.message || 'Unable to load profile data. Ensure your database is updated.'));
      setIsSubmitting(false);
      return;
    }

    // Active subscription — open the dashboard
    window.location.href = chrome.runtime.getURL('dashboard.html');
  };

  // ── Login handler (email / password) ────────────────────────────────────
  const handleLogin = async () => {
    clearError();
    const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
    if (!loginEmail.trim() || !emailRegex.test(loginEmail.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!loginPassword) {
      setError("Please enter your password.");
      return;
    }

    setIsSubmitting(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });

    if (error) {
      setError("Sign in failed: " + error.message);
      return; // setIsSubmitting(false) is handled by setError()
    }

    // Populate wizard fields so downstream payment steps have the right data
    if (data?.user?.email) setEmail(data.user.email);
    if (data?.user?.user_metadata?.full_name) setFullName(data.user.user_metadata.full_name);

    // Route based on onboarding + subscription status
    await redirectAfterLogin(data.user!.id);
  };

  // Removed inline Paystack script loading since we use Edge Functions with Secure Tabs
  useEffect(() => {
    const rehydrate = async () => {
      const partial = await ExtensionStorage.getPartialOnboardingData();
      if (partial.fullName) setFullName(partial.fullName);
      if (partial.email) setEmail(partial.email);
      if (partial.dob) setDob(partial.dob);
      if (partial.gender) setGender(partial.gender);
      if (partial.condition) setCondition(partial.condition);
      if (partial.metric) setMetric(partial.metric);
      if (partial.notificationFrequency) setNotificationFrequency(partial.notificationFrequency);
      if (partial.termsAccepted !== undefined) setTermsAccepted(partial.termsAccepted);
      if (partial.privacyAccepted !== undefined) setPrivacyAccepted(partial.privacyAccepted);
      if (partial.mpesaPhone) setMpesaPhone(partial.mpesaPhone);
    };

    const processSession = async (session: any) => {
      if (!session) {
        // They have no session, so they need to authenticate.
        return;
      }
      clearError();
      if (initialMode === 'login') {
        await redirectAfterLogin(session.user.id);
        return;
      }
      // D-09: recover any in-flight payment FIRST, in every mode (including renew).
      // Without this, a renewing user who already approved an M-Pesa prompt would
      // never see their payment confirmed and could be double-charged.
      const pendingPayment = await ExtensionStorage.getActivePayment();
      if (pendingPayment.ref && pendingPayment.method) {
        setActivePaymentRef(pendingPayment.ref);
        setActivePaymentMethod(pendingPayment.method);
        setPaymentMethod(pendingPayment.method === 'mpesa' ? "Mobile Money" : "Bank Transfer");
        setStep(5);
      } else if (initialMode === 'renew') {
        // D-09: no in-flight payment; go to payment step without touching form state / profile
        setStep(5);
        setWizardMode('signup');
        return;
      } else {
        // Only advance to step 3 if the user is still at an earlier step.
        // Never regress a user who has already progressed beyond step 3
        // (e.g. they are on step 5 recovering a crashed payment session).
        setStep(prev => (prev < 3 ? 3 : prev));
      }
    };

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      await rehydrate();
      await processSession(session);
    });
  }, []);

  // Persist partial state whenever it changes
  useEffect(() => {
    ExtensionStorage.setPartialOnboardingData({
      fullName,
      email,
      dob,
      gender,
      condition,
      metric,
      notificationFrequency,
      termsAccepted,
      privacyAccepted,
      mpesaPhone
    });
  }, [fullName, email, dob, gender, condition, metric, notificationFrequency, termsAccepted, privacyAccepted, mpesaPhone]);

  const handleStep1Next = async () => {
    if (!fullName.trim() || !email.trim() || !password) {
      setError("Please fill out all required fields.");
      return;
    }
    const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
    if (!emailRegex.test(email.trim())) {
      setError("Please enter a valid email address (e.g. john@example.com).");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    
    setIsSubmitting(true);
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), dob, gender } }
    });

    if (error) {
      setIsSubmitting(false);
      setError("Sign up failed: " + error.message);
      return;
    }

    // D-28: no session = email confirmation required (or email already registered).
    // Do NOT use setError() for this — it's not an error, and the red banner is misleading.
    if (!signUpData?.session) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setIsSubmitting(false);
        // D-28: neutral, non-alarming message that covers both cases:
        // (a) new account — confirmation email sent, (b) email already registered
        setError(
          "If this is a new address, we've sent a confirmation link — check your email then sign in. " +
          "If you already have an account, use the Log in option instead."
        );
        return;
      }
    }

    setIsSubmitting(false);
    setStep(step + 1);
  };

  const handleStep2Next = () => {
    if (!condition) {
      setError("Please select a primary health focus.");
      return;
    }
    setStep(step + 1);
  };

  const handleStep3Next = () => {
    if (!termsAccepted || !privacyAccepted) {
      setError("Please accept both the Terms of Service and Privacy Policy.");
      return;
    }
    setStep(step + 1);
  };

  const handleStep4Next = async () => {
    if (tier === "basic") {
      setIsSubmitting(true);
      await savePremiumStatus(false); // Make sure basic saves false
      await finishOnboarding('free_tier', 'none', '');
      setIsSubmitting(false);
    } else {
      setStep(step + 1);
    }
  };

  const handleNext = async () => {
    clearError();
    if (step === 1) await handleStep1Next();
    else if (step === 2) handleStep2Next();
    else if (step === 3) handleStep3Next();
    else if (step === 4) await handleStep4Next();
  };

  const handleBack = () => {
    if (step > 1) {
      clearError();
      setStep(step - 1);
    }
  };

  const handleSelectCondition = (conditionKey: string, metricKey: string) => {
    clearError();
    setCondition(conditionKey);
    setMetric(metricKey);
    setTheme(conditionKey as any);
  };

  const finishOnboarding = async (paymentRef: string, method: string, token?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id;

    await persistOnboarding({
      paymentRef, method, token, userId, user, fullName, email, dob, gender,
      condition, metric, notificationFrequency, termsAccepted, privacyAccepted,
      initialMode, setFinishError
    });

    // CRITICAL FIX: Clear the pending payment trap. If we don't do this, any
    // future visit to onboarding.html will forcibly jump to Step 4 and loop.
    await ExtensionStorage.setActivePayment(null, null);
    setActivePaymentRef(null);
    setActivePaymentMethod(null);

    if (onComplete) onComplete();
    window.location.href = chrome.runtime.getURL('dashboard.html');
  };

  const handleMpesaPayment = async () => {
    clearError();
    if (!mpesaPhone.trim()) {
      setError("Please enter your M-Pesa phone number.");
      return;
    }
    // Basic Safaricom number format: 2547XXXXXXXX or 07XXXXXXXX
    const phoneRegex = /^(254|0)7\d{8}$|^(254|0)1\d{8}$/;
    const rawPhone = mpesaPhone.trim().replace(/\s/g, '');
    if (!phoneRegex.test(rawPhone)) {
      setError("Enter a valid Safaricom number (e.g. 254712345678 or 0712345678).");
      return;
    }
    // Normalize to 254XXXXXXXXX format (Daraja rejects 07XXXXXXXXX)
    const normalizedPhone = rawPhone.startsWith('0') ? `254${rawPhone.slice(1)}` : rawPhone;

    setPaymentStatus("processing");
    
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken || !user || userError) {
        setError("You must be signed in to complete payment. Please go back and sign in.");
        setPaymentStatus("idle");
        return;
      }

      const { data, error } = await supabase.functions.invoke('mpesa-initiate', {
        body: { phone: normalizedPhone, amount: packagePrice },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      const checkoutRequestId = data.CheckoutRequestID;
      if (!checkoutRequestId) throw new Error("Invalid response from M-Pesa gateway.");
      
      // The usePaymentState hook takes over verification automatically
      await ExtensionStorage.setActivePayment(checkoutRequestId, 'mpesa');
      setActivePaymentRef(checkoutRequestId);
      setActivePaymentMethod('mpesa');
        
    } catch (error: any) {
      console.error(error);
      setPaymentStatus("error");
      setError(error.message || "Failed to initiate M-Pesa STK Push. Please try again.");
    }
  };

  const handlePaystackPayment = async () => {
    setPaymentStatus("processing");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken || !user || userError) {
        setError("You must be signed in to complete payment. Please go back and sign in.");
        setPaymentStatus("idle");
        return;
      }

      const { data, error } = await supabase.functions.invoke('paystack-initiate', {
        // D-09: always use the verified auth session email, never the form-state fallback
        body: { email: user?.email || email.trim(), amount: packagePrice },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      const authUrl = data.authorization_url;
      const reference = data.reference;
      
      // Use chrome.tabs.create() — window.open() is silently blocked
      // in Chrome extension popup context (Manifest V3 restriction).
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.create({ url: authUrl });
      } else {
        window.open(authUrl, '_blank');
      }
      
      // The usePaymentState hook takes over verification automatically
      await ExtensionStorage.setActivePayment(reference, 'paystack');
      setActivePaymentRef(reference);
      setActivePaymentMethod('paystack');

    } catch (error: any) {
      console.error(error);
      setPaymentStatus("error");
      setError(error.message || "Failed to initiate Paystack payment. Please try again.");
    }
  };

  const handlePayment = () => {
    clearError();
    if (!termsAccepted || !privacyAccepted) {
      setError("Please accept both the Terms of Service and Privacy Policy.");
      return;
    }

    if (paymentMethod === "Mobile Money") {
      handleMpesaPayment();
    } else {
      handlePaystackPayment();
    }
  };

  // ── Login-mode panel ─────────────────────────────────────────────────────
  if (wizardMode === 'login') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-[420px] flex flex-col rounded-2xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden">
          {/* Header */}
          <div className="flex-1 p-6">
            <h2 className="text-xl font-bold text-slate-800">Welcome back!</h2>
            <p className="text-xs text-slate-500 mt-1 mb-5">Sign in to access your dashboard.</p>

            <div className="space-y-3">
              <div>
                <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 uppercase mb-1">Email</label>
                <input
                  type="email"
                  id="login-email"
                  placeholder="e.g. john@example.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700 uppercase mb-1">Password</label>
                <input
                  type="password"
                  id="login-password"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
            </div>

            {/* Inline error */}
            {errorMessage && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
                <svg className="mt-0.5 shrink-0 text-red-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p className="text-xs text-red-700 leading-snug">{errorMessage}</p>
              </div>
            )}

            <div className="relative flex py-4 items-center">
              <div className="flex-grow border-t border-slate-200"></div>
              <span className="flex-shrink-0 mx-4 text-slate-400 text-xs">or</span>
              <div className="flex-grow border-t border-slate-200"></div>
            </div>

            {/* Google OAuth */}
            <button
              type="button"
              id="login-google-btn"
              disabled={isSubmitting}
              className="w-full flex justify-center items-center gap-2 rounded-lg border border-slate-300 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={async () => {
                clearError();
                setIsSubmitting(true);
                try {
                  const redirectTo = chrome.identity.getRedirectURL();
                  const { data, error: oauthUrlError } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: { 
                      redirectTo, 
                      skipBrowserRedirect: true,
                      queryParams: { prompt: 'select_account' }
                    },
                  });
                  if (oauthUrlError || !data?.url) throw new Error(oauthUrlError?.message || 'Could not build OAuth URL.');
                  const responseUrl = await chrome.identity.launchWebAuthFlow({
                    url: data.url,
                    interactive: true,
                  });
                  if (!responseUrl) throw new Error('OAuth flow was cancelled.');
                  
                  const url = new URL(responseUrl);
                  const hashParams = new URLSearchParams(url.hash.substring(1));
                  const access_token = hashParams.get("access_token");
                  const refresh_token = hashParams.get("refresh_token");
                  
                  if (!access_token || !refresh_token) {
                    throw new Error('OAuth provider error or missing tokens in redirect.');
                  }

                  const { error: sessionError } = await supabase.auth.setSession({
                    access_token,
                    refresh_token,
                  });
                  if (sessionError) throw new Error('Failed to set session: ' + sessionError.message);
                  const { data: { user } } = await supabase.auth.getUser();
                  // Populate wizard fields for any downstream steps
                  if (user?.email) setEmail(user.email);
                  if (user?.user_metadata?.full_name) setFullName(user.user_metadata.full_name);
                  // Route via the shared helper — checks subscription before admitting to dashboard
                  if (user?.id) await redirectAfterLogin(user.id);
                  clearError();
                } catch (err: any) {
                  setError(err.message || 'Google sign-in failed. Please try again.');
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              {isSubmitting ? (
                <svg className="animate-spin h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              {isSubmitting ? 'Signing in...' : 'Continue with Google'}
            </button>
          </div>

          {/* Footer */}
          <div className="bg-slate-50 p-4 border-t border-slate-100 flex items-center justify-between rounded-b-2xl">
            <button
              type="button"
              onClick={async () => { 
                await signOutUser(); 
                clearError(); 
                setStep(1); 
                setWizardMode('signup'); 
              }}
              className="text-xs text-slate-500 hover:text-slate-700 transition"
            >
              ← Create new account
            </button>
            <button
              id="login-submit-btn"
              type="button"
              onClick={handleLogin}
              disabled={isSubmitting}
              className={`px-6 py-2 text-sm font-semibold rounded-lg transition ${
                isSubmitting ? 'bg-blue-400 text-white cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isSubmitting ? 'Signing in…' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Signup / Renew wizard ────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[420px] flex flex-col rounded-2xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden max-h-[90vh]">
        
        {/* Constant Header/Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="wizard-step">
              <h2 className="text-xl font-bold text-slate-800">Welcome!</h2>
              <p className="text-xs text-slate-500 mt-1 mb-4">
                Let's set up your account.{' '}
                <button
                  type="button"
                  id="switch-to-login-btn"
                  onClick={() => { clearError(); setWizardMode('login'); }}
                  className="text-blue-600 font-semibold hover:underline"
                >
                  Already have an account? Sign in
                </button>
              </p>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="col-span-2">
                  <label htmlFor="signup-fullname" className="block text-xs font-semibold text-slate-700 uppercase mb-1">Full Name</label>
                  <input 
                    id="signup-fullname"
                    type="text" 
                    placeholder="e.g. John Doe" 
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-600" 
                  />
                </div>

                <div className="col-span-2">
                  <label htmlFor="signup-email" className="block text-xs font-semibold text-slate-700 uppercase mb-1">Email</label>
                  <input 
                    id="signup-email"
                    type="email" 
                    placeholder="e.g. john@example.com" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-600" 
                  />
                </div>

                <div>
                  <label htmlFor="signup-password" className="block text-xs font-semibold text-slate-700 uppercase mb-1">Password</label>
                  <input 
                    id="signup-password"
                    type="password" 
                    placeholder="••••••••" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-600" 
                  />
                </div>

                <div>
                  <label htmlFor="signup-confirm" className="block text-xs font-semibold text-slate-700 uppercase mb-1">Confirm Password</label>
                  <input 
                    id="signup-confirm"
                    type="password" 
                    placeholder="••••••••" 
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-600" 
                  />
                </div>

                <div>
                  <label htmlFor="signup-dob" className="block text-xs font-semibold text-slate-700 uppercase mb-1">Date of Birth</label>
                  <input 
                    id="signup-dob"
                    type="date" 
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-600" 
                  />
                </div>

                <div>
                  <label htmlFor="signup-gender" className="block text-xs font-semibold text-slate-700 uppercase mb-1">Gender</label>
                  <select 
                    id="signup-gender"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-600"
                  >
                    <option value="" disabled>Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="non-binary">Non-binary</option>
                    <option value="prefer-not">Prefer not to say</option>
                  </select>
                </div>
              </div>

              <div className="relative flex py-3 items-center mt-2 mb-2">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink-0 mx-4 text-slate-400 text-xs">or</span>
                <div className="flex-grow border-t border-slate-200"></div>
              </div>

              <button 
                type="button"
                disabled={isSubmitting}
                className="w-full flex justify-center items-center gap-2 rounded-lg border border-slate-300 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={async () => {
                  clearError();
                  setIsSubmitting(true);
                  try {
                    // Step 1: Ask Supabase for the OAuth URL without opening a tab.
                    // 'skipBrowserRedirect: true' gives us the URL to pass to the
                    // background script without navigating the popup away.
                    const redirectTo = chrome.identity.getRedirectURL();

                    // DEBUG: Log to background SW console (chrome://extensions → SW → Inspect)
                    // so you can copy the exact redirect URL and add it to Supabase's allowlist.
                    console.log("[NutriScore OAuth] redirectTo:", redirectTo);

                    const { data, error: oauthUrlError } = await supabase.auth.signInWithOAuth({
                      provider: 'google',
                      options: {
                        redirectTo,
                        skipBrowserRedirect: true,
                        queryParams: { prompt: 'select_account' }
                      },
                    });

                    if (oauthUrlError || !data?.url) {
                      throw new Error(oauthUrlError?.message || "Could not build OAuth URL.");
                    }

                    console.log("[NutriScore OAuth] authUrl built:", data.url);

                    const responseUrl = await chrome.identity.launchWebAuthFlow({
                      url: data.url,
                      interactive: true,
                    });
                    
                    if (!responseUrl) throw new Error('OAuth flow was cancelled.');
                    
                    const url = new URL(responseUrl);
                    const hashParams = new URLSearchParams(url.hash.substring(1));
                    const access_token = hashParams.get("access_token");
                    const refresh_token = hashParams.get("refresh_token");
                    
                    if (!access_token || !refresh_token) {
                      throw new Error('OAuth provider error or missing tokens in redirect.');
                    }

                    const { error: sessionError } = await supabase.auth.setSession({
                      access_token,
                      refresh_token,
                    });

                    if (sessionError) {
                      throw new Error("Failed to set session: " + sessionError.message);
                    }

                    // Step 4: Populate the email field from the authenticated user
                    // so downstream payment steps have the correct address.
                    const { data: { user } } = await supabase.auth.getUser();
                    if (user?.email) setEmail(user.email);
                    if (user?.user_metadata?.full_name) setFullName(user.user_metadata.full_name);

                    // Advance to step 2 (Health Focus).
                    clearError();
                    setStep(2);

                  } catch (err: any) {
                    setError(err.message || "Google sign-in failed. Please try again.");
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
              >
                {isSubmitting ? (
                  <svg className="animate-spin h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                )}
                {isSubmitting ? "Signing in..." : "Sign up with Google"}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-step">
              <h2 className="text-xl font-bold text-slate-800">What is your primary health focus?</h2>
              <p className="text-xs text-slate-500 mt-1 mb-4">We'll prioritize metrics and alerts relevant to you.</p>
              
              <div className="space-y-3">
                {[
                  { key: 'diabetes', metric: 'Sugar', desc: 'Tracks sugar limits & glycaemic markers' },
                  { key: 'hypertension', metric: 'Sodium', desc: 'Monitors salt and potassium thresholds' },
                  { key: 'kidney', metric: 'Sodium/Potassium', desc: 'Monitors sodium and potassium levels' },
                  { key: 'obesity', metric: 'Energy', desc: 'Tracks calorie density, sugars and saturated fats' },
                  { key: 'general', metric: 'Saturated Fat', desc: 'Balanced nutritional score focus' },
                ].map((item) => (
                  <button 
                    key={item.key}
                    type="button" 
                    onClick={() => handleSelectCondition(item.key, item.metric)} 
                    className={`group flex w-full items-center justify-between p-4 rounded-xl border-2 transition-all text-left bg-white ${condition === item.key ? "border-blue-600 bg-blue-50/50" : "border-slate-200 hover:border-blue-500 hover:bg-blue-50/50"}`}
                  >
                    <div>
                      <div className="font-bold text-slate-800 text-sm">{HEALTH_MODES[item.key as keyof typeof HEALTH_MODES].label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{item.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-step">
              <h2 className="text-xl font-bold text-slate-800">Preferences & Consent</h2>
              <p className="text-xs text-slate-500 mt-1 mb-4">Set how you want to be notified.</p>
              
              <label htmlFor="signup-frequency" className="block text-xs font-semibold text-slate-700 uppercase mb-1">Notification Frequency</label>
              <select 
                id="signup-frequency"
                value={notificationFrequency} 
                onChange={(e) => setNotificationFrequency(e.target.value as any)}
                className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-600 mb-4"
              >
                <option value="realtime">Real-time (While shopping)</option>
                <option value="daily">Daily Summary</option>
                <option value="weekly">Weekly Summary</option>
                <option value="off">Off</option>
              </select>

              <div className="flex items-center gap-2 mb-2 mt-4">
                <input type="checkbox" id="terms" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
                <label htmlFor="terms" className="text-sm text-slate-700">I accept the Terms of Service</label>
              </div>
              
              <div className="flex items-center gap-2">
                <input type="checkbox" id="privacy" checked={privacyAccepted} onChange={(e) => setPrivacyAccepted(e.target.checked)} />
                <label htmlFor="privacy" className="text-sm text-slate-700">I accept the Privacy Policy</label>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="wizard-step">
              <h2 className="text-xl font-bold text-slate-800">Choose Your Plan</h2>
              <p className="text-xs text-slate-500 mt-1 mb-4">Select the tier that best fits your needs.</p>

              <div className="flex flex-col gap-4 mb-6">
                <button
                  type="button"
                  onClick={() => setTier("basic")}
                  className={`flex items-center p-4 rounded-xl border-2 transition-all ${tier === "basic" ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <div className="flex-1 text-left">
                    <h3 className={`font-bold ${tier === "basic" ? "text-blue-700" : "text-slate-800"}`}>Basic</h3>
                    <p className="text-xs text-slate-500 mt-1">Limited features, no dashboard access.</p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-slate-800">Free</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setTier("premium")}
                  className={`flex items-center p-4 rounded-xl border-2 transition-all ${tier === "premium" ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <div className="flex-1 text-left">
                    <h3 className={`font-bold ${tier === "premium" ? "text-blue-700" : "text-slate-800"}`}>Premium</h3>
                    <p className="text-xs text-slate-500 mt-1">Full access to dashboard and shopping analytics.</p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-slate-800">Ksh {packagePrice.toFixed(2)}</span>
                  </div>
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="wizard-step">
              <h2 className="text-xl font-bold text-slate-800">Premium Access</h2>
              <p className="text-xs text-slate-500 mt-1 mb-4">Unlock the dashboard for Ksh {packagePrice.toFixed(2)}</p>

              <div className="flex gap-4 mb-6">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("Mobile Money")}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${paymentMethod === "Mobile Money" ? "border-green-600 bg-green-50 text-green-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                >
                  M-Pesa
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("Bank Transfer")}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${paymentMethod === "Bank Transfer" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                >
                  Card
                </button>
              </div>

              {paymentMethod === "Mobile Money" && (
                <div className="mb-6">
                  <label htmlFor="mpesa-phone" className="block text-xs font-semibold text-slate-700 uppercase mb-1">M-Pesa Phone Number</label>
                  <input 
                    id="mpesa-phone"
                    type="tel" 
                    placeholder="e.g. 254712345678" 
                    value={mpesaPhone} 
                    onChange={(e) => setMpesaPhone(e.target.value)} 
                    disabled={paymentStatus === "processing"}
                    className="w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-green-600 disabled:bg-slate-100 disabled:text-slate-400" 
                  />
                </div>
              )}

              {paymentMethod === "Bank Transfer" && (
                <div className="mb-6 p-4 rounded-lg bg-blue-50 border border-blue-100">
                  <p className="text-sm text-blue-800">You will be redirected to our secure Paystack portal to complete your card payment.</p>
                </div>
              )}

              {paymentStatus === "processing" && (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-green-600 rounded-full animate-spin mb-3"></div>
                  <p className="text-sm font-semibold text-slate-700">
                    {paymentMethod === "Mobile Money" ? `A PIN prompt has been sent to ${mpesaPhone}. Please enter your PIN to complete the transaction.` : "Verifying payment..."}
                  </p>
                  <button 
                    onClick={async () => {
                       await ExtensionStorage.setActivePayment(null, null);
                       setActivePaymentRef(null);
                       setActivePaymentMethod(null);
                       setPaymentStatus('idle');
                       setError('Verification cancelled. If you already approved the prompt on your phone, '
                             + 'your premium will activate within a few minutes — do not pay again.');
                    }}
                    className="mt-6 text-xs text-red-500 hover:text-red-700 underline transition"
                  >
                    Cancel Verification & Go Back
                  </button>
                </div>
              )}

              {paymentStatus === "success" && (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-3">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                  {finishError ? (
                    <>
                      <p role="alert" className="text-sm text-red-600 mb-3">{finishError}</p>
                      <button
                        className="text-xs text-green-700 underline hover:text-green-900 transition"
                        onClick={() => { setFinishError(null); void finishOnboarding(activePaymentRef!, activePaymentMethod === 'mpesa' ? 'Mobile Money' : 'Card'); }}
                      >
                        Retry saving profile
                      </button>
                    </>
                  ) : (
                    <p className="text-sm font-semibold text-green-700">Payment confirmed. Setting up your account…</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Inline error banner — replaces all browser alert() dialogs */}
        {errorMessage && (
          <div className="mx-4 mb-0 mt-2 flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
            <svg className="mt-0.5 shrink-0 text-red-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className="text-xs text-red-700 leading-snug">{errorMessage}</p>
          </div>
        )}

        {/* Constant Footer for Navigation */}
        <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-between items-center rounded-b-2xl">
          <button 
            onClick={handleBack} 
            disabled={step === 1 || paymentStatus === "processing" || paymentStatus === "success" || isSubmitting}
            className={`px-4 py-2 text-sm font-semibold rounded-lg ${step === 1 || paymentStatus === "processing" || paymentStatus === "success" || isSubmitting ? "text-slate-300 cursor-not-allowed" : "text-slate-600 hover:bg-slate-200 transition"}`}
          >
            Back
          </button>

          {(() => {
            if (step < 4) {
              return (
                <button 
                  onClick={handleNext}
                  disabled={isSubmitting}
                  className={`px-6 py-2 text-sm font-semibold rounded-lg transition ${
                    isSubmitting
                      ? "bg-blue-400 text-white cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {isSubmitting ? "Please wait…" : "Next"}
                </button>
              );
            } else if (step === 4) {
              return (
                <button 
                  onClick={handleNext}
                  disabled={isSubmitting}
                  className="px-6 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition disabled:bg-blue-400 flex items-center justify-center min-w-[150px]"
                >
                  {isSubmitting ? "Please wait…" : (tier === "premium" ? "Continue to Payment" : "Start Basic Plan")}
                </button>
              );
            } else if (step === 5) {
              if (paymentStatus === "processing" || paymentStatus === "success") {
                 return <div />;
              }
              return (
                <button 
                  onClick={handlePayment}
                  className="px-6 py-2 text-sm font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition shadow-lg"
                >
                  Pay Ksh {packagePrice.toFixed(2)}
                </button>
              );
            }
            return null;
          })()}
        </div>

      </div>
    </div>
  );
}
