// Lightweight, dependency-free SVG charts. Built in-house to avoid Recharts'
// internal duplicate-key warning (unresolved in 2.15.x) and to keep full
// control over rendering keys.

import { useState } from "react";

interface Size {
  width: number;
  height: number;
}

// ---------- Donut ----------

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  data,
  size,
  selectedId,
  onSelect,
}: {
  data: DonutSlice[];
  size: Size;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const { width, height } = size;
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.max(10, Math.min(cx, cy) - 8);
  const inner = r * 0.55;

  const selected = data.find((d) => d.id === selectedId && d.value > 0) ?? null;

  // Center label: shows the selected segment's count, else the total.
  const centerLabel = (
    <>
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontSize={22}
        fontWeight={700}
        fill={selected ? selected.color : "var(--foreground)"}
      >
        {selected ? selected.value : total}
      </text>
      <text
        x={cx}
        y={cy + 16}
        textAnchor="middle"
        fontSize={10}
        fill="var(--muted-foreground)"
      >
        {selected ? `${selected.label} items` : "total items"}
      </text>
    </>
  );

  if (total === 0) {
    return (
      <svg width={width} height={height}>
        <circle cx={cx} cy={cy} r={r} fill="#f2f2f2" />
      </svg>
    );
  }

  const nonZero = data.filter((d) => d.value > 0);

  // Single non-zero slice -> full ring (arcs can't draw a 360° path).
  if (nonZero.length === 1) {
    const only = nonZero[0];
    const isSel = selectedId === only.id;
    return (
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
    return { id: d.id, label: d.label, path, color: d.color, isSel };
  });

  return (
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
  );
}

// ---------- Line trend ----------

export interface TrendPoint {
  id: string;
  label: string;
  ts?: number;
  sodium: number;
  sugar: number;
  satFat: number;
  hasData?: boolean; // false = empty bucket (rendered as zero, visually dimmed)
}

// Static series config — declared once so it isn't rebuilt on every render.
const TREND_SERIES = [
  { key: "sodium" as const,  label: "Sodium",   unit: "mg", color: "var(--ns-grade-d)" },
  { key: "sugar"  as const,  label: "Sugar",    unit: "g",  color: "var(--ns-grade-e)" },
  { key: "satFat" as const,  label: "Sat Fat",  unit: "g",  color: "var(--ns-grade-a)" },
];

/** Round v up to the nearest "nice" number (1, 2, 5, 10, 20, 50 …). */
function niceMax(v: number): number {
  if (v <= 0) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const ceil = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return ceil * exp;
}

