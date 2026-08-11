import * as React from "react";
// @ts-ignore
window.React = React;
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Popup } from "./app/components/Popup";
import "./styles/index.css";

function PopupRoot() {
  const [siteActive, setSiteActive] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [scoredCount, setScoredCount] = useState(0);

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id && tab.url) {
          const url = new URL(tab.url);
          chrome.tabs.sendMessage(tab.id, { action: "GET_PAGE_STATS" }, (response) => {
            if (chrome.runtime.lastError) {
              setSiteActive(false);
            } else if (response) {
              setSiteActive(true);
              const hostname = url.hostname.replace("www.", "");
              setSiteName(hostname);
              setScoredCount(response.count || 0);
            }
          });
        }
      });
    }
  }, []);

  return (
    <Popup
      siteActive={siteActive}
      siteName={siteName}
      scoredCount={scoredCount}
      onOpenDashboard={() => chrome.runtime.openOptionsPage()}
    />
  );
}

createRoot(document.getElementById("root")!).render(<PopupRoot />);
