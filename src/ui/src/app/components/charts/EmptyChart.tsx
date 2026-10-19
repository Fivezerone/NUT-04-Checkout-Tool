/**
 * D-25: Shared empty-state component for charts.
 * Renders an accessible SVG with a centred message instead of a blank disc,
 * empty grid, or silent nothing. Used by DonutChart, LineTrend, HBarChart,
 * StackedHBarChart when their data is all-zero or empty.
 */
export function EmptyChart({
  w,
  h,
  msg,
}: {
  w: number;
  h: number;
  msg: string;
}) {
  return (
    <svg
      width={w}
      height={h}
      role="img"
      aria-label={msg}
    >
      <text
        x={w / 2}
        y={h / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={12}
        fill="var(--muted-foreground, #94a3b8)"
      >
        {msg}
      </text>
    </svg>
  );
}

/** Type-safe finite number guard (rejects NaN and Infinity) */
export const isFiniteNum = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
