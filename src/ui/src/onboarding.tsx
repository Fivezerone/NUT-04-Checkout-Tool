import * as React from "react";
// @ts-ignore
window.React = React;
import { createRoot } from "react-dom/client";
import { BlueThemeProvider } from "./app/context/BlueThemeProvider";
import { OnboardingWizard, type WizardMode } from "./app/components/OnboardingWizard";
import "./styles/index.css";

function OnboardingRoot() {
  // Read the ?mode= URL parameter to determine whether to show the
  // sign-up wizard, the login modal, or jump directly to payment (renew).
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get("mode");
  const mode: WizardMode =
    rawMode === "login" || rawMode === "renew" ? rawMode : "signup";

  return (
    <BlueThemeProvider>
      <OnboardingWizard initialMode={mode} />
    </BlueThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<OnboardingRoot />);
