// Lightweight, dependency-free SVG charts. Built in-house to avoid Recharts' internal duplicate-key warning (unresolved in 2.15.x) and to keep full control over rendering keys.

import { useRef, type MouseEvent } from "react";
import { EmptyChart, isFiniteNum } from "./EmptyChart";

interface Size {
  width: number;
  height: number;
}

const finiteNonNegative = (v: unknown) => { 
  const n = Number(v); 
  return Number.isFinite(n) && n > 0 ? n : 0; 
};

// ---------- Donut ----------

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  data: rawData,
  size,
  selectedId,
  onSelect,
}: {
  data: DonutSlice[];
  size: Size;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const data = rawData.map(s => ({ ...s, value: finiteNonNegative(s.value) }));
  const { width, height } = size;
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.max(10, Math.min(cx, cy) - 8);
  const inner = r * 0.48;

  const selected = data.find((d) => d.id === selectedId && d.value > 0) ?? null;

  // Center label: shows the selected segment's count, else the total.
  // WCAG 2.2 AA: strict 12px font floor.
  const centerLabel = (
    <>
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontSize={22}
        fontWeight={700}
        fill={selected ? selected.color : "var(--color-text-strong, var(--foreground))"}
      >
        {selected ? selected.value : total}
      </text>
      <text
        x={cx}
        y={cy + 16}
        textAnchor="middle"
        fontSize={12}
        fill="var(--color-text-muted, var(--muted-foreground))"
      >
        {selected ? `${selected.label} items` : "total items"}
      </text>
    </>
  );

  // D-25: replace blank grey disc with accessible empty state message
  if (total === 0 || !data.some(d => isFiniteNum(d.value) && d.value > 0)) {
    return <EmptyChart w={width} h={height} msg="No graded items yet" />;
  }

  const nonZero = data.filter((d) => d.value > 0);

  // Single non-zero slice -> full ring (arcs can't draw a 360° path).
  if (nonZero.length === 1) {
    const only = nonZero[0];
    const isSel = selectedId === only.id;
    return (
      <div className="flex flex-col items-center">
        <svg width={width} height={height} role="img" aria-label="Basket quality">
          <circle
            cx={cx}
            cy={cy}
            r={(r + inner) / 2}
            fill="none"
            stroke={only.color}
            strokeWidth={r - inner}
            opacity={selectedId && !isSel ? 0.35 : 1}
            style={{ cursor: onSelect ? "pointer" : "default" }}
            onClick={() => onSelect?.(only.id)}
          />
          {centerLabel}
        </svg>
        <details className="mt-2 text-[12px] text-muted w-full text-left">
          <summary className="cursor-pointer hover:underline">Show data table</summary>
          <table className="w-full mt-1 border border-border-control/20 rounded text-[12px]">
            <tbody>
              <tr>
                <td className="p-1 font-medium">{only.label}</td>
                <td className="p-1 text-right font-semibold">{only.value} items (100%)</td>
              </tr>
            </tbody>
          </table>
        </details>
      </div>
    );
  }

  let angle = -Math.PI / 2;
  const arcs = nonZero.map((d) => {
    const frac = d.value / total;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    const large = end - start > Math.PI ? 1 : 0;
    // Selected segment pops out slightly.
    const isSel = selectedId === d.id;
    const mid = (start + end) / 2;
    const offset = isSel ? 6 : 0;
    const ox = Math.cos(mid) * offset;
    const oy = Math.sin(mid) * offset;
    const x0 = cx + ox + r * Math.cos(start);
    const y0 = cy + oy + r * Math.sin(start);
    const x1 = cx + ox + r * Math.cos(end);
    const y1 = cy + oy + r * Math.sin(end);
    const xi1 = cx + ox + inner * Math.cos(end);
    const yi1 = cy + oy + inner * Math.sin(end);
    const xi0 = cx + ox + inner * Math.cos(start);
    const yi0 = cy + oy + inner * Math.sin(start);
    const path = [
      `M ${x0} ${y0}`,
      `A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`,
      `L ${xi1} ${yi1}`,
      `A ${inner} ${inner} 0 ${large} 0 ${xi0} ${yi0}`,
      "Z",
    ].join(" ");
    return { id: d.id, label: d.label, path, color: d.color, isSel, value: d.value, pct: Math.round(frac * 100) };
  });

  return (
    <div className="flex flex-col items-center">
      <svg width={width} height={height} role="img" aria-label="Basket quality">
        {arcs.map((a) => (
          <path
            key={a.id}
            d={a.path}
            fill={a.color}
            stroke="#fff"
            strokeWidth={2}
            opacity={selectedId && !a.isSel ? 0.35 : 1}
            style={{ cursor: onSelect ? "pointer" : "default", transition: "opacity 0.15s", outline: "none" }}
            onClick={() => onSelect?.(a.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(a.id);
              }
            }}
            tabIndex={onSelect ? 0 : -1}
            role={onSelect ? "button" : undefined}
            aria-label={onSelect ? `Show count for ${a.label}` : undefined}
          />
        ))}
        {centerLabel}
      </svg>
      <details className="mt-2 text-[12px] text-muted w-full text-left">
        <summary className="cursor-pointer hover:underline">Show data table</summary>
        <table className="w-full mt-1 border border-border-control/20 rounded text-[12px]">
          <tbody>
            {arcs.map((a) => (
              <tr key={a.id} className="border-b border-border-control/10 last:border-0">
                <td className="p-1 font-medium">{a.label}</td>
                <td className="p-1 text-right font-semibold">{a.value} items ({a.pct}%)</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ---------- Line trend ----------

export interface TrendPoint {
  id: string;
  label: string;
  ts?: number;
  sodium: number;   // mg average for this bucket
  sugar: number;    // g  average for this bucket
  satFat: number;   // g  average for this bucket
  hasData?: boolean;
}

// Daily Value reference amounts (FDA 2000 kcal/day baseline)
const DV = { sodium: 2300, sugar: 50, satFat: 20 } as const;

// D-26: neutral chart tokens — never use grade colours for risk nutrients
const TREND_SERIES = [
  { key: "sodium" as const, label: "Sodium",  color: "var(--color-chart-1, var(--chart-1, #3b82f6))", dash: "0" },
  { key: "sugar"  as const, label: "Sugar",   color: "var(--color-chart-2, var(--chart-2, #f59e0b))", dash: "6 4" },
  { key: "satFat" as const, label: "Sat Fat", color: "var(--color-chart-3, var(--chart-3, #8b5cf6))", dash: "2 3" },
] satisfies { key: "sodium" | "sugar" | "satFat"; label: string; color: string; dash: string }[];

// Monotone cubic Hermite interpolation
function monotonePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const n = pts.length;
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    delta[i] = (pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x);
  }
  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (delta[i - 1] + delta[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const h = Math.sqrt(a * a + b * b);
    if (h > 3) { m[i] = (3 / h) * a * delta[i]; m[i + 1] = (3 / h) * b * delta[i]; }
  }
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1].x - pts[i].x) / 3;
    const cp1x = pts[i].x + dx, cp1y = pts[i].y + m[i] * dx;
    const cp2x = pts[i + 1].x - dx, cp2y = pts[i + 1].y - m[i + 1] * dx;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${pts[i+1].x.toFixed(2)} ${pts[i+1].y.toFixed(2)}`;
  }
  return d;
}

export function LineTrend({
  data: rawData, size,
  showSodium = true, showSugar = true, showSatFat = false,
  primaryKey = "sodium",
}: {
  data: TrendPoint[];
  size: Size;
  showSodium?: boolean;
  showSugar?: boolean;
  showSatFat?: boolean;
  /** Which series is the primary (solid thick) line; others are dashed secondary. */
  primaryKey?: "sodium" | "sugar" | "satFat";
}) {
  const data = rawData.map(s => ({
    ...s,
    sodium: finiteNonNegative(s.sodium),
    sugar: finiteNonNegative(s.sugar),
    satFat: finiteNonNegative(s.satFat)
  }));
  const { width, height } = size;
  const padL = 48, padR = 16, padT = 16, padB = 32;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = Math.max(1, height - padT - padB);
  const MAX_PCT = 150;

  const toPct = (key: "sodium" | "sugar" | "satFat", val: number) =>
    Math.min(MAX_PCT, (val / DV[key]) * 100);

  const x = (i: number) =>
    data.length <= 1
      ? padL
      : padL + (i / (data.length - 1)) * plotW;

  const y = (pct: number) => padT + plotH - (pct / MAX_PCT) * plotH;

  const xStride = Math.max(1, Math.ceil(data.length / 8));

  const visibleSeries = TREND_SERIES.filter((s) => {
    if (s.key === "sodium") return showSodium;
    if (s.key === "sugar")  return showSugar;
    if (s.key === "satFat") return showSatFat;
    return true;
  });

  const buildPath = (key: "sodium" | "sugar" | "satFat"): string => {
    if (data.length === 0) return "";

    const filled = data.map((d, i) => {
      const hasReal = d.hasData !== false && d[key] > 0;
      return {
        x: x(i),
        y: hasReal ? y(toPct(key, d[key])) : y(0),
      };
    });

    if (filled.every(p => p.y === y(0))) return "";

    return monotonePath(filled);
  };

  const Y_TICKS = [0, 50, 100];
  const tooltipRef = useRef<SVGGElement>(null);
  const boxW = 150;

  const handleMove = (e: MouseEvent<SVGRectElement>) => {
    if (data.length === 0 || !tooltipRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + padL;
    let nearest = 0, best = Infinity;
    for (let i = 0; i < data.length; i++) {
      const dist = Math.abs(x(i) - px);
      if (dist < best) { best = dist; nearest = i; }
    }
    tooltipRef.current.style.display = "block";
    const hx = x(nearest);
    const boxX = Math.min(Math.max(hx + 8, padL), width - boxW - 4);
    const line = tooltipRef.current.querySelector(".ch-line");
    if (line) { line.setAttribute("x1", String(hx)); line.setAttribute("x2", String(hx)); }
    const box = tooltipRef.current.querySelector(".ch-box");
    if (box) box.setAttribute("x", String(boxX));
    const title = tooltipRef.current.querySelector(".ch-title");
    if (title) { title.setAttribute("x", String(boxX + 8)); title.textContent = data[nearest].label; }
    visibleSeries.forEach((s) => {
      const rawPct = toPct(s.key, data[nearest][s.key]);
      const pnt = tooltipRef.current!.querySelector(`.ch-pnt-${s.key}`);
      if (pnt) { pnt.setAttribute("cx", String(hx)); pnt.setAttribute("cy", String(y(rawPct))); }
      const lcirc = tooltipRef.current!.querySelector(`.ch-lcirc-${s.key}`);
      if (lcirc) lcirc.setAttribute("cx", String(boxX + 12));
      const lname = tooltipRef.current!.querySelector(`.ch-lname-${s.key}`);
      if (lname) lname.setAttribute("x", String(boxX + 20));
      const lval = tooltipRef.current!.querySelector(`.ch-lval-${s.key}`);
      if (lval) {
        const rawPctUnclamped = (data[nearest][s.key] / DV[s.key]) * 100;
        const hasDataPt = data[nearest].hasData !== false && data[nearest][s.key] > 0;
        lval.setAttribute("x", String(boxX + boxW - 8));
        lval.textContent = !hasDataPt
          ? 'No purchases'
          : rawPctUnclamped > MAX_PCT
            ? `${Math.round(rawPctUnclamped)}% DV ⚠`
            : `${Math.round(rawPctUnclamped)}% DV`;
      }
    });
  };

  const handleLeave = () => { if (tooltipRef.current) tooltipRef.current.style.display = "none"; };

  const hasAnyData = data.some(d =>
    (isFiniteNum(d.sodium) && d.sodium > 0) ||
    (isFiniteNum(d.sugar) && d.sugar > 0) ||
    (isFiniteNum(d.satFat) && d.satFat > 0)
  );
  if (data.length === 0 || !hasAnyData) {
    return <EmptyChart w={width} h={height} msg="No nutrient data for this period" />;
  }

  return (
    <div className="flex flex-col">
      <svg width={width} height={height} role="img" aria-label="Nutrient trends (% Daily Value)">
        {/* Y-axis gridlines + labels (strictly 12px font) */}
        {Y_TICKS.map((pct) => {
          const gy = y(pct);
          return (
            <g key={`grid-${pct}`}>
              <line x1={padL} y1={gy} x2={width - padR} y2={gy}
                stroke={pct === 0 ? "var(--color-border-control, #ccc)" : pct === 100 ? "var(--color-status-warning, #f9a825)" : "var(--color-border-control, #eee)"}
                strokeWidth={pct === 100 ? 1.5 : 1}
                strokeDasharray={pct === 0 ? undefined : pct === 100 ? "6 3" : "3 3"} />
              <text x={padL - 6} y={gy + 4} fontSize={12} textAnchor="end"
                fill={pct === 100 ? "var(--color-status-warning, #f9a825)" : "var(--color-text-muted, var(--muted-foreground))"}
                fontWeight={pct === 100 ? 700 : 400}>{pct}%</text>
            </g>
          );
        })}
        <text x={width - padR} y={y(100) - 6} fontSize={12} textAnchor="end"
          fill="var(--color-status-warning, #f9a825)" opacity={0.85}>Daily limit</text>

        {/* Subtle area fill — primary series only */}
        {visibleSeries
          .filter(s => s.key === primaryKey)
          .map((s) => {
            const pathD = buildPath(s.key);
            if (!pathD) return null;
            return (
              <path key={`fill-${s.key}`}
                d={`${pathD} L ${x(data.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`}
                fill={s.color} opacity={0.08} />
            );
          })}

        {visibleSeries.map((s) => {
          const pathD = buildPath(s.key);
          if (!pathD) return null;
          const isPrimary = s.key === primaryKey;
          return (
            <path key={s.key} d={pathD}
              fill="none"
              stroke={s.color}
              strokeWidth={isPrimary ? 2.5 : 1.5}
              strokeDasharray={isPrimary ? undefined : s.dash}
              opacity={isPrimary ? 1 : 0.8} />
          );
        })}

        {/* X-axis date labels */}
        {data.map((d, i) => {
          if (i % xStride !== 0 && i !== data.length - 1) return null;
          return (
            <text key={d.id} x={x(i)} y={height - 8}
              fontSize={12} textAnchor="middle" fill="var(--color-text-muted, var(--muted-foreground))">{d.label}</text>
          );
        })}

        {/* Tooltip */}
        <g ref={tooltipRef} style={{ display: "none", pointerEvents: "none" }}>
          <line className="ch-line" y1={padT} y2={padT + plotH} stroke="var(--color-text-muted, var(--muted-foreground))" strokeWidth={1} strokeDasharray="2 2" />
          <rect className="ch-box" y={padT} width={boxW} height={20 + visibleSeries.length * 20}
            rx={8} fill="var(--color-surface, #fff)" stroke="var(--color-border-control, #e2e8f0)" strokeWidth={1} />
          <text className="ch-title" y={padT + 16} fontSize={12} fontWeight={700} fill="var(--color-text-strong, var(--foreground))" />
          {visibleSeries.map((s, idx) => {
            const rowY = padT + 34 + idx * 18;
            return (
              <g key={`tip-${s.key}`}>
                <circle className={`ch-pnt-${s.key}`} r={4} fill={s.color} stroke="#fff" strokeWidth={1.5} />
                <circle className={`ch-lcirc-${s.key}`} cy={rowY - 4} r={3} fill={s.color} />
                <text className={`ch-lname-${s.key}`} y={rowY} fontSize={12} fill="var(--color-text-muted, var(--muted-foreground))">{s.label}</text>
                <text className={`ch-lval-${s.key}`} y={rowY} fontSize={12} fontWeight={700} textAnchor="end" fill="var(--color-text-strong, var(--foreground))" />
              </g>
            );
          })}
        </g>

        <rect x={padL} y={padT} width={plotW} height={plotH}
          fill="transparent" onMouseMove={handleMove} onMouseLeave={handleLeave} />
      </svg>

      <details className="mt-2 text-[12px] text-muted w-full text-left">
        <summary className="cursor-pointer hover:underline">Show data table</summary>
        <table className="w-full mt-1 border border-border-control/20 rounded text-[12px]">
          <thead>
            <tr className="border-b border-border-control/20 bg-surface-raised/50">
              <th className="p-1 text-left">Time</th>
              {showSodium && <th className="p-1 text-right">Sodium (mg)</th>}
              {showSugar && <th className="p-1 text-right">Sugar (g)</th>}
              {showSatFat && <th className="p-1 text-right">Sat Fat (g)</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id} className="border-b border-border-control/10 last:border-0">
                <td className="p-1 font-medium">{d.label}</td>
                {showSodium && <td className="p-1 text-right">{d.sodium > 0 ? `${d.sodium} mg` : '—'}</td>}
                {showSugar && <td className="p-1 text-right">{d.sugar > 0 ? `${d.sugar} g` : '—'}</td>}
                {showSatFat && <td className="p-1 text-right">{d.satFat > 0 ? `${d.satFat} g` : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ---------- Horizontal bars ----------

export interface HBar {
  id: string;
  label: string;
  value: number;
  color: string;
}

export function HBarChart({ data: rawData, size }: { data: HBar[]; size: Size }) {
  const data = rawData.map(s => ({ ...s, value: finiteNonNegative(s.value) }));
  const { width, height } = size;
  const labelW = 150;
  const gap = 8;
  const barH = data.length > 0 ? (height - gap * (data.length + 1)) / data.length : 0;
  const plotW = Math.max(1, width - labelW - 40);
  const maxVal = Math.max(1, ...data.map((d) => d.value));

  return (
    <svg width={width} height={height} role="img" aria-label="Category insights">
      {data.map((d, i) => {
        const barW = (d.value / maxVal) * plotW;
        const yTop = gap + i * (barH + gap);
        return (
          <g key={d.id}>
            <text x={labelW - 8} y={yTop + barH / 2 + 4} fontSize={12} textAnchor="end" fill="var(--color-text-strong, var(--foreground))">{d.label}</text>
            <rect x={labelW} y={yTop} width={barW} height={barH} fill={d.color} rx={2} />
          </g>
        );
      })}
    </svg>
  );
}

// ---------- Stacked horizontal bars — Category Insights ----------

export interface StackedHBarSegment {
  grade: string;    // "A" | "B" | "C" | "D" | "E"
  price: number;    // total KES spent on items of this grade in this category
  color: string;
}

export interface StackedHBar {
  id: string;
  label: string;
  totalPrice: number;
  segments: StackedHBarSegment[];
}

const AXIS_TICKS = [0.25, 0.5, 0.75, 1.0];

export function StackedHBarChart({ data, size }: { data: StackedHBar[]; size: Size }) {
  const { width, height } = size;
  const labelW = 148;
  const valueW = 86;
  const axisH = 24;
  const gap = 8;
  const plotW = Math.max(1, width - labelW - valueW);
  const usableH = height - axisH;
  const barH = data.length > 0
    ? Math.max(18, (usableH - gap * (data.length + 1)) / data.length)
    : 0;
  const maxVal = Math.max(1, ...data.map((d) => d.totalPrice));

  return (
    <svg width={width} height={height} role="img" aria-label="Category spend by grade">
      {AXIS_TICKS.map((t) => {
        const x = labelW + t * plotW;
        const kes = Math.round(t * maxVal);
        const label = t === 1.0 ? `KES ${kes.toLocaleString()}` : kes.toLocaleString();
        return (
          <g key={t}>
            <line x1={x} y1={gap} x2={x} y2={usableH}
              stroke="var(--color-border-control, var(--muted-foreground))" strokeOpacity={0.2}
              strokeWidth={1} strokeDasharray="3 3" />
            <text x={x} y={usableH + 16} fontSize={12} textAnchor="middle" fill="var(--color-text-muted, var(--muted-foreground))">
              {label}
            </text>
          </g>
        );
      })}
      <line x1={labelW} y1={usableH} x2={labelW + plotW} y2={usableH}
        stroke="var(--color-border-control, var(--muted-foreground))" strokeOpacity={0.25} strokeWidth={1} />
      {data.map((d, i) => {
        const yTop = gap + i * (barH + gap);
        const totalBarW = (d.totalPrice / maxVal) * plotW;
        let segX = labelW;
        return (
          <g key={d.id}>
            <text x={labelW - 8} y={yTop + barH / 2 + 4} fontSize={12} textAnchor="end" fill="var(--color-text-strong, var(--foreground))">
              {d.label}
            </text>
            <clipPath id={`clip-${d.id}`}>
              <rect x={labelW} y={yTop} width={Math.max(0, totalBarW)} height={Math.max(2, barH)} rx={4} />
            </clipPath>
            <g clipPath={`url(#clip-${d.id})`}>
              {d.segments.map((seg) => {
                const segW = (seg.price / maxVal) * plotW;
                if (segW < 0.5) return null;
                const x = segX;
                segX += segW;
                return (
                  <g key={seg.grade}>
                    <rect x={x} y={yTop} width={segW} height={Math.max(2, barH)} fill={seg.color} />
                    {segW > 16 && (
                      <text x={x + segW / 2} y={yTop + barH / 2 + 4.5}
                        fontSize={12} fontWeight={900} textAnchor="middle"
                        fill="#ffffff"
                        style={{ 
                          pointerEvents: "none",
                          textShadow: "0px 1px 2px rgba(0,0,0,0.5), 0px 0px 1px rgba(0,0,0,0.3)"
                        }}>
                        {seg.grade.toUpperCase()}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
            {d.totalPrice > 0 && (
              <text x={labelW + totalBarW + 6} y={yTop + barH / 2 + 4} fontSize={12} fill="var(--color-text-muted, var(--muted-foreground))">
                {`KES ${d.totalPrice.toLocaleString()}`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
