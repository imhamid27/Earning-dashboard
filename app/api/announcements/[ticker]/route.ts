import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanTicker } from "@/lib/api";

// BSE announcements served from our DB, populated by scripts/bse_documents.py.
// BSE's API subdomain requires Akamai cookies that only curl_cffi can get;
// we do that in the Python pipeline and cache results here.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const ticker = cleanTicker(decodeURIComponent(rawTicker));
  if (!ticker) return jsonError("invalid ticker", 400);

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("company_announcements")
    .select("id,date,subject,category,subcategory,pdf_url")
    .eq("ticker", ticker)
    .order("date", { ascending: false })
    .limit(50);

  if (error) return jsonError(error.message, 500);

  return jsonOk({ announcements: data ?? [] }, { cache: "long" });
}
