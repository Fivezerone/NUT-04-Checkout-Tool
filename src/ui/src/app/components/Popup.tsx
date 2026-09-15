import { BarChart3 } from "lucide-react";

interface PopupProps {
  siteActive: boolean;
  siteName: string;
  scoredCount: number;
  totalCount?: number;
  onOpenDashboard: () => void;
}

// The browser-action popup — shrink-to-fit its content with rounded corners. Health warning controls have been migrated to the Shopping Analytics dashboard.
export function Popup({
  siteActive,
  siteName,
  scoredCount,
  totalCount,
  onOpenDashboard,
}: PopupProps) {
  return (
    <div className="p-3">
      <div
        className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-slate-100"
        style={{ width: "max-content", minWidth: 280, maxWidth: 360 }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pb-3 pt-4 border-b border-slate-50">
          <div
            className="grid size-8 place-items-center rounded-lg shadow-sm"
            style={{ backgroundColor: "var(--ns-grade-a)", color: "#fff" }}
          >
            <span style={{ fontWeight: 800 }}>N</span>
          </div>
          <div>
            <p className="text-slate-800" style={{ fontWeight: 800, fontSize: "1.05rem", paddingLeft: "2px" }}>NutriScore</p>
          </div>
        </div>

        {/* Status indicator */}
        <div className="mx-4 mt-4 flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 border border-slate-100">
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
          <span className="text-slate-700 font-medium" style={{ fontSize: "0.82rem" }}>
            {siteActive ? `Active on ${siteName}` : "Not a supported store"}
          </span>
        </div>

        {/* Session metrics */}
        <div className="mx-4 mt-3 flex items-center justify-center rounded-xl border border-slate-100 px-3 py-3 shadow-sm bg-white">
          <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)", fontWeight: 500 }}>
            <span style={{ fontWeight: 800, color: "var(--foreground)" }}>{scoredCount}</span>
            {(totalCount ?? 0) > 0 ? ` of ${totalCount} items graded` : " items graded"}
          </span>
        </div>

        {/* Action button */}
        <div className="p-4 pt-5">
          <button
            type="button"
            onClick={onOpenDashboard}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-white transition-all hover:opacity-90 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black font-semibold tracking-wide"
            style={{ backgroundColor: "var(--primary)" }}
          >
            <BarChart3 size={16} aria-hidden />
            <span style={{ fontSize: "0.88rem" }}>View Shopping Analytics</span>
          </button>
        </div>
      </div>
    </div>
  );
}
