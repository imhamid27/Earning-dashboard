import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanQuarterLabel } from "@/lib/api";
import { pctChange } from "@/lib/growth";
import { validateMetricPair } from "@/lib/validation";

// GET /api/sectors?quarter=Q4 FY26
//
// Returns sector-level totals + YoY growth (revenue & net profit) for the
// given quarter. Powers the sector-comparison chart + "sectors with strongest
// sales growth" summary card.
export async function GET(req: NextRequest) {
  const quarter = cleanQuarterLabel(req.nextUrl.searchParams.get("quarter"));
  const sb = supabaseServer();

  // If no quarter supplied, infer the latest one present in the data.
  let targetQuarter = quarter;
  if (!targetQuarter) {
    const { data: latest, error } = await sb
      .from("quarterly_financials")
      .select("quarter_label,quarter_end_date")
      .order("quarter_end_date", { ascending: false })
      .limit(1);
    if (error) return jsonError(error.message, 500);
    targetQuarter = latest?.[0]?.quarter_label ?? null;
  }
  if (!targetQuarter) return jsonOk({ quarter: null, sectors: [] });

  const { data: currentRows, error } = await sb
    .from("quarterly_financials")
    .select("ticker,fiscal_year,fiscal_quarter,revenue,net_profit,source,companies!inner(company_name,sector,industry,market_cap_bucket)")
    .eq("quarter_label", targetQuarter);
  if (error) return jsonError(error.message, 500);
  if (!currentRows || currentRows.length === 0) return jsonOk({ quarter: targetQuarter, sectors: [] });

  const fy = currentRows[0].fiscal_year;
  const fq = currentRows[0].fiscal_quarter;

  const { data: priorRows, error: pErr } = await sb
    .from("quarterly_financials")
    .select("ticker,revenue,net_profit,source,companies!inner(company_name,sector,industry,market_cap_bucket)")
    .eq("fiscal_year", fy - 1)
    .eq("fiscal_quarter", fq);
  if (pErr) return jsonError(pErr.message, 500);

  type Agg = { rev: number; prof: number; count: number };
  const acc = new Map<string, Agg>();
  const prev = new Map<string, Agg>();
  const includedCurrentTickers = new Set<string>();
  const add = (map: Map<string, Agg>, sector: string | null, rev: number | null, prof: number | null) => {
    if (!sector) return;
    const cur = map.get(sector) ?? { rev: 0, prof: 0, count: 0 };
    cur.rev += rev ?? 0;
    cur.prof += prof ?? 0;
    cur.count += 1;
    map.set(sector, cur);
  };
  const priorByTicker = new Map<string, { revenue: number | null; net_profit: number | null }>();
  for (const r of priorRows ?? []) {
    priorByTicker.set(r.ticker, { revenue: r.revenue, net_profit: r.net_profit });
  }

  for (const r of currentRows) {
    const company: any = (r as any).companies ?? {};
    const prior = priorByTicker.get(r.ticker);
    const sanitized = validateMetricPair(
      { revenue: r.revenue, net_profit: r.net_profit },
      {
        company_name: company.company_name,
        sector: company.sector,
        industry: company.industry,
        market_cap_bucket: company.market_cap_bucket,
        source: "sectors_current",
        financial_source: (r as any).source ?? null,
        require_verified: true,
      },
      { revenue: prior?.revenue ?? null, net_profit: prior?.net_profit ?? null }
    );
    add(acc, company.sector ?? null, sanitized.revenue, sanitized.net_profit);
    if (sanitized.revenue != null || sanitized.net_profit != null) {
      includedCurrentTickers.add(r.ticker);
    }
  }
  for (const r of priorRows ?? []) {
    if (!includedCurrentTickers.has(r.ticker)) continue;
    const company: any = (r as any).companies ?? {};
    const sanitized = validateMetricPair(
      { revenue: r.revenue, net_profit: r.net_profit },
      {
        company_name: company.company_name,
        sector: company.sector,
        industry: company.industry,
        market_cap_bucket: company.market_cap_bucket,
        source: "sectors_prior",
        financial_source: (r as any).source ?? null,
      }
    );
    add(prev, company.sector ?? null, sanitized.revenue, sanitized.net_profit);
  }

  const sectors = Array.from(acc.entries()).map(([sector, cur]) => {
    const pr = prev.get(sector);
    return {
      sector,
      companies_reported: cur.count,
      total_revenue: cur.rev,
      total_net_profit: cur.prof,
      revenue_yoy: pctChange(cur.rev, pr?.rev ?? null),
      profit_yoy: pctChange(cur.prof, pr?.prof ?? null)
    };
  }).sort((a, b) => b.total_revenue - a.total_revenue);

  return jsonOk({ quarter: targetQuarter, sectors });
}
