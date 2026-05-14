import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanTicker, cleanQuarterLabel } from "@/lib/api";
import { withGrowth } from "@/lib/growth";

// GET /api/quarterly-results?ticker=RELIANCE.NS
// GET /api/quarterly-results?quarter=Q4%20FY26&sector=Financials
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ticker = cleanTicker(sp.get("ticker"));
  const quarter = cleanQuarterLabel(sp.get("quarter"));
  const sector = sp.get("sector");

  const sb = supabaseServer();

  // Single-ticker shortcut — same shape as the company detail endpoint.
  // Project only the columns we actually return; skip raw_json (the bulky
  // exchange-filing blob) which was previously inflating responses 5-10×.
  if (ticker) {
    const { data, error } = await sb
      .from("quarterly_financials")
      .select("id,ticker,quarter_label,quarter_end_date,fiscal_year,fiscal_quarter,revenue,net_profit,operating_profit,eps,currency,data_quality_status,fetched_at")
      .eq("ticker", ticker)
      .order("quarter_end_date", { ascending: true });
    if (error) return jsonError(error.message, 500);
    const g = withGrowth((data ?? []).map((r) => ({
      quarter_end_date: r.quarter_end_date, revenue: r.revenue, net_profit: r.net_profit
    })));
    return jsonOk((data ?? []).map((r, i) => ({ ...r, ...g[i] })));
  }

  // Cross-sectional query: one quarter across many companies.
  let q = sb
    .from("quarterly_financials")
    .select("id,ticker,quarter_label,quarter_end_date,revenue,net_profit,operating_profit,eps,data_quality_status,fetched_at,company_id,companies!inner(company_name,sector,industry,exchange)")
    .order("revenue", { ascending: false, nullsFirst: false });

  if (quarter) q = q.eq("quarter_label", quarter);
  if (sector) q = q.eq("companies.sector", sector);

  const { data, error } = await q;
  if (error) return jsonError(error.message, 500);
  return jsonOk(data ?? []);
}
