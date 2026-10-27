import { cache } from "react";
import { supabaseServer } from "@/lib/supabase";
import { compareQuarterLabels } from "@/lib/fiscal";
import { ACTIVE_QUARTER } from "@/lib/seo";

// Returns the latest quarter that has data in the DB, e.g. "Q2 FY27".
// Cached per-request (React cache) so multiple server components in one
// render share a single DB round-trip. Falls back to the build-time
// ACTIVE_QUARTER constant if the DB is unreachable.
export const getActiveQuarter = cache(async (): Promise<string> => {
  try {
    const sb = supabaseServer();
    const { data, error } = await sb
      .from("quarterly_financials")
      .select("quarter_label")
      .order("quarter_end_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.quarter_label) return ACTIVE_QUARTER;
    return data.quarter_label;
  } catch {
    return ACTIVE_QUARTER;
  }
});
