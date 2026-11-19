import * as React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./app/context/ThemeContext";
import { Options } from "./options/Options";
import "./styles/index.css";

function OptionsRoot() {
  return (
    <ThemeProvider>
      <Options />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<OptionsRoot />);
