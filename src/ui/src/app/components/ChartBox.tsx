import { useEffect, useRef, useState, type ReactNode } from "react";

interface ChartBoxProps {
  height: number;
  children: (size: { width: number; height: number }) => ReactNode;
}

// Measures its own box and only renders the chart once it has a real size.
// This avoids Recharts rendering axes at width/height 0 on first paint, which
// generates ticks with undefined coordinates and duplicate React keys.
export function ChartBox({ height, children }: ChartBoxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.floor(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: "100%", height }}>
      {width > 0 ? children({ width, height }) : null}
    </div>
  );
}
