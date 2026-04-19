import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError } from "@/lib/api";

// GET /api/companies?sector=Financials&q=bank&active=1
// Returns the tracked company universe — used by filters and the search box.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sector = sp.get("sector");
  const q = sp.get("q")?.trim();
  const active = sp.get("active") !== "0";

  const sb = supabaseServer();
  let query = sb.from("companies").select("*").order("company_name", { ascending: true });
  if (active) query = query.eq("is_active", true);
  if (sector) query = query.eq("sector", sector);
  if (q) query = query.or(`company_name.ilike.%${q}%,ticker.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);
  return jsonOk(data ?? []);
}
