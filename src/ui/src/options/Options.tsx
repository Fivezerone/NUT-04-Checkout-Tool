// src/ui/src/options/Options.tsx
// My Care Profile & Patient Preferences (CAD-Only Model)
// Reference: CAD-Only Identity & Onboarding Rollback (Phase 4) & UI/UX Overhaul (Stage C)

import React, { useEffect, useState } from "react";
import { ExtensionStorage, signOutUser, supabase } from "../services/storage";
import { toast, Toaster } from "sonner";
import { purgeAll, getSettings } from "../app/lib/db";
import { MultiLayerStorage } from "../../../shared/storage";
import { HEALTH_MODES } from "../../../shared/health-modes.mjs";
import { DECOY_TERMS_OF_SERVICE, DECOY_PRIVACY_POLICY, type LegalDoc } from "../app/legal/decoyLegalDocs";
import { ConsentDocModal } from "../app/components/ConsentDocModal";
import { ShieldCheck, Stethoscope, Lock, Bell, Trash2, LogOut, CheckCircle2, FileText, AlertTriangle } from "lucide-react";
import { ConfirmDialog, ConditionChip } from "../app/components/ui";

interface CareProfileState {
  patientName: string;
  patientEmail: string;
  clinicianName: string;
  clinicName: string;
  healthMode: string;
  healthModeLabel: string;
  healthModeRationale: string;
  targets: Array<{ nutrient: string; threshold: string; reason: string }>;
  notificationFrequency: "realtime" | "daily" | "weekly" | "off";
  language: string;
  consentGrantedAt?: string;
  enrollmentStatus: "active" | "suspended" | "deactivated" | "unverified";
}

