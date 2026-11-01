import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanQuarterLabel } from "@/lib/api";

// GET /api/sectors?quarter=Q4 FY26
//
// Returns sector-level totals + YoY growth (revenue & net profit) for the
// given quarter. Powers the sector-comparison chart + "sectors with strongest
// sales growth" summary card.
//
// Uses matched-pairs aggregation: a company only contributes to the YoY calc
// when it has data in BOTH the current quarter AND the same quarter last year.
// This matches the methodology in /api/summary and avoids inflated YoY caused
// by new entrants (current total) vs. smaller prior-year cohort.
export async function GET(req: NextRequest) {
  const quarter = cleanQuarterLabel(req.nextUrl.searchParams.get("quarter"));
  const sb = supabaseServer();

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
    .select("ticker,fiscal_year,fiscal_quarter,revenue,net_profit,companies!inner(sector)")
    .eq("quarter_label", targetQuarter);
  if (error) return jsonError(error.message, 500);
  if (!currentRows || currentRows.length === 0) return jsonOk({ quarter: targetQuarter, sectors: [] });

  const fy = currentRows[0].fiscal_year;
  const fq = currentRows[0].fiscal_quarter;

  const { data: priorRows, error: pErr } = await sb
    .from("quarterly_financials")
    .select("ticker,revenue,net_profit,companies!inner(sector)")
    .eq("fiscal_year", fy - 1)
    .eq("fiscal_quarter", fq);
  if (pErr) return jsonError(pErr.message, 500);

  const priorByTicker = new Map<string, { rev: number | null; prof: number | null }>();
  for (const r of priorRows ?? []) {
    priorByTicker.set(r.ticker, { rev: r.revenue, prof: r.net_profit });
  }

  type SectorAgg = {
    rev: number; revPrev: number; revPairs: number;
    prof: number; profPrev: number; profPairs: number;
    reported: number;
  };
  const bySector = new Map<string, SectorAgg>();

  for (const r of currentRows) {
    const sector = (r as any).companies?.sector ?? null;
    if (!sector) continue;
    const p = priorByTicker.get(r.ticker);
    const s = bySector.get(sector) ?? {
      rev: 0, revPrev: 0, revPairs: 0,
      prof: 0, profPrev: 0, profPairs: 0,
      reported: 0,
    };
    // Only include in aggregate when both current and prior-year values exist —
    // avoids inflating YoY by comparing different-sized cohorts.
    if (r.revenue != null && p?.rev != null) {
      s.rev     += r.revenue;
      s.revPrev += p.rev;
      s.revPairs++;
    }
    if (r.net_profit != null && p?.prof != null) {
      s.prof     += r.net_profit;
      s.profPrev += p.prof;
      s.profPairs++;
    }
    s.reported += 1;
    bySector.set(sector, s);
  }

  const aggYoy = (curr: number, prev: number, pairs: number): number | null =>
    pairs === 0 || prev === 0 ? null : (curr - prev) / Math.abs(prev);

  const sectors = Array.from(bySector.entries())
    .map(([sector, s]) => ({
      sector,
      companies_reported: s.reported,
      revenue_pairs:      s.revPairs,
      profit_pairs:       s.profPairs,
      total_revenue:      s.rev,
      total_net_profit:   s.prof,
      revenue_yoy:        aggYoy(s.rev,  s.revPrev,  s.revPairs),
      profit_yoy:         aggYoy(s.prof, s.profPrev, s.profPairs),
    }))
    .sort((a, b) => b.total_revenue - a.total_revenue);

  return jsonOk({ quarter: targetQuarter, sectors });
}
