import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanQuarterLabel } from "@/lib/api";
import { pctChange } from "@/lib/growth";

// GET /api/summary?quarter=Q4 FY26
//
// The hero summary cards on the dashboard:
//   - companies_reported
//   - avg_revenue_yoy
//   - avg_profit_yoy
//   - top sectors by revenue growth
//   - last data refresh
export async function GET(req: NextRequest) {
  const quarter = cleanQuarterLabel(req.nextUrl.searchParams.get("quarter"));
  const sb = supabaseServer();

  let targetQuarter = quarter;
  if (!targetQuarter) {
    const { data, error } = await sb
      .from("quarterly_financials")
      .select("quarter_label,quarter_end_date")
      .order("quarter_end_date", { ascending: false })
      .limit(1);
    if (error) return jsonError(error.message, 500);
    targetQuarter = data?.[0]?.quarter_label ?? null;
  }

  const [{ count: universeCount }, lastFetched] = await Promise.all([
    sb.from("companies").select("*", { count: "exact", head: true }).eq("is_active", true),
    sb.from("quarterly_financials").select("fetched_at").order("fetched_at", { ascending: false }).limit(1).maybeSingle()
  ]);

  if (!targetQuarter) {
    return jsonOk({
      quarter: null,
      companies_tracked: universeCount ?? 0,
      companies_reported: 0,
      avg_revenue_yoy: null,
      avg_profit_yoy: null,
      top_sectors_by_rev_growth: [],
      last_refreshed_at: lastFetched.data?.fetched_at ?? null
    });
  }

  const { data: cur, error } = await sb
    .from("quarterly_financials")
    .select("ticker,fiscal_year,fiscal_quarter,revenue,net_profit,companies!inner(sector)")
    .eq("quarter_label", targetQuarter);
  if (error) return jsonError(error.message, 500);

  if (!cur || cur.length === 0) {
    return jsonOk({
      quarter: targetQuarter,
      companies_tracked: universeCount ?? 0,
      companies_reported: 0,
      avg_revenue_yoy: null,
      avg_profit_yoy: null,
      top_sectors_by_rev_growth: [],
      last_refreshed_at: lastFetched.data?.fetched_at ?? null
    });
  }

  const fy = cur[0].fiscal_year;
  const fq = cur[0].fiscal_quarter;

  const { data: prev, error: pErr } = await sb
    .from("quarterly_financials")
    .select("ticker,revenue,net_profit,companies!inner(sector)")
    .eq("fiscal_year", fy - 1)
    .eq("fiscal_quarter", fq);
  if (pErr) return jsonError(pErr.message, 500);

  const priorByTicker = new Map<string, { rev: number | null; prof: number | null }>();
  for (const r of prev ?? []) priorByTicker.set(r.ticker, { rev: r.revenue, prof: r.net_profit });

  const revGrowths: number[] = [];
  const profGrowths: number[] = [];
  type SectorAgg = { rev: number; revPrev: number; reported: number };
  const bySector = new Map<string, SectorAgg>();

  for (const row of cur) {
    const p = priorByTicker.get(row.ticker);
    const rYoy = pctChange(row.revenue, p?.rev ?? null);
    const pYoy = pctChange(row.net_profit, p?.prof ?? null);
    if (rYoy != null) revGrowths.push(rYoy);
    if (pYoy != null) profGrowths.push(pYoy);

    const sector = (row as any).companies?.sector ?? null;
    if (sector) {
      const s = bySector.get(sector) ?? { rev: 0, revPrev: 0, reported: 0 };
      s.rev += row.revenue ?? 0;
      s.revPrev += p?.rev ?? 0;
      s.reported += 1;
      bySector.set(sector, s);
    }
  }

  const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

  const topSectors = Array.from(bySector.entries())
    .map(([sector, s]) => ({
      sector,
      companies_reported: s.reported,
      revenue_yoy: pctChange(s.rev, s.revPrev)
    }))
    .filter((s) => s.revenue_yoy != null)
    .sort((a, b) => (b.revenue_yoy! - a.revenue_yoy!))
    .slice(0, 5);

  return jsonOk({
    quarter: targetQuarter,
    companies_tracked: universeCount ?? 0,
    companies_reported: cur.length,
    avg_revenue_yoy: mean(revGrowths),
    avg_profit_yoy: mean(profGrowths),
    top_sectors_by_rev_growth: topSectors,
    last_refreshed_at: lastFetched.data?.fetched_at ?? null
  });
}
