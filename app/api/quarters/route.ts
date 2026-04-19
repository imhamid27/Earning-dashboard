import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError } from "@/lib/api";
import { compareQuarterLabels } from "@/lib/fiscal";

// GET /api/quarters
// All distinct quarter labels that have data, most-recent first. Powers the
// quarter dropdown in the header.
export async function GET() {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("quarterly_financials")
    .select("quarter_label,quarter_end_date")
    .order("quarter_end_date", { ascending: false });
  if (error) return jsonError(error.message, 500);
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const row of data ?? []) {
    if (!seen.has(row.quarter_label)) {
      seen.add(row.quarter_label);
      labels.push(row.quarter_label);
    }
  }
  labels.sort((a, b) => -compareQuarterLabels(a, b));
  return jsonOk(labels);
}
