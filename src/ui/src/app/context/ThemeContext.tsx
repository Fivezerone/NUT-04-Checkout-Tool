import React, { createContext, useContext, useState, useEffect } from "react";
import { getSettings, saveSettings } from "../lib/db";

declare var chrome: any;

export type ThemeType = "diabetes" | "hypertension" | "kidney" | "obesity" | "general";

interface ThemeContextType {
  activeTheme: ThemeType;
  setTheme: (theme: ThemeType) => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [activeTheme, setActiveThemeState] = useState<ThemeType>(() => {
    // Synchronously read from localStorage for instant initial render
    const cached = localStorage.getItem("nutriscore_theme") as ThemeType;
    return cached || "general";
  });

  // Fetch true persisted state from IDB on mount
  useEffect(() => {
    async function init() {
      try {
        const settings = await getSettings();
        if (settings.activeTheme && settings.activeTheme !== activeTheme) {
          applyTheme(settings.activeTheme);
        }
      } catch (err) {
        console.warn("Failed to load theme from DB", err);
      }
    }
    init();
  }, []);

  const applyTheme = (theme: ThemeType) => {
    setActiveThemeState(theme);
    localStorage.setItem("nutriscore_theme", theme);
    document.documentElement.setAttribute("data-health-condition", theme);
    
    // Sync with IDB in background
    getSettings().then(settings => {
      saveSettings({ ...settings, activeTheme: theme }).catch(console.warn);
    }).catch(console.warn);

    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: "THEME_CHANGED", theme }).catch(() => {});
    }
  };

  const setTheme = (theme: ThemeType) => {
    applyTheme(theme);
  };

  return (
    <ThemeContext.Provider value={{ activeTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
