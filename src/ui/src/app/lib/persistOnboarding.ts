import { ExtensionStorage, supabase, savePremiumStatus } from "../../services/storage";
import { getSettings, saveSettings } from "./db";

export type OnboardingDeps = {
  paymentRef: string;
  method: string;
  token?: string;
  userId?: string;
  user: any;
  fullName: string;
  email: string;
  dob: string;
  gender: string;
  condition: string;
  metric: string;
  notificationFrequency: "realtime" | "daily" | "weekly" | "off";
  termsAccepted: boolean;
  privacyAccepted: boolean;
  initialMode: string;
  setFinishError: (err: string) => void;
};

export const persistOnboarding = async (deps: OnboardingDeps) => {
  const {
    paymentRef, token, userId, user, fullName, email, dob, gender,
    condition, metric, notificationFrequency, termsAccepted, privacyAccepted,
    initialMode, setFinishError
  } = deps;

  if (userId) {
    const isRenewal = initialMode === 'renew';
    if (!isRenewal) {
      const now = new Date().toISOString();
      const { error: upsertError } = await supabase.from('users').upsert({
        id: userId,
        full_name:            fullName  || user?.user_metadata?.full_name || 'User',
        email:                email     || user?.email || '',
        dob,
        gender,
        condition,
        metric,
        notification_frequency:  notificationFrequency,
        terms_accepted:           termsAccepted,
        privacy_accepted:         privacyAccepted,
        consent_timestamp:        now,
        onboarding_completed:     true,
        health_mode:              condition !== 'general',
        selected_tags:            [condition, metric].filter(Boolean),
      }, { onConflict: 'id' });

      if (upsertError) {
        setFinishError(
          `Payment received (ref: ${paymentRef}) — your premium is safe. ` +
          `We could not save your profile yet. Please retry.`
        );
        console.error('[finishOnboarding] profile UPSERT failed:', JSON.stringify(upsertError));
        if (token) await savePremiumStatus(token);
        return;
      }
    }
  }

  const finalTheme = condition && condition !== "general" ? condition : "general";
  
  await ExtensionStorage.setOnboardingComplete({
    user_account: {
      fullName: fullName || "Guest",
      email: email || "",
      dob: dob || "",
      gender: gender || ""
    },
    user_preferences: {
      healthMode: finalTheme !== "general",
      notificationFrequency: notificationFrequency || "realtime",
      selectedTags: [condition, metric].filter(Boolean),
      termsAccepted: termsAccepted,
      privacyAccepted: privacyAccepted,
      consentTimestamp: new Date().toISOString()
    }
  });
  
  const settings = await getSettings();
  await saveSettings({ ...settings, activeTheme: finalTheme as any });
  if (token) {
    await savePremiumStatus(token);
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ action: "THEME_CHANGED", theme: finalTheme }).catch(() => {});
    chrome.runtime.sendMessage({ action: "REFRESH_ENTITLEMENT" }).catch(() => {});
  }
};
