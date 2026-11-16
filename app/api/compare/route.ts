import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanTicker } from "@/lib/api";
import { withGrowth } from "@/lib/growth";

// GET /api/compare?tickers=RELIANCE.NS,TCS.NS,HDFCBANK.NS
// Returns quarterly data for up to 5 tickers in one shot.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = raw
    .split(",")
    .map((t) => cleanTicker(t.trim()))
    .filter(Boolean)
    .slice(0, 5) as string[];

  if (tickers.length === 0) return jsonError("no tickers", 400);

  const sb = supabaseServer();

  const [{ data: companies, error: cErr }, { data: quarters, error: qErr }] =
    await Promise.all([
      sb
        .from("companies")
        .select("ticker,company_name,sector,industry,exchange")
        .in("ticker", tickers),
      sb
        .from("quarterly_financials")
        .select(
          "ticker,quarter_label,quarter_end_date,fiscal_year,fiscal_quarter,revenue,net_profit,operating_profit,eps"
        )
        .in("ticker", tickers)
        .order("quarter_end_date", { ascending: true }),
    ]);

  if (cErr) return jsonError(cErr.message, 500);
  if (qErr) return jsonError(qErr.message, 500);

  // Group quarters by ticker and attach growth metrics.
  const byTicker: Record<string, typeof quarters> = {};
  for (const q of quarters ?? []) {
    if (!byTicker[q.ticker]) byTicker[q.ticker] = [];
    byTicker[q.ticker]!.push(q);
  }

  const companyMap = Object.fromEntries(
    (companies ?? []).map((c) => [c.ticker, c])
  );

  const result = tickers
    .filter((t) => companyMap[t])
    .map((ticker) => {
      const rows = byTicker[ticker] ?? [];
      const withPct = withGrowth(
        rows.map((r) => ({
          quarter_end_date: r.quarter_end_date,
          revenue: r.revenue,
          net_profit: r.net_profit,
        }))
      );
      const enriched = rows.map((r, i) => ({
        ...r,
        revenue_yoy: withPct[i]?.revenue_yoy ?? null,
        profit_yoy: withPct[i]?.profit_yoy ?? null,
      }));
      return { company: companyMap[ticker], quarters: enriched };
    });

  return jsonOk(result);
}
