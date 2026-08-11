import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Toaster } from "./components/ui/sonner";
import { Storefront } from "./components/Storefront";
import { Popup } from "./components/Popup";
import { Dashboard } from "./components/Dashboard";
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  seedIfEmpty,
  type Settings,
} from "./lib/db";

type View = "store" | "dashboard";

export default function App() {
  const [view, setView] = useState<View>("store");
  const [popupOpen, setPopupOpen] = useState(true);
  const [scoredCount, setScoredCount] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // Bump to force the dashboard to re-read IndexedDB when reopened.
  const [, setViewTick] = useState(0);

  useEffect(() => {
    seedIfEmpty();
    getSettings().then(setSettings);
  }, []);

  // Update one module and persist the whole settings object locally.
  function updateSetting(key: keyof Settings, value: boolean) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#eceef1]">
      {view === "store" ? (
        <div className="h-full w-full overflow-auto">
          <Storefront
            diabetesModule={settings.diabetes}
            hypertensionModule={settings.hypertension}
            cardiovascularModule={settings.cardiovascular}
            onScored={setScoredCount}
            onViewRecorded={() => setViewTick((t) => t + 1)}
          />
        </div>
      ) : (
        <div className="h-full w-full overflow-auto">
          <Dashboard onBack={() => setView("store")} />
        </div>
      )}

      {/* Floating browser-action popup, anchored top-right like a real toolbar. */}
      {view === "store" && (
        <div className="absolute right-4 top-4 z-40">
          {popupOpen ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPopupOpen(false)}
                aria-label="Close popup"
                className="absolute -left-3 -top-3 z-50 grid size-7 place-items-center rounded-full bg-white shadow ring-1 ring-black/10"
              >
                <X size={14} aria-hidden />
              </button>
              <Popup
                siteActive
                siteName="Naivas.co.ke"
                scoredCount={scoredCount}
                diabetesModule={settings.diabetes}
                hypertensionModule={settings.hypertension}
                cardiovascularModule={settings.cardiovascular}
                onToggleDiabetes={(v) => updateSetting("diabetes", v)}
                onToggleHypertension={(v) => updateSetting("hypertension", v)}
                onToggleCardiovascular={(v) => updateSetting("cardiovascular", v)}
                onOpenDashboard={() => setView("dashboard")}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPopupOpen(true)}
              className="grid size-11 place-items-center rounded-full shadow-lg ring-1 ring-black/10"
              style={{ backgroundColor: "var(--ns-grade-a)", color: "#fff" }}
              aria-label="Open NutriScore popup"
            >
              <span style={{ fontWeight: 700 }}>N</span>
            </button>
          )}
        </div>
      )}

      <Toaster position="bottom-center" />
    </div>
  );
}
