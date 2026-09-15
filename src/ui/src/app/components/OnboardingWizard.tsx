import React, { useState } from "react";
import { getSettings, saveSettings } from "../lib/db";

export interface UserProfile {
  name: string;
  initials: string;
  condition: string;
  primaryMetric: string;
  isFirstTime: boolean;
}

interface Props {
  onComplete: (profile: UserProfile) => void;
}

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");

  const handleNext = () => {
    if (!name.trim()) {
      alert("Please enter your name.");
      return;
    }
    setStep(2);
  };

  const handleSelectCondition = async (conditionKey: string, metricKey: string) => {
    const finalName = name.trim() || "Friend";
    const initials = finalName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
    
    const profile: UserProfile = {
      name: finalName,
      initials,
      condition: conditionKey,
      primaryMetric: metricKey,
      isFirstTime: false
    };

    try {
      const currentSettings = await getSettings();
      await saveSettings({
        ...currentSettings,
        profileName: finalName,
        initials,
        condition: conditionKey === "general" ? "healthy" : conditionKey,
        primaryMetric: metricKey,
        diabetes: conditionKey === "diabetes",
        hypertension: conditionKey === "hypertension",
        kidney: conditionKey === "kidney"
      });
    } catch (e) {
      console.warn("Could not save settings to DB", e);
    }
    
    document.documentElement.setAttribute('data-health-condition', conditionKey);
    onComplete(profile);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/5">
        
        {step === 1 && (
          <div className="wizard-step">
            <h2 className="text-xl font-bold text-slate-800">Welcome! Let's personalize your dashboard.</h2>
            <p className="text-xs text-slate-500 mt-1 mb-4">Tell us a bit about yourself to tailor your analytics.</p>
            
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Your Name</label>
            <input 
              type="text" 
              placeholder="e.g. Joe" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-600 mb-4" 
            />

            <button 
              type="button" 
              onClick={handleNext} 
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition"
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-step">
            <h2 className="text-xl font-bold text-slate-800">What is your primary health focus?</h2>
            <p className="text-xs text-slate-500 mt-1 mb-4">We'll prioritize metrics and alerts relevant to you.</p>
            
            <div className="space-y-3 mb-6">
              <button 
                type="button" 
                onClick={() => handleSelectCondition('diabetes', 'Sugar')} 
                className="group flex w-full items-center justify-between p-4 rounded-xl border-2 border-slate-200 hover:border-blue-500 hover:bg-blue-50/50 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-all text-left bg-white"
              >
                <div>
                  <div className="font-bold text-slate-800 text-sm">Blood Sugar & Diabetes</div>
                  <div className="text-xs text-slate-500 mt-0.5">Tracks sugar limits & glycaemic markers</div>
                </div>
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 group-hover:border-blue-500 transition-colors">
                  <svg className="h-3 w-3 text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"></path></svg>
                </div>
              </button>

              <button 
                type="button" 
                onClick={() => handleSelectCondition('hypertension', 'Sodium')} 
                className="group flex w-full items-center justify-between p-4 rounded-xl border-2 border-slate-200 hover:border-blue-500 hover:bg-blue-50/50 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-all text-left bg-white"
              >
                <div>
                  <div className="font-bold text-slate-800 text-sm">Blood Pressure & Sodium</div>
                  <div className="text-xs text-slate-500 mt-0.5">Monitors salt and potassium thresholds</div>
                </div>
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 group-hover:border-blue-500 transition-colors">
                  <svg className="h-3 w-3 text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"></path></svg>
                </div>
              </button>

              <button 
                type="button" 
                onClick={() => handleSelectCondition('general', 'Saturated Fat')} 
                className="group flex w-full items-center justify-between p-4 rounded-xl border-2 border-slate-200 hover:border-blue-500 hover:bg-blue-50/50 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-all text-left bg-white"
              >
                <div>
                  <div className="font-bold text-slate-800 text-sm">General Wellness</div>
                  <div className="text-xs text-slate-500 mt-0.5">Balanced nutritional score focus</div>
                </div>
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 group-hover:border-blue-500 transition-colors">
                  <svg className="h-3 w-3 text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"></path></svg>
                </div>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
