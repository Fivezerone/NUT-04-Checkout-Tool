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
  condition?: string;
  metric?: string;
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
    notificationFrequency, termsAccepted, privacyAccepted,
    initialMode, setFinishError, tier
  } = deps;

  if (userId) {
    const isRenewal = initialMode === 'renew';
    if (!isRenewal) {
      let rpcSucceeded = false;
      let rpcError: any;
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
              onboarding_step: 3,
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

  const isPremiumUser = tier !== 'basic';
  
  const extStoragePromise = ExtensionStorage.setOnboardingComplete(userId!, ({
    onboarding_completed: true,
    nutriscore_is_premium: isPremiumUser,
    user_account: {
      fullName: fullName || "Guest",
      email: email || "",
    },
    user_preferences: {
      notificationFrequency: notificationFrequency || "realtime",
      termsAccepted: termsAccepted,
      privacyAccepted: privacyAccepted,
      consentTimestamp: new Date().toISOString()
    }
  } as any));
  
  // Preserve existing settings from getSettings(); do not write condition or activeTheme from onboarding
  const settingsPromise = (async () => {
    const settings = await getSettings();
    await saveSettings({
      ...settings,
      profileName: fullName || settings.profileName || "Guest",
    });
  })();
  
  const draftPromise = (async () => {
    await MultiLayerStorage.updateDraft({ 
      onboarding_completed: true,
      nutriscore_is_premium: isPremiumUser,
      user_account: {
        fullName: fullName || "Guest",
        email: email || "",
      } as any,
      user_preferences: {
        notificationFrequency: notificationFrequency || "realtime",
        termsAccepted: termsAccepted,
        privacyAccepted: privacyAccepted,
        consentTimestamp: new Date().toISOString()
      }
    });
    await MultiLayerStorage.commitDraftToLive();
  })();

  const localChromePromise = (typeof chrome !== "undefined" && chrome.storage?.local)
    ? chrome.storage.local.set({
        onboarding_completed: true,
        nutriscore_is_premium: isPremiumUser,
      })
    : Promise.resolve();

  const tokenPromise = token ? savePremiumStatus(token) : Promise.resolve();

  await Promise.all([extStoragePromise, settingsPromise, draftPromise, localChromePromise, tokenPromise]);

  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ action: "REFRESH_ENTITLEMENT" }).catch(() => {});
  }

  return true;
};
