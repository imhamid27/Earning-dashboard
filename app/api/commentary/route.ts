import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError } from "@/lib/api";

// Re-execute the route per request (no Next build-time caching) — but the
// HTTP cache headers we set on the response still apply, so CDN + browser
// can cache the result for the long static window.
export const dynamic = "force-dynamic";

// GET /api/commentary?limit=5
//
// Returns the latest auto-generated earnings commentary entries,
// newest first.  Used by the LiveCommentary component on the homepage.
//
// Each entry: { id, company, ticker, quarter, text, source, created_at, updated_at }
// source = "auto" (Python-generated) | "manual" (editorial override)
export async function GET(req: NextRequest) {
  const sp    = req.nextUrl.searchParams;
  const limit = Math.min(20, Math.max(1, Number(sp.get("limit") || "5")));

  // Only show entries from the last 180 days — prevents stale articles from
  // prior fiscal years surfacing in the current-season commentary feed.
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("live_commentary")
    .select("id, company, ticker, quarter, text, source, created_at, updated_at")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return jsonError(error.message, 500);
  // Editorial entries written manually; very low churn.
  return jsonOk(
    { entries: data ?? [], count: (data ?? []).length },
    { cache: "static" }
  );
}
