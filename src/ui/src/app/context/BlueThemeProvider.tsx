import React, { useEffect, useState } from "react";
import { ThemeContext, ThemeType } from "./ThemeContext";

export function BlueThemeProvider({ children }: { children: React.ReactNode }) {
  const [activeTheme, setActiveTheme] = useState<ThemeType>("general");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "blue");
    document.documentElement.removeAttribute("data-health-condition");
  }, []);

  return (
    <ThemeContext.Provider value={{ activeTheme, setTheme: setActiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
