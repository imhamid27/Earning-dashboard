import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanTicker } from "@/lib/api";

// Annual reports served from our DB, populated by scripts/bse_documents.py.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const ticker = cleanTicker(decodeURIComponent(rawTicker));
  if (!ticker) return jsonError("invalid ticker", 400);

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("company_annual_reports")
    .select("id,year,title,pdf_url")
    .eq("ticker", ticker)
    .order("year", { ascending: false });

  if (error) return jsonError(error.message, 500);

  return jsonOk({ reports: data ?? [] }, { cache: "static" });
}