export function LineTrend({
  data,
  size,
  showSodium = true,
  showSugar = true,
  showSatFat = true,
}: {
  data: TrendPoint[];
  size: Size;
  /** Hypertension toggle — hides the Sodium line when false. */
  showSodium?: boolean;
  /** Diabetes toggle — hides the Sugar line when false. */
  showSugar?: boolean;
  /** Cardiovascular toggle — hides the Sat Fat line when false. */
  showSatFat?: boolean;
}) {
  const { width, height } = size;
  const padL = 48;  // wide enough for 3-digit y labels
  const padR = 12;
  const padT = 14;
  const padB = 30;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = Math.max(1, height - padT - padB);

  // Only render series whose toggle is on.
  const visibleSeries = TREND_SERIES.filter((s) => {
    if (s.key === "sodium")  return showSodium;
    if (s.key === "sugar")   return showSugar;
    if (s.key === "satFat")  return showSatFat;
    return true;
  });

  // Y-axis domain is computed only from VISIBLE series so the scale stays
  // meaningful when a series is hidden.
  const rawMax = Math.max(
    0,
    ...data.flatMap((d) => [
      showSodium ? d.sodium : 0,
      showSugar  ? d.sugar  : 0,
      showSatFat ? d.satFat : 0,
    ])
  );
  const maxVal = niceMax(rawMax);
  // Five evenly-spaced gridlines: 0 → maxVal
  const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];

  // ── X-axis: cap visible labels at ~8 ticks with stride-based decimation ──
  const xStride = Math.max(1, Math.ceil(data.length / 8));

  const x = (i: number) =>
    padL + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / maxVal) * plotH;

  const buildPath = (key: "sodium" | "sugar" | "satFat") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d[key])}`).join(" ");

  // Hover crosshair using useRef instead of state to prevent re-renders
  const tooltipRef = React.useRef<SVGGElement>(null);
  const boxW = 122;
  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (data.length === 0 || !tooltipRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let nearest = 0, best = Infinity;
    for (let i = 0; i < data.length; i++) {
      const dist = Math.abs(x(i) - px);
      if (dist < best) { best = dist; nearest = i; }
    }
    
    tooltipRef.current.style.display = "block";
    const hx = x(nearest);
    const boxX = Math.min(Math.max(hx + 8, padL), width - boxW - 4);
    
    const line = tooltipRef.current.querySelector(".ch-line");
    if (line) {
      line.setAttribute("x1", String(hx));
      line.setAttribute("x2", String(hx));
    }
    const box = tooltipRef.current.querySelector(".ch-box");
    if (box) box.setAttribute("x", String(boxX));
    
    const title = tooltipRef.current.querySelector(".ch-title");
    if (title) {
      title.setAttribute("x", String(boxX + 8));
      title.textContent = data[nearest].label;
    }
    
    visibleSeries.forEach((s) => {
      const pnt = tooltipRef.current!.querySelector(`.ch-pnt-${s.key}`);
      if (pnt) {
        pnt.setAttribute("cx", String(hx));
        pnt.setAttribute("cy", String(y(data[nearest][s.key])));
      }
      const lcirc = tooltipRef.current!.querySelector(`.ch-lcirc-${s.key}`);
      if (lcirc) lcirc.setAttribute("cx", String(boxX + 12));
      const lname = tooltipRef.current!.querySelector(`.ch-lname-${s.key}`);
      if (lname) lname.setAttribute("x", String(boxX + 20));
      const lval = tooltipRef.current!.querySelector(`.ch-lval-${s.key}`);
      if (lval) {
        lval.setAttribute("x", String(boxX + boxW - 8));
        lval.textContent = `${data[nearest][s.key]} \u00A0${s.unit}`;
      }
    });
  };

  const handleLeave = () => {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
  };

  // Format y-axis tick label: drop trailing decimals for integers.
  const fmtY = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  return (
    <svg width={width} height={height} role="img" aria-label="Nutrient trends">
      {/* Y-axis gridlines + labels */}
      {Y_TICKS.map((g) => {
        const gy = padT + plotH - g * plotH;
        const val = g * maxVal;
        return (
          <g key={`grid-${g}`}>
            <line
              x1={padL} y1={gy} x2={width - padR} y2={gy}
              stroke={g === 0 ? "#ccc" : "#eee"}
              strokeDasharray={g === 0 ? undefined : "3 3"}
            />
            <text
              x={padL - 5} y={gy + 4}
              fontSize={9} textAnchor="end"
              fill="var(--muted-foreground)"
            >
              {fmtY(val)}
            </text>
          </g>
        );
      })}

      {/* Series lines — only rendered when their disease toggle is on */}
      {visibleSeries.map((s) => (
        <path
          key={s.key}
          d={buildPath(s.key)}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}

      {/* Empty-bucket dots: small hollow circles so gaps are visible */}
      {data.map((d, i) =>
        d.hasData === false ? (
          <circle
            key={`emp-${d.id}`}
            cx={x(i)} cy={y(0)}
            r={2.5}
            fill="none"
            stroke="#ccc"
            strokeWidth={1}
          />
        ) : null
      )}

      {/* X-axis labels — stride-decimated */}
      {data.map((d, i) =>
        i % xStride === 0 ? (
          <text
            key={`xl-${d.id}`}
            x={x(i)}
            y={height - 7}
            fontSize={9}
            textAnchor="middle"
            fill="var(--muted-foreground)"
          >
            {d.label}
          </text>
        ) : null
      )}

      {/* Hover crosshair via refs */}
      <g ref={tooltipRef} pointerEvents="none" style={{ display: "none" }}>
        <line
          className="ch-line"
          y1={padT} y2={padT + plotH}
          stroke="var(--muted-foreground)" strokeWidth={1}
          strokeDasharray="4 3" opacity={0.6}
        />
        {visibleSeries.map((s) => (
          <circle
            key={`hp-${s.key}`}
            className={`ch-pnt-${s.key}`}
            r={3.5} fill={s.color} stroke="#fff" strokeWidth={1.5}
          />
        ))}
        <rect
          className="ch-box"
          y={padT + 4} width={boxW}
          height={14 + 14 + visibleSeries.length * 14}
          rx={6} fill="#fff" stroke="var(--border)"
        />
        <text className="ch-title" y={padT + 18} fontSize={10} fontWeight={700} fill="var(--foreground)" />
        {visibleSeries.map((s, si) => (
          <g key={`hl-${s.key}`}>
            <circle className={`ch-lcirc-${s.key}`} cy={padT + 30 + si * 14} r={3} fill={s.color} />
            <text className={`ch-lname-${s.key}`} y={padT + 34 + si * 14} fontSize={10} fill="var(--muted-foreground)">
              {s.label}
            </text>
            <text
              className={`ch-lval-${s.key}`} y={padT + 34 + si * 14}
              fontSize={10} fontWeight={700} textAnchor="end" fill="var(--foreground)"
            />
          </g>
        ))}
      </g>

      {/* Transparent overlay captures pointer movement */}
      <rect
        x={padL} y={padT} width={plotW} height={plotH}
        fill="transparent"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      />
    </svg>
  );
}

// ---------- Horizontal bars ----------

export interface HBar {
  id: string;
  label: string;
  value: number;
  color: string;
}

export function HBarChart({ data, size }: { data: HBar[]; size: Size }) {
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
            <text
              x={labelW - 8}
              y={yTop + barH / 2 + 4}
              fontSize={11}
              textAnchor="end"
              fill="var(--foreground)"
            >
              {d.label}
            </text>
            <rect
              x={labelW}
              y={yTop}
              width={barW}
              height={Math.max(2, barH)}
              rx={4}
              fill={d.color}
            />
            <text
              x={labelW + barW + 6}
              y={yTop + barH / 2 + 4}
              fontSize={11}
              fill="var(--muted-foreground)"
            >
              {d.value} P pts
            </text>
          </g>
        );
      })}
    </svg>
  );
}
