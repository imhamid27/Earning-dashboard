import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanQuarterLabel } from "@/lib/api";
import { pctChange } from "@/lib/growth";

// GET /api/trends?quarter=Q4%20FY26
//
// Returns top gainers / laggards (both revenue and profit growth YoY) for the
// requested quarter. YoY is computed by looking back 4 fiscal quarters.
export async function GET(req: NextRequest) {
  const quarter = cleanQuarterLabel(req.nextUrl.searchParams.get("quarter"));
  if (!quarter) return jsonError("missing or invalid ?quarter", 400);

  const sb = supabaseServer();

  // Pull the current quarter + its YoY counterpart for every company, then
  // compute growth in JS. This stays simple and avoids a window-function SQL
  // view; for >500 companies we'd push this into a Postgres function.
  const { data: current, error } = await sb
    .from("quarterly_financials")
    .select("ticker,quarter_label,quarter_end_date,fiscal_year,fiscal_quarter,revenue,net_profit,companies!inner(company_name,sector)")
    .eq("quarter_label", quarter);
  if (error) return jsonError(error.message, 500);
  if (!current || current.length === 0) return jsonOk({ quarter, gainers_rev: [], laggards_rev: [], gainers_profit: [], laggards_profit: [] });

  const fiscalYear = current[0].fiscal_year;
  const fiscalQuarter = current[0].fiscal_quarter;
  const { data: prior, error: pErr } = await sb
    .from("quarterly_financials")
    .select("ticker,revenue,net_profit")
    .eq("fiscal_year", fiscalYear - 1)
    .eq("fiscal_quarter", fiscalQuarter);
  if (pErr) return jsonError(pErr.message, 500);
  const priorByTicker = new Map<string, { revenue: number | null; net_profit: number | null }>();
  for (const r of prior ?? []) priorByTicker.set(r.ticker, { revenue: r.revenue, net_profit: r.net_profit });

  const withGrowth = current.map((r) => {
    const base = priorByTicker.get(r.ticker);
    return {
      ticker: r.ticker,
      company_name: (r as any).companies?.company_name ?? r.ticker,
      sector: (r as any).companies?.sector ?? null,
      revenue: r.revenue,
      net_profit: r.net_profit,
      revenue_yoy: pctChange(r.revenue, base?.revenue ?? null),
      profit_yoy: pctChange(r.net_profit, base?.net_profit ?? null)
    };
  });

  // Exclude (a) rows without a growth number, (b) rows where the YoY is
  // absurd (> ±500%) — those almost always come from a tiny base. Both
  // would make the gainers/laggards lists editorially meaningless.
  const MEANINGFUL = 5; // ±500%
  const hasRev = withGrowth.filter(
    (r) => r.revenue_yoy != null && Math.abs(r.revenue_yoy) <= MEANINGFUL
  );
  const hasProfit = withGrowth.filter(
    (r) => r.profit_yoy != null && Math.abs(r.profit_yoy) <= MEANINGFUL
  );
  const sortBy = <K extends string>(key: K, dir: "desc" | "asc") =>
    (a: any, b: any) => dir === "desc" ? (b[key] - a[key]) : (a[key] - b[key]);

  return jsonOk({
    quarter,
    fiscal_year: fiscalYear,
    fiscal_quarter: fiscalQuarter,
    gainers_rev:    [...hasRev].sort(sortBy("revenue_yoy", "desc")).slice(0, 10),
    laggards_rev:   [...hasRev].sort(sortBy("revenue_yoy", "asc")).slice(0, 10),
    gainers_profit: [...hasProfit].sort(sortBy("profit_yoy", "desc")).slice(0, 10),
    laggards_profit:[...hasProfit].sort(sortBy("profit_yoy", "asc")).slice(0, 10)
  });
}
