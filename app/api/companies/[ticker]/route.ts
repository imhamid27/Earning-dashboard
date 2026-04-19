import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanTicker } from "@/lib/api";
import { withGrowth } from "@/lib/growth";

// GET /api/companies/[ticker]
// Returns: { company, quarters: [...with QoQ/YoY growth] }
export async function GET(_req: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = cleanTicker(decodeURIComponent(params.ticker));
  if (!ticker) return jsonError("invalid ticker", 400);

  const sb = supabaseServer();
  const [{ data: company, error: cErr }, { data: quarters, error: qErr }] = await Promise.all([
    sb.from("companies").select("*").eq("ticker", ticker).maybeSingle(),
    sb.from("quarterly_financials")
      .select("id,ticker,quarter_label,quarter_end_date,fiscal_year,fiscal_quarter,revenue,net_profit,operating_profit,eps,currency,data_quality_status,fetched_at")
      .eq("ticker", ticker)
      .order("quarter_end_date", { ascending: true })
  ]);

  if (cErr) return jsonError(cErr.message, 500);
  if (qErr) return jsonError(qErr.message, 500);
  if (!company) return jsonError("company not found", 404);

  const withPct = withGrowth(
    (quarters ?? []).map((q) => ({
      quarter_end_date: q.quarter_end_date,
      revenue: q.revenue,
      net_profit: q.net_profit
    }))
  );

  // Stitch growth metrics back onto the original rows, preserving order.
  const enriched = (quarters ?? []).map((q, i) => ({
    ...q,
    revenue_qoq: withPct[i]?.revenue_qoq ?? null,
    revenue_yoy: withPct[i]?.revenue_yoy ?? null,
    profit_qoq:  withPct[i]?.profit_qoq  ?? null,
    profit_yoy:  withPct[i]?.profit_yoy  ?? null
  }));

  return jsonOk({ company, quarters: enriched });
}
