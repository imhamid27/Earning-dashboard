import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError } from "@/lib/api";

// GET /api/related-coverage
//
// Returns the most recent active related_coverage rows (up to 20).
// Items are ordered newest-first by published_at so the timeline component
// can render them directly without re-sorting.
//
// The table is populated by scripts/fetch_related_coverage.py which runs 3×
// daily (08:00, 15:00, 21:00 IST) as part of the earnings-ingest daily mode.
export async function GET(_req: NextRequest) {
  const sb = supabaseServer();

  const { data, error } = await sb
    .from("related_coverage")
    .select(
      "id,title,commentary,source_name,source_url,published_at," +
      "matched_sector,matched_company,match_reason,created_at"
    )
    .eq("is_active", true)
    .not("source_url", "is", null)
    .not("source_name", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(20);

  if (error) return jsonError(error.message, 500);
  return jsonOk(data ?? [], { cache: "short" });
}
