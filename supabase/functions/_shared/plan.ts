import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface Plan {
  code: string;
  price_kes: number;
  duration_days: number;
  active: boolean;
}

/**
 * Load the active plan record by code from public.plans.
 * Throws if the plan is not found or inactive.
 */
export async function getPlan(
  supabase: SupabaseClient,
  code = "premium_30d"
): Promise<Plan> {
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("code", code)
    .eq("active", true)
    .single();

  if (error || !data) {
    throw new Error(`Plan '${code}' not found or inactive: ${error?.message ?? "no data"}`);
  }
  return data as Plan;
}
