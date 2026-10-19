// D-24: palette aligned with --ns-grade-* and --ns-on-grade-* tokens in globals.css.
// Previously grade B (white on #3cb371) = 2.67:1 (WCAG fail); D (white on #ff6600) = 2.94:1 (fail).
// 'on' property = accessible foreground, matching --ns-on-grade-* for dashboard chart labels.
window.NutriScoreGradeColors = {
  A: { bg: "#037b3e", txt: "#ffffff", on: "#ffffff", label: "Everyday Choice" },
  B: { bg: "#85bb2f", txt: "#14320a", on: "#14320a", label: "Great Choice" },
  C: { bg: "#fecb02", txt: "#3a2e00", on: "#3a2e00", label: "Balanced Choice" },
  D: { bg: "#ee8100", txt: "#331c00", on: "#331c00", label: "Enjoy Occasionally" },
  E: { bg: "#e63e11", txt: "#ffffff", on: "#ffffff", label: "Limit Intake" },
};
