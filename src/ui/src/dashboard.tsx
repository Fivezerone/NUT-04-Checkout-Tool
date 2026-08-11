import * as React from "react";
// @ts-ignore
window.React = React;
import { createRoot } from "react-dom/client";
import { Dashboard } from "./app/components/Dashboard";
import { Toaster } from "sonner";
import "./styles/index.css";

function DashboardRoot() {
  return (
    <div className="bg-[#eceef1] min-h-screen overflow-auto">
      <Dashboard onBack={() => window.close()} />
      <Toaster position="bottom-center" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<DashboardRoot />);
