import { ExtensionStorage, supabase, savePremiumStatus } from "../../services/storage";
import { getSettings, saveSettings } from "./db";
import { CentralStorage, MultiLayerStorage } from "../../../../shared/storage";

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
  tier?: string;
  setFinishError: (err: string) => void;
};

export const persistOnboarding = async (deps: OnboardingDeps): Promise<boolean> => {
  const {
    paymentRef, token, userId, user, fullName, email, dob, gender,
    condition, metric, notificationFrequency, termsAccepted, privacyAccepted,
    initialMode, setFinishError, tier
  } = deps;

  if (userId) {
    const isRenewal = initialMode === 'renew';
    if (!isRenewal) {
      const { data, error: rpcError } = await supabase.rpc('complete_onboarding', {
        p_tier: tier || 'premium'
      });

      if (rpcError || (data && data.error)) {
        setFinishError(
          `Payment received (ref: ${paymentRef}) — your premium is safe. ` +
          `We could not save your profile yet. Please retry.`
        );
        console.error('[finishOnboarding] profile update failed:', JSON.stringify(rpcError || data));
        if (token) await savePremiumStatus(token);
        return false;
      }
    }
  }

  const finalTheme = condition && condition !== "general" ? condition : "general";
  
  await ExtensionStorage.setOnboardingComplete(userId!, ({
    user_account: {
      fullName: fullName || "Guest",
      email: email || ""
    },
    user_preferences: {
      healthMode: finalTheme !== "general",
      notificationFrequency: notificationFrequency || "realtime",
      selectedTags: [condition, metric].filter(Boolean),
      termsAccepted: termsAccepted,
      privacyAccepted: privacyAccepted,
      consentTimestamp: new Date().toISOString()
    }
  } as any));
  
  const settings = await getSettings();
  await saveSettings({ ...settings, activeTheme: finalTheme as any });
  
  await MultiLayerStorage.updateDraft({ uiTheme: finalTheme });
  await MultiLayerStorage.commitDraftToLive();

  if (token) {
    await savePremiumStatus(token);
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ action: "REFRESH_ENTITLEMENT" }).catch(() => {});
  }

  return true;
};
