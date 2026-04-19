import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanSearch, cleanSector } from "@/lib/api";

// GET /api/companies?sector=Financials&q=bank&active=1
// Returns the tracked company universe — used by filters and the search box.
// All query params are validated; `q` is ilike-escaped so `%` and `_` in
// the search string don't trigger wildcard matches.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sector = cleanSector(sp.get("sector"));
  const q = cleanSearch(sp.get("q"));
  const active = sp.get("active") !== "0";

  const sb = supabaseServer();
  let query = sb.from("companies").select("*").order("company_name", { ascending: true }).limit(200);
  if (active) query = query.eq("is_active", true);
  if (sector) query = query.eq("sector", sector);
  if (q) query = query.or(`company_name.ilike.%${q}%,ticker.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);
  return jsonOk(data ?? [], { cache: "long" });
}
