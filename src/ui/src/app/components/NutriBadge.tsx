import { gradeColorVar, gradeOnColorVar, type Grade } from "../lib/nutriscore";

interface NutriBadgeProps {
  grade: Grade;
  onClick?: () => void;
  active?: boolean;
}

// Compact pill-shaped button. Color maps to grade via CSS variables; the grade
// letter is always shown as text so color is never the sole information carrier.
export function NutriBadge({ grade, onClick, active }: NutriBadgeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      aria-label={`NutriScore grade ${grade}. Show nutrition details.`}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 shadow-sm transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      style={{
        backgroundColor: gradeColorVar(grade),
        color: gradeOnColorVar(grade),
      }}
    >
      <span
        className="grid place-items-center rounded-full"
        style={{
          width: "1.15rem",
          height: "1.15rem",
          backgroundColor: gradeOnColorVar(grade),
          color: gradeColorVar(grade),
          fontWeight: 700,
          fontSize: "0.8rem",
          lineHeight: 1,
        }}
        aria-hidden
      >
        {grade}
      </span>
      <span style={{ fontWeight: 600, fontSize: "0.75rem" }}>NutriScore</span>
    </button>
  );
}
