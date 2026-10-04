import * as React from "react";
// @ts-ignore
window.React = React;
import { createRoot } from "react-dom/client";
import { BlueThemeProvider } from "./app/context/BlueThemeProvider";
import { Options } from "./options/Options";
import "./styles/index.css";

function OptionsRoot() {
  return (
    <BlueThemeProvider>
      <Options />
    </BlueThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<OptionsRoot />);
