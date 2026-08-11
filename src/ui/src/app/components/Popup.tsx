import { BarChart3 } from "lucide-react";

interface PopupProps {
  siteActive: boolean;
  siteName: string;
  scoredCount: number;
  onOpenDashboard: () => void;
}

// The browser-action popup — shrink-to-fit its content with rounded corners.
// Health warning controls have been migrated to the Shopping Analytics dashboard.
export function Popup({
  siteActive,
  siteName,
  scoredCount,
  onOpenDashboard,
}: PopupProps) {
  return (
    <div
      className="overflow-hidden rounded-xl bg-white"
      style={{ width: "max-content", minWidth: 280, maxWidth: 360 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <div
          className="grid size-8 place-items-center rounded-lg"
          style={{ backgroundColor: "var(--ns-grade-a)", color: "#fff" }}
        >
          <span style={{ fontWeight: 700 }}>N</span>
        </div>
        <div>
          <p style={{ fontWeight: 600, fontSize: "0.95rem" }}>NutriScore</p>
          <p style={{ fontSize: "0.72rem", color: "var(--muted-foreground)" }}>
            Checkout Tool · NUT-04
          </p>
        </div>
      </div>

      {/* Status indicator */}
      <div className="mx-4 flex items-center gap-2 rounded-lg bg-[#f6f7f9] px-3 py-2">
        <span
          className={siteActive ? "ns-pulse" : ""}
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: siteActive
              ? "var(--ns-grade-a)"
              : "var(--muted-foreground)",
          }}
          aria-hidden
        />
        <span style={{ fontSize: "0.82rem" }}>
          {siteActive ? `Active on ${siteName}` : "Not a supported store"}
        </span>
      </div>

      {/* Session metrics */}
      <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-black/5 px-3 py-2.5">
        <span style={{ fontSize: "0.82rem", color: "var(--muted-foreground)" }}>
          Items scored on this page
        </span>
        <span style={{ fontWeight: 700, fontSize: "1.05rem" }}>
          {scoredCount}
        </span>
      </div>

      {/* Action button */}
      <div className="p-4">
        <button
          type="button"
          onClick={onOpenDashboard}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          style={{ backgroundColor: "var(--primary)" }}
        >
          <BarChart3 size={16} aria-hidden />
          <span style={{ fontSize: "0.88rem" }}>View Shopping Analytics</span>
        </button>
      </div>
    </div>
  );
}
