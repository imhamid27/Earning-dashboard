import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError } from "@/lib/api";

export const dynamic    = "force-dynamic";
export const fetchCache = "force-no-store";

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

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("live_commentary")
    .select("id, company, ticker, quarter, text, source, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return jsonError(error.message, 500);
  return jsonOk({ entries: data ?? [], count: (data ?? []).length });
}
