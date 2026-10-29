import React, { useEffect, useState } from "react";
import { ExtensionStorage, ChromeExtensionStorage, signOutUser, supabase, setOnboardingCompleted } from "../services/storage";
import { toast } from "sonner";
import { Toaster } from "sonner";
import { purgeAll, getSettings, saveSettings } from "../app/lib/db";
import { MultiLayerStorage } from "../../../shared/storage";
import { HEALTH_MODES } from "../../../shared/health-modes.mjs";
import { isSubscriptionExpired } from "../app/lib/subscriptionUtils";

export function Options() {
  const [data, setData] = useState<Partial<ChromeExtensionStorage> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [expiryDate, setExpiryDate] = useState<string | null>(null);
  const [trueSubStatus, setTrueSubStatus] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    const unsubscribe = MultiLayerStorage.subscribeDraft((newDraft) => {
      if (newDraft) setData(newDraft as any);
    });
    return unsubscribe;
  }, []);

  async function loadData() {
    try {
      // PERF: Use getSession() (cached in localStorage) instead of getUser() which makes a blocking network call (~500–1500ms)
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user || null;

      // PERF: Read local draft, extension storage, chrome.storage.local, and IDB settings in parallel (<5ms total)
      const [draftData, storageData, local, idbSettings] = await Promise.all([
        MultiLayerStorage.initDraft(),
        ExtensionStorage.getOnboardingData(user?.id),
        typeof chrome !== 'undefined' && chrome.storage?.local
          ? chrome.storage.local.get([
              'onboarding_completed',
              'nutri_entitlement',
              'nutriscore_is_premium',
              'uiTheme',
              'user_account',
              'user_preferences',
              'user_payment'
            ])
          : Promise.resolve({} as any),
        getSettings().catch(() => null)
      ]);

      let isOnboarded = !!storageData?.onboarding_completed || local?.onboarding_completed === true;
      let isPremium = local?.nutriscore_is_premium === true || !!local?.nutri_entitlement;

      // Check cached entitlement if available
      if (local?.nutri_entitlement) {
        const ent = local.nutri_entitlement;
        if (ent.premium_expires_at) {
          setExpiryDate(new Date(ent.premium_expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
        }
        const expired = ent.tier !== 'premium' || isSubscriptionExpired(ent.premium_expires_at, ent.server_now);
        setTrueSubStatus(expired ? 'expired' : 'active');
        if (!expired || ent.tier === 'premium') {
          isPremium = true;
          isOnboarded = true; // Premium subscribers are always granted onboarding status
        }
      } else if (isPremium) {
        setTrueSubStatus('active');
      }

      // Settings access unlocked for onboarded users OR any premium subscribers
      const canAccessSettings = isOnboarded || isPremium;

      const effectiveCondition = 
        (local?.user_account as any)?.condition ||
        (local?.user_preferences?.selectedTags && local.user_preferences.selectedTags[0]) ||
        (storageData?.user_account as any)?.condition ||
        (storageData?.user_preferences?.selectedTags && storageData.user_preferences.selectedTags[0]) ||
        idbSettings?.activeTheme ||
        (local as any)?.uiTheme ||
        (draftData as any)?.uiTheme ||
        "general";

      const effectiveMetric = 
        (local?.user_account as any)?.metric ||
        (local?.user_preferences?.selectedTags && local.user_preferences.selectedTags[1]) ||
        (storageData?.user_account as any)?.metric ||
        idbSettings?.primaryMetric ||
        "Sugar";

      const merged = {
        ...draftData,
        ...storageData,
        ...local,
        uiTheme: effectiveCondition,
        user_account: {
          ...(draftData?.user_account || {}),
          ...(storageData?.user_account || {}),
          ...(local?.user_account || {}),
          condition: effectiveCondition,
          metric: effectiveMetric
        },
        user_preferences: {
          ...(draftData?.user_preferences || {}),
          ...(storageData?.user_preferences || {}),
          ...(local?.user_preferences || {}),
          healthMode: effectiveCondition !== "general",
          selectedTags: [effectiveCondition, effectiveMetric].filter(Boolean)
        },
        user_payment: {
          ...(draftData?.user_payment || {}),
          ...(storageData?.user_payment || {}),
          ...(local?.user_payment || {})
        },
        onboarding_completed: canAccessSettings,
        nutriscore_is_premium: isPremium
      };

      // Render settings immediately from merged cache!
      setData(merged as any);
      setLoading(false);

      // Stale-While-Revalidate: Revalidate with remote Supabase in the background (fire-and-forget)
      if (user) {
        Promise.all([
          supabase
            .from('users')
            .select('onboarding_completed, is_premium')
            .eq('id', user.id)
            .maybeSingle(),
          supabase.rpc('get_my_entitlement')
        ])
          .then(async ([profileRes, entRes]) => {
            let updatedOnboarded = isOnboarded;
            let updatedPremium = isPremium;

            if (profileRes.data) {
              if (profileRes.data.onboarding_completed) updatedOnboarded = true;
              if (profileRes.data.is_premium === true) updatedPremium = true;
            }

            if (entRes.data) {
              const ent = entRes.data;
              if (ent.premium_expires_at) {
                setExpiryDate(new Date(ent.premium_expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
              }
              const expired = ent.tier !== 'premium' || isSubscriptionExpired(ent.premium_expires_at, ent.server_now);
              if (!expired || ent.tier === 'premium') {
                updatedPremium = true;
                updatedOnboarded = true;
              }
              setTrueSubStatus(expired ? 'expired' : 'active');
            }

            const updatedCanAccess = updatedOnboarded || updatedPremium;
            setData(prev => prev ? {
              ...prev,
              onboarding_completed: updatedCanAccess,
              nutriscore_is_premium: updatedPremium
            } : prev);

            if (updatedCanAccess) {
              setOnboardingCompleted(user.id, true).catch(() => {});
              MultiLayerStorage.updateDraft({ onboarding_completed: true }).catch(() => {});
              if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                chrome.storage.local.set({ onboarding_completed: true }).catch(() => {});
              }
            }
          })
          .catch(e => {
            console.warn("[Options] Background revalidation error:", e);
          });
      }
    } catch (e) {
      console.warn("Failed to fetch settings/expiry", e);
      setLoading(false);
    }
  }

  const handleAccountChange = (field: string, value: string) => {
    setData(prev => {
      if (!prev) return prev;
      const next = {
        ...prev,
        user_account: {
          ...prev.user_account,
          [field]: value
        } as any
      };
      MultiLayerStorage.updateDraft({ user_account: next.user_account });
      return next;
    });
  };

  const handlePreferencesChange = (field: string, value: any) => {
    setData(prev => {
      if (!prev) return prev;
      const next = {
        ...prev,
        user_preferences: {
          ...prev.user_preferences,
          [field]: value
        } as any
      };
      MultiLayerStorage.updateDraft({ user_preferences: next.user_preferences });
      return next;
    });
  };

  const handlePaymentChange = (field: string, value: string) => {
    setData(prev => {
      if (!prev) return prev;
      const next = {
        ...prev,
        user_payment: {
          ...prev.user_payment,
          billingAddress: {
            ...((prev.user_payment as any)?.billingAddress),
            [field]: value
          }
        } as any
      };
      MultiLayerStorage.updateDraft({ user_payment: next.user_payment });
      return next;
    });
  };

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const rawCondition = (data.user_account as any)?.condition 
        || (data.user_preferences?.selectedTags && data.user_preferences.selectedTags[0]) 
        || (data as any)?.uiTheme 
        || "general";
      const condition = (!rawCondition || rawCondition === "none") ? "general" : rawCondition;
      const metric = (data.user_account as any)?.metric 
        || (data.user_preferences?.selectedTags && data.user_preferences.selectedTags[1]) 
        || "Sugar";
      const theme = condition;
      
      const isNoCondition = condition === "general";
      const nextPreferences = {
        ...(data.user_preferences || {}),
        healthMode: !isNoCondition,
        selectedTags: isNoCondition ? [] : [condition, metric].filter(Boolean)
      };
      const nextAccount = {
        ...(data.user_account || {}),
        condition,
        metric
      };

      // 1. Commit draft to live storage in MultiLayerStorage
      await MultiLayerStorage.updateDraft({
        uiTheme: theme,
        user_preferences: nextPreferences as any,
        user_account: nextAccount as any
      });
      await MultiLayerStorage.commitDraftToLive();

      // 2. Persist to chrome.storage.local (including explicit uiTheme for content script listener)
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({
          uiTheme: theme,
          user_account: nextAccount,
          user_preferences: nextPreferences,
          user_payment: data.user_payment
        });
      }

      // 3. Persist to IndexedDB user_settings for background SW & Dashboard
      try {
        const currentSettings = await getSettings();
        await saveSettings({
          ...currentSettings,
          activeTheme: theme as any,
          condition: condition,
          primaryMetric: metric,
          diabetes: condition === "diabetes",
          hypertension: condition === "hypertension",
          kidney: condition === "kidney",
          obesity: condition === "obesity"
        });
      } catch (dbErr) {
        console.warn("[Options] Failed to save to IndexedDB settings:", dbErr);
      }

      // 4. If Supabase user is logged in, update remote profile
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (userId) {
          await supabase.from('users').update({
            condition,
            metric,
            health_mode: !isNoCondition,
            selected_tags: isNoCondition ? [] : [condition, metric].filter(Boolean),
            updated_at: new Date().toISOString()
          }).eq('id', userId);
        }
      } catch (sbErr) {
        console.warn("[Options] Failed to update remote Supabase profile:", sbErr);
      }

      // 5. Broadcast to runtime so active tabs rescan immediately
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: "REFRESH_ENTITLEMENT" }).catch(() => {});
      }

      toast.success("Settings saved successfully!");
    } catch (e) {
      console.error("[Options] handleSave error:", e);
      toast.error("Failed to save settings.");
    }
    setSaving(false);
  };

  const handleReset = () => {
    setShowDeleteConfirm(true);
  };

  const confirmErase = async () => {
    await purgeAll();
    await ExtensionStorage.clearAll();
    toast.success("All data deleted. Please reload the extension.");
    setShowDeleteConfirm(false);
    setTimeout(() => {
      window.close();
    }, 3000);
  };

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = async () => {
    setShowLogoutConfirm(false);
    await signOutUser();
    toast.success("Logged out successfully.");
    // Give the toast a moment to be read, then close the settings tab.
    // The popup will show the 'Log In' button on next open.
    setTimeout(() => window.close(), 1500);
  };

  if (loading) {
    return <div className="p-8">Loading settings...</div>;
  }

  if (!data?.onboarding_completed) {
    return (
      <div className="max-w-2xl mx-auto mt-12 p-8 bg-white rounded-xl shadow border border-slate-200 text-center">
        <h1 className="text-xl font-bold text-slate-800 mb-4">Not Onboarded</h1>
        <p className="text-slate-600 mb-6">You need to complete the onboarding before accessing settings.</p>
        <p className="text-sm text-slate-500">Click the NutriScore extension icon in your browser toolbar to start.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-12 px-6">
      <Toaster position="top-right" />
      <div className="mb-10 flex items-center justify-between bg-blue-50/50 p-6 rounded-2xl border border-blue-100/50 shadow-sm">
        <div>
          <h1 className="text-3xl font-bold text-blue-950 tracking-tight">
            Hello, {data.user_account?.fullName?.split(" ")[0] || "User"}
          </h1>
          <p className="text-blue-700/80 mt-1.5 font-medium">Manage your account, preferences, and subscription.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-semibold shadow-md shadow-blue-600/20 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      <div className="space-y-6">
        {/* Account Settings */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100 flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            Personal Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-slate-700 uppercase mb-2">Full Name</label>
              <input
                type="text"
                value={data.user_account?.fullName || ""}
                onChange={(e) => handleAccountChange("fullName", e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all bg-slate-50/50"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 uppercase mb-2">Email Address</label>
              <input
                type="email"
                value={data.user_account?.email || ""}
                onChange={(e) => handleAccountChange("email", e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all bg-slate-50/50"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 uppercase mb-2">Date of Birth</label>
              <input
                type="date"
                value={data.user_account?.dob || ""}
                onChange={(e) => handleAccountChange("dob", e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all bg-slate-50/50"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 uppercase mb-2">Gender</label>
              <select
                value={data.user_account?.gender || ""}
                onChange={(e) => handleAccountChange("gender", e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all bg-slate-50/50"
              >
                <option value="">Select Gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 uppercase mb-2">Current Health Mode</label>
              <input
                type="text"
                readOnly
                value={
                  (() => {
                    const focus = (data?.user_account as any)?.condition || (data?.user_preferences?.selectedTags && data.user_preferences.selectedTags[0]) || (data as any)?.uiTheme || "general";
                    if (!focus || focus === "general" || focus === "none") return "No Condition (General Wellness)";
                    return HEALTH_MODES[focus as keyof typeof HEALTH_MODES]?.label || focus;
                  })()
                }
                className="w-full border border-slate-200 rounded-xl p-3 bg-slate-100 text-slate-600 font-medium cursor-not-allowed"
              />
              <p className="text-xs text-slate-500 mt-1">Select a new primary health focus below to change this.</p>
            </div>
          </div>
        </section>

        {/* Health Profile */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100 flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9C8.8 1 15.2 1 19.1 4.9C23 8.8 23 15.2 19.1 19.1C15.2 23 8.8 23 4.9 19.1Z"></path><path d="M12 8v4l3 3"></path></svg>
            Primary Health Focus
          </h2>
          <div className="space-y-3">
            {[
              { key: 'general', label: 'No Condition (General Wellness)', metric: 'Saturated Fat', desc: 'Standard nutritional scoring without disease alerts' },
              { key: 'diabetes', label: 'Diabetes', metric: 'Sugar', desc: 'Tracks sugar limits & glycaemic markers' },
              { key: 'hypertension', label: 'Hypertension', metric: 'Sodium', desc: 'Monitors salt and potassium thresholds' },
              { key: 'kidney', label: 'Kidney Disease', metric: 'Sodium/Potassium', desc: 'Monitors sodium and potassium levels' },
              { key: 'obesity', label: 'Obesity / Weight Management', metric: 'Energy', desc: 'Tracks calorie density, sugars and saturated fats' },
            ].map((item) => {
              const currentFocus = (data?.user_preferences?.selectedTags && data.user_preferences.selectedTags[0])
                || (data?.user_account as any)?.condition
                || (data as any)?.uiTheme
                || "general";
              const isActive = (item.key === 'general' && (!currentFocus || currentFocus === 'general' || currentFocus === 'none'))
                || currentFocus === item.key;
              return (
                <button 
                  key={item.key}
                  type="button" 
                  onClick={() => {
                    const isNoCond = item.key === 'general';
                    const nextAccount = {
                      ...(data?.user_account || {}),
                      condition: item.key,
                      metric: item.metric
                    };
                    const nextPreferences = {
                      ...(data?.user_preferences || {}),
                      healthMode: !isNoCond,
                      selectedTags: isNoCond ? [] : [item.key, item.metric].filter(Boolean)
                    };
                    const newData = {
                      ...data,
                      uiTheme: item.key,
                      user_preferences: nextPreferences,
                      user_account: nextAccount as any
                    };
                    // Update React state immediately so UI highlights choice
                    setData(newData as any);
                    // Sync the new theme and account/preferences to draft state
                    MultiLayerStorage.updateDraft({ 
                      uiTheme: item.key, 
                      user_preferences: nextPreferences as any, 
                      user_account: nextAccount as any
                    });
                  }} 
                  className={`group flex w-full items-center justify-between p-4 rounded-xl border-2 transition-all text-left bg-white ${isActive ? "border-blue-600 bg-blue-50/50" : "border-slate-200 hover:border-blue-500 hover:bg-blue-50/50"}`}
                >
                  <div>
                    <div className="font-bold text-slate-800 text-sm">{item.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{item.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Subscription Status */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100 flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600"><rect width="20" height="14" x="2" y="5" rx="2"></rect><line x1="2" x2="22" y1="10" y2="10"></line></svg>
            Subscription Status
          </h2>
          <div className="flex items-center p-4 bg-slate-50 rounded-xl border border-slate-100 gap-4">
            <div className={`p-3 rounded-full ${trueSubStatus === 'expired' ? 'bg-orange-100 text-orange-600' : (trueSubStatus === 'active' || trueSubStatus === 'trialing' ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-600')}`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-800">{trueSubStatus === 'expired' ? 'Expired — Basic Plan' : (trueSubStatus === 'active' || trueSubStatus === 'trialing' ? 'Premium Plan' : 'Basic Plan')}</h3>
              <p className="text-sm text-slate-500">
                {trueSubStatus === 'expired' ? 'Your premium plan has expired. You are on the free plan with limited features.' : (trueSubStatus === 'active' || trueSubStatus === 'trialing' ? 'You have full access to dashboard and analytics.' : 'You are on the free plan with limited features.')}
              </p>
              {(trueSubStatus === 'active' || trueSubStatus === 'trialing' || trueSubStatus === 'expired') && expiryDate && (
                <p className="text-sm font-semibold text-blue-600 mt-1">
                  {trueSubStatus === 'expired' ? 'Expired on: ' : 'Ends on: '} {expiryDate}
                </p>
              )}
            </div>
            {!(trueSubStatus === 'active' || trueSubStatus === 'trialing') && (
              <button
                onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") + "?mode=renew" })}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition"
              >
                Upgrade
              </button>
            )}
          </div>
        </section>

        {/* Danger Zone */}
        <section className="bg-red-50/50 p-6 rounded-2xl border border-red-100 mt-10">
          <h2 className="text-lg font-bold text-red-800 mb-2">Account Actions</h2>
          <p className="text-sm text-red-600/80 mb-5 font-medium">These actions affect your account and session on this device.</p>

          <div className="flex flex-wrap gap-3">
            {/* Log Out */}
            <button
              id="logout-btn"
              onClick={handleLogout}
              className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-5 py-2.5 rounded-xl font-semibold shadow-sm transition-all"
            >
              Log Out
            </button>

            {/* Delete All Data */}
            <button
              id="delete-all-data-btn"
              onClick={handleReset}
              className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm transition-all"
            >
              Yes, delete all my data
            </button>
          </div>
        </section>
      </div>

      {/* Log Out Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl ring-1 ring-black/10">
            <h2 className="mb-2 text-lg font-bold text-gray-900">Log out of NutriScore?</h2>
            <p className="mb-6 text-sm text-gray-500">
              Your settings and preferences will remain. You can log back in at any time using the extension popup.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                id="confirm-logout-btn"
                type="button"
                onClick={confirmLogout}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 transition"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl ring-1 ring-black/10">
            <h2 className="mb-2 text-lg font-bold text-gray-900">Delete all your data?</h2>
            <p className="mb-6 text-sm text-gray-500">
              This removes every saved item from this device. You cannot undo this.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmErase}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 transition"
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
