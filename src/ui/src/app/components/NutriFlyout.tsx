import { useMemo } from "react";
import { X } from "lucide-react";
import {
  formatValue,
  GRADE_LABEL,
  gradeColorVar,
  gradeOnColorVar,
  NUTRIENT_ROWS,
  type Product,
} from "../lib/nutriscore";

interface NutriFlyoutProps {
  product: Product;
  diabetesModule: boolean;
  hypertensionModule: boolean;
  cardiovascularModule: boolean;
  onClose: () => void;
}

// Floating nutrient card shown over/near the badge on click.
export function NutriFlyout({
  product,
  diabetesModule,
  hypertensionModule,
  cardiovascularModule,
  onClose,
}: NutriFlyoutProps) {
  const { grade, nutrients } = product;
  const estimated = product.confidence !== "measured";

  // Only show nutrients with a real, positive amount. Null, undefined, and 0
  // are omitted so the flyout adapts to incomplete data and shrinks/grows to
  // fit exactly the rows it has. Recomputed only when the profile changes.
  const visibleRows = useMemo(
    () =>
      NUTRIENT_ROWS.filter((row) => {
        const value = nutrients[row.key];
        return typeof value === "number" && value > 0;
      }),
    [nutrients],
  );

  const highSugar = (nutrients.sugarsG ?? 0) >= 9;
  const highSodium = (nutrients.sodiumMg ?? 0) >= 500;
  const highSatFat = (nutrients.satFatG ?? 0) > 5; // g per 100g threshold

  return (
    <div
      role="dialog"
      aria-label={`Nutrition details for ${product.name}`}
      className="absolute z-30 mt-2 w-72 overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10"
      style={{ left: 0, top: "100%" }}
    >
      {/* Thematic header inherits the grade color. */}
      <div
        className="flex items-start justify-between gap-2 p-3"
        style={{
          backgroundColor: gradeColorVar(grade),
          color: gradeOnColorVar(grade),
        }}
      >
        <div>
          <p style={{ fontWeight: 600, fontSize: "0.9rem", lineHeight: 1.3 }}>
            {product.name}
          </p>
          <p style={{ fontSize: "0.75rem", opacity: 0.9 }}>
            NutriScore {grade} · {GRADE_LABEL[grade]}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close nutrition details"
          className="shrink-0 rounded-full p-1 hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
          style={{ color: gradeOnColorVar(grade) }}
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="px-3 pb-2 pt-2">
        <p
          className="pb-1"
          style={{ fontSize: "0.7rem", color: "var(--muted-foreground)" }}
        >
          Per 100 {product.perUnit}
        </p>
        {visibleRows.length > 0 ? (
          <ul>
            {visibleRows.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between border-b border-black/5 py-1.5 last:border-b-0"
              >
                <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  {row.label}
                </span>
                <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>
                  {formatValue(nutrients[row.key], row.unit)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
            No nutrient data yet.
          </p>
        )}
      </div>

      {/* Disease warning modules (toggled from the popup). */}
      {(diabetesModule && highSugar) ||
      (hypertensionModule && highSodium) ||
      (cardiovascularModule && highSatFat) ? (
        <div className="space-y-1 px-3 pb-2">
          {diabetesModule && highSugar && (
            <p
              role="alert"
              className="rounded-md px-2 py-1"
              style={{
                backgroundColor: "rgba(230,62,17,0.08)",
                color: "var(--ns-grade-e)",
                fontSize: "0.72rem",
              }}
            >
              High in sugar. Take care if you watch your blood sugar.
            </p>
          )}
          {hypertensionModule && highSodium && (
            <p
              role="alert"
              className="rounded-md px-2 py-1"
              style={{
                backgroundColor: "rgba(238,129,0,0.1)",
                color: "var(--ns-grade-d)",
                fontSize: "0.72rem",
              }}
            >
              High in salt. This can raise blood pressure.
            </p>
          )}
          {cardiovascularModule && highSatFat && (
            <p
              role="alert"
              className="rounded-md px-2 py-1"
              style={{
                backgroundColor: "rgba(238,129,0,0.1)",
                color: "var(--ns-grade-d)",
                fontSize: "0.72rem",
              }}
            >
              High in saturated fat. This is not good for your heart.
            </p>
          )}
        </div>
      ) : null}

      {/* Provenance tag for derived / fallback data. */}
      <div className="flex items-center justify-between px-3 pb-3 pt-1">
        {estimated ? (
          <span
            style={{
              fontSize: "0.7rem",
              fontStyle: "italic",
              color: "var(--ns-grade-d)",
            }}
          >
            ⚠ Estimated ({product.confidence})
          </span>
        ) : (
          <span
            style={{ fontSize: "0.7rem", color: "var(--muted-foreground)" }}
          >
            Verified data
          </span>
        )}
        <span style={{ fontSize: "0.7rem", color: "var(--muted-foreground)" }}>
          {product.category}
        </span>
      </div>
    </div>
  );
}
