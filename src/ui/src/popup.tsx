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
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    function fetchStats() {
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
                setTotalCount(response.total || 0);
              }
            });
          }
        });
      }
    }

    fetchStats();

    const listener = (msg: any) => {
      if (msg.action === "POPUP_STATS_UPDATE") {
        fetchStats();
      }
    };
    
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(listener);
    }

    return () => {
      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(listener);
      }
    };
  }, []);

  return (
    <Popup
      siteActive={siteActive}
      siteName={siteName}
      scoredCount={scoredCount}
      totalCount={totalCount}
      onOpenDashboard={() => chrome.runtime.openOptionsPage()}
    />
  );
}

createRoot(document.getElementById("root")!).render(<PopupRoot />);
