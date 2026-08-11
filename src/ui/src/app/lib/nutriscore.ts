// NUT-04 — domain types and FSA-NPS helpers.

export type Grade = "A" | "B" | "C" | "D" | "E";
export type DataConfidence = "measured" | "derived" | "fallback";

// Nutrients are per 100g / 100ml. null means "not available" -> renders as em-dash.
export interface Nutrients {
  energyKj: number | null;
  fatG: number | null;
  satFatG: number | null;
  carbsG: number | null;
  sugarsG: number | null;
  fibreG: number | null;
  proteinG: number | null;
  sodiumMg: number | null;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string; // FSA-NPS category
  price: string;
  imageUrl: string;
  grade: Grade;
  negativePoints: number; // "P points" (energy, sat fat, sugars, sodium)
  confidence: DataConfidence;
  perUnit: string;
  nutrients: Nutrients;
}

// A shopping cart event persisted to IndexedDB.
export interface ShoppingLedgerRow {
  id: string; // e.g. `${retailer}-${productId}-${addedAt}`
  productId: string;
  name: string;
  retailer: string;
  addedAt: number; // epoch ms
  quantity: number;
  gradeSnapshot: Grade;
  priceSnapshot: number | null;
  category: string;
  status: 'in_cart' | 'purchased' | 'removed';
  nutritionSnapshot: {
    sodiumMg: number | null;
    sugarsG: number | null;
    satFatG: number | null;
  };
}

// Global metadata about the currently loaded dataset.
export interface DatasetMetadata {
  datasetVersion: string;
  retailer: string;
  generatedAt: string; // ISO string
  recordCount: number;
}

// The clean, validated projection of a product sent to the frontend.
export interface RuntimeProductProjection {
  productId: string;
  name: string;
  retailer: string;
  category: string;
  grade: Grade;
  price: number | null;
  imageUrl: string | null;
  isExcluded: boolean;
  matchInfo: {
    matched: boolean;
    matchMethod: string;
    confidence: string;
    reason?: string;
  };
  nutrition: {
    energyKj: number | null;
    fatG: number | null;
    satFatG: number | null;
    carbsG: number | null;
    sugarsG: number | null;
    fibreG: number | null;
    proteinG: number | null;
    sodiumMg: number | null;
  };
}

// The unified ViewModel for the Dashboard
export interface DashboardViewModel {
  totalStoredEvents: number;
  filteredPeriodEvents: number;
  basketQuality: {
    averageGrade: Grade;
    pts: number;
    distribution: Record<Grade, number>;
  };
  categoryInsights: { category: string; pts: number }[];
  nutrientTrends: {
    windowStart: number;
    windowEnd: number;
    ticks: { ts: number; label: string }[];
    data: { ts: number; sugarsG: number | null; sodiumMg: number | null; satFatG: number | null }[];
    validCount: number;
    missingCount: number;
  };
  healthAlerts: {
    diabetes: number;
    hypertension: number;
    cvd: number;
    kidney: number;
  };
}

export const GRADE_ORDER: Grade[] = ["A", "B", "C", "D", "E"];

export const gradeColorVar = (g: Grade): string => `var(--ns-grade-${(g || "C").toLowerCase()})`;
export const gradeOnColorVar = (g: Grade): string => `var(--ns-on-grade-${(g || "C").toLowerCase()})`;

// Plain-language, low-reading-grade descriptions (Flesch-Kincaid <= 8).
export const GRADE_LABEL: Record<Grade, string> = {
  A: "Best choice",
  B: "Good choice",
  C: "Okay choice",
  D: "Eat less often",
  E: "Least healthy",
};

export const NUTRIENT_ROWS: {
  key: keyof Nutrients;
  label: string;
  unit: string;
}[] = [
  { key: "energyKj", label: "Energy", unit: "kJ" },
  { key: "fatG", label: "Fat", unit: "g" },
  { key: "satFatG", label: "Saturated Fat", unit: "g" },
  { key: "carbsG", label: "Carbohydrates", unit: "g" },
  { key: "sugarsG", label: "Sugars", unit: "g" },
  { key: "fibreG", label: "Fibre", unit: "g" },
  { key: "proteinG", label: "Protein", unit: "g" },
  { key: "sodiumMg", label: "Sodium", unit: "mg" },
];

export const formatValue = (v: number | null, unit: string): string =>
  v === null ? "—" : `${v} ${unit}`;
