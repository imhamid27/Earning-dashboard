import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError } from "@/lib/api";

export const dynamic    = "force-dynamic";
export const fetchCache = "force-no-store";

// GET /api/expert-quotes?limit=5
//
// Returns active expert quotes, newest first.
// Used by the ExpertQuotes component on the homepage.
//
// Each entry:
//   id, expert_name, photo_url, designation, firm, quote,
//   source_url, source_name, published_date, ticker, quarter, created_at
//
// Only rows with is_active = true are returned (RLS enforces this too).
export async function GET(req: NextRequest) {
  const sp    = req.nextUrl.searchParams;
  const limit = Math.min(10, Math.max(1, Number(sp.get("limit") || "5")));
  // Optional filter: ?ticker=RELIANCE.NS to show only quotes for one company
  const ticker = sp.get("ticker")?.trim().toUpperCase() ?? null;

  const sb = supabaseServer();
  // TRUST RULE: only surface quotes that carry an explicit, specific
  // source_url (an actual article / earnings-call transcript link).
  // Generic homepage URLs and quotes without attribution are excluded.
  let q = sb
    .from("expert_quotes")
    .select("id, expert_name, photo_url, designation, firm, quote, source_url, source_name, published_date, ticker, quarter, created_at")
    .eq("is_active", true)
    .not("source_url", "is", null)
    .neq("source_url", "")
    .order("created_at", { ascending: false });

  if (ticker) q = q.eq("ticker", ticker);
  q = q.limit(limit);

  const { data, error } = await q;
  if (error) return jsonError(error.message, 500);
  return jsonOk({ quotes: data ?? [], count: (data ?? []).length });
}
