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
      let rpcSucceeded = false;
      let rpcError: any = null;
      let data: any = null;

      try {
        const res = await supabase.rpc('complete_onboarding', {
          p_tier: tier || 'premium'
        });
        data = res?.data;
        rpcError = res?.error;
        if (!rpcError && !(data && data.error)) {
          rpcSucceeded = true;
        }
      } catch (e: any) {
        rpcError = e;
      }

      if (!rpcSucceeded) {
        console.warn('[finishOnboarding] complete_onboarding RPC error or unavailable, attempting resilient table fallback:', rpcError?.message || data?.error);
        let fallbackSucceeded = false;
        if (typeof supabase?.from === 'function') {
          try {
            const now = new Date().toISOString();
            const isPremiumUser = tier !== 'basic';
            const { error: directErr } = await supabase.from('users').update({
              onboarding_completed: true,
              onboarding_step: 4,
              is_premium: isPremiumUser,
              updated_at: now
            }).eq('id', userId);

            if (!directErr) {
              fallbackSucceeded = true;
            } else {
              // Resilient fallback if onboarding_step column is missing in remote schema
              const { error: minimalErr } = await supabase.from('users').update({
                onboarding_completed: true,
                is_premium: isPremiumUser,
                updated_at: now
              }).eq('id', userId);
              if (!minimalErr) {
                fallbackSucceeded = true;
              }
            }
          } catch (fallbackEx: any) {
            console.warn('[finishOnboarding] direct table update exception:', fallbackEx?.message || fallbackEx);
          }
        }

        if (!fallbackSucceeded) {
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
    }
  }

  const finalTheme = condition && condition !== "general" ? condition : "general";
  const isPremiumUser = tier !== 'basic';
  
  await ExtensionStorage.setOnboardingComplete(userId!, ({
    onboarding_completed: true,
    nutriscore_is_premium: isPremiumUser,
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
  
  await MultiLayerStorage.updateDraft({ 
    uiTheme: finalTheme,
    onboarding_completed: true,
    nutriscore_is_premium: isPremiumUser
  });
  await MultiLayerStorage.commitDraftToLive();

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({
      onboarding_completed: true,
      nutriscore_is_premium: isPremiumUser
    });
  }

  if (token) {
    await savePremiumStatus(token);
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ action: "REFRESH_ENTITLEMENT" }).catch(() => {});
  }

  return true;
};
