import React, { createContext, useContext, useState, useEffect } from "react";
import { MultiLayerStorage } from "../../../../shared/storage";

export type ThemeType = "diabetes" | "hypertension" | "kidney" | "obesity" | "general";

interface ThemeContextType {
  activeTheme: ThemeType;
  setTheme: (theme: ThemeType) => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [activeTheme, setActiveThemeState] = useState<ThemeType>("general");

  // Fetch true persisted state from MultiLayerStorage on mount
  useEffect(() => {
    MultiLayerStorage.getLive().then(live => {
      const theme = live.uiTheme || "general";
      setActiveThemeState(theme as ThemeType);
      document.documentElement.setAttribute("data-health-condition", theme);
    });

    // Reactive Event Bus - Decoupled Reader (strictly listening to settings_live)
    const unsubscribe = MultiLayerStorage.subscribeLive((newLive) => {
      if (newLive && newLive.uiTheme) {
        setActiveThemeState(newLive.uiTheme as ThemeType);
        document.documentElement.setAttribute("data-health-condition", newLive.uiTheme);
      }
    });

    return unsubscribe;
  }, []);

  const setTheme = (theme: ThemeType) => {
    // Note: Mutators now use updateDraft and commitDraftToLive directly,
    // this local method is mostly for internal contextual convenience
    MultiLayerStorage.updateDraft({ uiTheme: theme });
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
