import * as React from "react";
// @ts-ignore
window.React = React;
import { createRoot } from "react-dom/client";
import { BlueThemeProvider } from "./app/context/BlueThemeProvider";
import { OnboardingWizard, type WizardMode } from "./app/components/OnboardingWizard";
import "./styles/index.css";

function OnboardingRoot() {
  return (
    <BlueThemeProvider>
      <OnboardingWizard />
    </BlueThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<OnboardingRoot />);