export function Options() {
  const [profile, setProfile] = useState<CareProfileState>({
    patientName: "Patient",
    patientEmail: "",
    clinicianName: "Assigned Primary Clinician",
    clinicName: "Primary Care Clinical Unit (Cardio-Metabolic Clinic)",
    healthMode: "diabetes",
    healthModeLabel: "Cardio-Metabolic (Type 2 Diabetes)",
    healthModeRationale: "Prescribed free sugar restriction and glycaemic control",
    targets: [
      { nutrient: "Sugars", threshold: "≤ 25 g / day", reason: "Glycaemic regulation" },
      { nutrient: "Sodium", threshold: "≤ 2000 mg / day", reason: "Cardiovascular risk reduction" },
    ],
    notificationFrequency: "realtime",
    language: "en-KE",
    enrollmentStatus: "active",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [activeDoc, setActiveDoc] = useState<LegalDoc | null>(null);
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);

  useEffect(() => {
    loadCareProfile();
  }, []);

  async function loadCareProfile() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;

      const [storageData, idbSettings] = await Promise.all([
        ExtensionStorage.getOnboardingData(user?.id),
        getSettings().catch(() => null),
      ]);

      const fullName =
        user?.user_metadata?.full_name ||
        storageData?.user_account?.fullName ||
        idbSettings?.profileName ||
        "Patient";

      const currentFreq =
        storageData?.user_preferences?.notificationFrequency || "realtime";

      const clinician = "Assigned Primary Clinician";
      let clinic = "Primary Care Clinical Unit";
      const modeKey = idbSettings?.activeTheme || "diabetes";
      const modeLabel = HEALTH_MODES[modeKey as keyof typeof HEALTH_MODES]?.label || "Cardio-Metabolic (Type 2 Diabetes)";

      // If online and session exists, fetch latest tenant member info & assigned targets
      if (user) {
        try {
          const { data: memberData } = await supabase
            .from("tenant_members")
            .select("tenant_id, role, status, primary_clinician_id")
            .eq("user_id", user.id)
            .maybeSingle();

          if (memberData?.tenant_id) {
            const { data: tenant } = await supabase
              .from("tenants")
              .select("name")
              .eq("id", memberData.tenant_id)
              .maybeSingle();
            if (tenant?.name) clinic = tenant.name;
          }

          // Check consent
          const { data: consent } = await supabase
            .from("consents")
            .select("accepted_at")
            .eq("patient_id", user.id)
            .eq("consent_version", "2.0")
            .maybeSingle();

          setProfile((prev) => ({
            ...prev,
            patientName: fullName,
            patientEmail: user.email || "",
            clinicianName: clinician,
            clinicName: clinic,
            healthMode: modeKey,
            healthModeLabel: modeLabel,
            notificationFrequency: currentFreq,
            consentGrantedAt: consent?.accepted_at,
            enrollmentStatus: (memberData?.status as any) || "active",
          }));
        } catch {
          // Fallback to local
        }
      } else {
        setProfile((prev) => ({
          ...prev,
          patientName: fullName,
          clinicName: clinic,
          clinicianName: clinician,
          notificationFrequency: currentFreq,
        }));
      }
    } catch (e) {
      console.warn("[Options] Failed to load care profile:", e);
    } finally {
      setLoading(false);
    }
  }

  const handleSavePreferences = async () => {
    setSaving(true);
    try {
      await ExtensionStorage.updatePreferences({
        notificationFrequency: profile.notificationFrequency,
      });

      await MultiLayerStorage.updateDraft({
        user_preferences: {
          notificationFrequency: profile.notificationFrequency,
        } as any,
      });
      await MultiLayerStorage.commitDraftToLive();

      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({
          notificationFrequency: profile.notificationFrequency,
        });
      }

      toast.success("Preferences updated successfully");
    } catch {
      toast.error("Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  const handlePurgeData = async () => {
    try {
      await purgeAll();
      toast.success("Local shopping cache and product index cleared");
      setShowPurgeConfirm(false);
    } catch {
      toast.error("Failed to clear local cache");
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    window.location.href = "onboarding.html";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[color:var(--t-color-canvas)] flex items-center justify-center p-4">
        <p className="text-sm text-[color:var(--t-color-text-muted)]">Loading care profile...</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[color:var(--t-color-canvas)] text-[color:var(--t-color-text-strong)] p-4 sm:p-6 font-sans"
      data-surface="shopper"
    >
      <Toaster position="bottom-right" richColors />

      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-[color:var(--t-color-surface)] p-6 rounded-2xl border border-[color:var(--t-color-border-subtle)] shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 bg-[color:var(--t-color-action-primary)] text-white rounded-xl flex items-center justify-center font-bold text-xl shadow-xs">
              <Stethoscope className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[color:var(--t-color-text-strong)]">My Care Profile</h1>
              <p className="text-xs text-[color:var(--t-color-text-muted)] mt-0.5">
                Nutritional Guidance & Shopping Monitor Settings
              </p>
            </div>
          </div>

          <div className="sm:text-right">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
              <span>Active Care Enrollment</span>
            </span>
            <p className="text-xs text-[color:var(--t-color-text-muted)] mt-1">{profile.clinicName}</p>
          </div>
        </div>

        {/* SECTION 1: CLINICAL CARE OVERSIGHT (READ ONLY) */}
        <div className="bg-[color:var(--t-color-surface)] p-6 rounded-2xl border border-[color:var(--t-color-border-subtle)] shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-[color:var(--t-color-border-subtle)] pb-3">
            <h2 className="text-sm font-bold text-[color:var(--t-color-text-strong)] flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-[color:var(--t-color-action-primary)]" />
              <span>Clinician-Prescribed Health Regimen</span>
            </h2>
            <span className="text-xs font-semibold text-[color:var(--t-color-text-muted)] flex items-center gap-1 bg-[color:var(--t-color-surface-subtle)] px-2.5 py-1 rounded-md">
              <Lock className="w-3.5 h-3.5 text-[color:var(--t-color-text-muted)]" />
              <span>Prescribed by Clinician</span>
            </span>
          </div>

          {/* Assigned Mode Card */}
          <div className="p-4 bg-[color:var(--t-color-surface-subtle)] border border-[color:var(--t-color-border-subtle)] rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[color:var(--t-color-text-strong)]">Assigned Health Mode</span>
              <ConditionChip condition={profile.healthMode} />
            </div>
            <p className="text-xs text-[color:var(--t-color-text-muted)] leading-relaxed">
              <strong className="text-[color:var(--t-color-text-strong)]">Clinical Rationale:</strong> {profile.healthModeRationale}
            </p>
          </div>

          {/* Active Targets Table */}
          <div className="space-y-2 pt-1">
            <h3 className="text-xs font-semibold text-[color:var(--t-color-text-strong)]">Active Prescribed Nutrient Thresholds</h3>
            <div className="border border-[color:var(--t-color-border-subtle)] rounded-xl overflow-hidden text-xs">
              <table className="min-w-full divide-y divide-[color:var(--t-color-border-subtle)]">
                <thead className="bg-[color:var(--t-color-surface-subtle)] text-[color:var(--t-color-text-muted)] font-semibold">
                  <tr>
                    <th className="px-3.5 py-2.5 text-left">Nutrient</th>
                    <th className="px-3.5 py-2.5 text-left">Target Threshold</th>
                    <th className="px-3.5 py-2.5 text-left">Clinical Objective</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--t-color-border-subtle)] text-[color:var(--t-color-text-strong)]">
                  {profile.targets.map((tgt, i) => (
                    <tr key={i} className="hover:bg-[color:var(--t-color-surface-subtle)] transition-colors">
                      <td className="px-3.5 py-2.5 font-semibold">{tgt.nutrient}</td>
                      <td className="px-3.5 py-2.5 font-mono text-[color:var(--t-color-action-primary)] font-bold">{tgt.threshold}</td>
                      <td className="px-3.5 py-2.5 text-[color:var(--t-color-text-muted)]">{tgt.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Clinical Authority Advisory */}
          <div className="p-3.5 bg-[color:var(--t-color-surface-subtle)] rounded-xl border border-[color:var(--t-color-border-subtle)] text-xs text-[color:var(--t-color-text-muted)] flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Health modes and dietary thresholds are calibrated exclusively by your primary care clinician (
              <strong className="text-[color:var(--t-color-text-strong)]">{profile.clinicianName}</strong>). Patients cannot self-modify conditions. To review or adjust your care targets, please consult your clinic.
            </span>
          </div>
        </div>

        {/* SECTION 2: PATIENT PREFERENCES (EDITABLE) */}
        <div className="bg-[color:var(--t-color-surface)] p-6 rounded-2xl border border-[color:var(--t-color-border-subtle)] shadow-xs space-y-4">
          <div className="border-b border-[color:var(--t-color-border-subtle)] pb-3">
            <h2 className="text-sm font-bold text-[color:var(--t-color-text-strong)] flex items-center space-x-2">
              <Bell className="w-4 h-4 text-[color:var(--t-color-action-primary)]" />
              <span>Alert & Notification Preferences</span>
            </h2>
            <p className="text-xs text-[color:var(--t-color-text-muted)] mt-0.5">Customize how and when you receive checkout health alerts.</p>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-[color:var(--t-color-text-strong)] mb-1.5">Notification Frequency</label>
              <select
                value={profile.notificationFrequency}
                onChange={(e) =>
                  setProfile((prev) => ({
                    ...prev,
                    notificationFrequency: e.target.value as any,
                  }))
                }
                className="w-full px-3.5 py-2.5 border border-[color:var(--t-color-border-control)] rounded-xl bg-[color:var(--t-color-surface)] text-[color:var(--t-color-text-strong)] focus:outline-none focus:ring-2 focus:ring-[color:var(--t-color-action-primary)] text-xs"
              >
                <option value="realtime">Real-time alerts at checkout (Recommended)</option>
                <option value="daily">Daily summary of shopping compliance</option>
                <option value="weekly">Weekly dietary report</option>
                <option value="off">Muted (Review analytics in dashboard only)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[color:var(--t-color-text-strong)] mb-1.5">Display Language</label>
              <select
                value={profile.language}
                onChange={(e) => setProfile((prev) => ({ ...prev, language: e.target.value }))}
                className="w-full px-3.5 py-2.5 border border-[color:var(--t-color-border-control)] rounded-xl bg-[color:var(--t-color-surface)] text-[color:var(--t-color-text-strong)] focus:outline-none focus:ring-2 focus:ring-[color:var(--t-color-action-primary)] text-xs"
              >
                <option value="en-KE">English (Kenya)</option>
                <option value="sw-KE">Kiswahili</option>
              </select>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleSavePreferences}
                disabled={saving}
                className="px-4 py-2 bg-[color:var(--t-color-action-primary)] hover:opacity-95 text-white rounded-xl text-xs font-semibold shadow-xs transition-opacity disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Preferences"}
              </button>
            </div>
          </div>
        </div>

        {/* SECTION 3: PRIVACY, CONSENT & DATA CONTROLS */}
        <div className="bg-[color:var(--t-color-surface)] p-6 rounded-2xl border border-[color:var(--t-color-border-subtle)] shadow-xs space-y-4">
          <div className="border-b border-[color:var(--t-color-border-subtle)] pb-3">
            <h2 className="text-sm font-bold text-[color:var(--t-color-text-strong)] flex items-center space-x-2">
              <FileText className="w-4 h-4 text-[color:var(--t-color-action-primary)]" />
              <span>Data Protection, Consent & Local Storage</span>
            </h2>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3.5 bg-[color:var(--t-color-surface-subtle)] rounded-xl border border-[color:var(--t-color-border-subtle)] flex items-center justify-between">
              <div>
                <p className="font-semibold text-[color:var(--t-color-text-strong)]">Clinical Care Consent (v2.0)</p>
                <p className="text-xs text-[color:var(--t-color-text-muted)] mt-0.5">
                  Accepted: {profile.consentGrantedAt ? new Date(profile.consentGrantedAt).toLocaleDateString() : "Active"}
                </p>
              </div>
              <div className="space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveDoc(DECOY_TERMS_OF_SERVICE);
                    setIsDocModalOpen(true);
                  }}
                  className="text-[color:var(--t-color-action-primary)] hover:underline font-semibold"
                >
                  View Terms
                </button>
                <span>&middot;</span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveDoc(DECOY_PRIVACY_POLICY);
                    setIsDocModalOpen(true);
                  }}
                  className="text-[color:var(--t-color-action-primary)] hover:underline font-semibold"
                >
                  View Privacy Notice
                </button>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <div>
                <p className="font-semibold text-[color:var(--t-color-text-strong)]">Local Data Cache</p>
                <p className="text-xs text-[color:var(--t-color-text-muted)] mt-0.5">Clear cached product ratings and cart snapshots on this device.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPurgeConfirm(true)}
                className="px-3.5 py-2 border border-[color:var(--t-color-border-control)] hover:bg-[color:var(--t-color-surface-subtle)] text-[color:var(--t-color-text-strong)] rounded-xl font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                <span>Clear Local Cache</span>
              </button>
            </div>

            <div className="pt-3 border-t border-[color:var(--t-color-border-subtle)] flex items-center justify-between">
              <div>
                <p className="font-semibold text-[color:var(--t-color-text-strong)]">Sign Out</p>
                <p className="text-xs text-[color:var(--t-color-text-muted)] mt-0.5">Sign out of this browser extension.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSignOutConfirm(true)}
                className="px-3.5 py-2 border border-rose-300 text-rose-700 hover:bg-rose-50 rounded-xl font-semibold flex items-center gap-1.5 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Accessible Modals using ConfirmDialog Primitive */}
      <ConfirmDialog
        isOpen={showPurgeConfirm}
        title="Clear Local Cache?"
        description="This will remove cached product nutrition scores and shopping history stored in your local browser. It will not affect your clinical care enrollment. Type CLEAR to confirm."
        confirmLabel="Clear Cache"
        variant="danger"
        expectedPhrase="CLEAR"
        onConfirm={handlePurgeData}
        onClose={() => setShowPurgeConfirm(false)}
      />

      <ConfirmDialog
        isOpen={showSignOutConfirm}
        title="Sign Out of NutriScore?"
        description="You will need your clinic credentials to sign back in. Real-time shopping alerts will be paused."
        confirmLabel="Sign Out"
        variant="warning"
        onConfirm={handleSignOut}
        onClose={() => setShowSignOutConfirm(false)}
      />

      {/* Decoy Legal Doc Modal */}
      <ConsentDocModal
        isOpen={isDocModalOpen}
        doc={activeDoc}
        onClose={() => setIsDocModalOpen(false)}
      />
    </div>
  );
}
export default Options;
