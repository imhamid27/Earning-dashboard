import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanQuarterLabel, todayIST, daysAgoIST } from "@/lib/api";
import { pctChange, TURNED_PROFITABLE, TURNED_LOSS_MAKING } from "@/lib/growth";

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

  // "Reported" = distinct companies that announced results this season.
  // For the CURRENT season we prefer announcement_events (catches companies
  // that announced but whose PDF hasn't been parsed yet — avoids 3–4× undercount
  // in the first wave). For PAST seasons the 90-day window misses old announcements
  // entirely, so we fall back to the quarterly_financials count for that quarter.
  // We take max(announcement_events count, quarterly_financials count) so the
  // current season gets the higher number and past seasons get their real total.
  const todayIso = todayIST();
  const ninetyDaysAgo = daysAgoIST(90);
  const { data: announcedEvents } = await sb
    .from("announcement_events")
    .select("ticker,companies!inner(is_active)")
    .eq("status", "fetched")
    .eq("companies.is_active", true)
    .gte("announcement_date", ninetyDaysAgo)
    .lte("announcement_date", todayIso);
  const announcedTickers = new Set<string>();
  for (const e of announcedEvents ?? []) announcedTickers.add(e.ticker);

  if (!targetQuarter) {
    return jsonOk({
      quarter: null,
      companies_tracked: universeCount ?? 0,
      companies_reported: announcedTickers.size,
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

  // Count distinct tickers that filed for this quarter (definitive for past seasons).
  const qfCount = new Set(cur?.map((r) => r.ticker) ?? []).size;
  // Use the higher of announcement_events (better for current season) vs
  // quarterly_financials count (better for past seasons where the 90-day
  // announcement_events window returns 0).
  const reportedCount = Math.max(announcedTickers.size, qfCount);

  if (!cur || cur.length === 0) {
    return jsonOk({
      quarter: targetQuarter,
      companies_tracked: universeCount ?? 0,
      companies_reported: reportedCount,
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

  // Aggregate totals for size-weighted YoY (same methodology as Moneycontrol / industry standard).
  // Only include companies that have both current and prior year data.
  let totalRev = 0, totalRevPrev = 0;
  let totalProf = 0, totalProfPrev = 0;
  let revPairs = 0, profPairs = 0;

  type SectorAgg = { rev: number; revPrev: number; prof: number; profPrev: number; reported: number; revPairs: number; profPairs: number };
  const bySector = new Map<string, SectorAgg>();

  for (const row of cur) {
    const p = priorByTicker.get(row.ticker);

    if (row.revenue != null && p?.rev != null) {
      totalRev     += row.revenue;
      totalRevPrev += p.rev;
      revPairs++;
    }
    if (row.net_profit != null && p?.prof != null) {
      totalProf     += row.net_profit;
      totalProfPrev += p.prof;
      profPairs++;
    }

    const sector = (row as any).companies?.sector ?? null;
    if (sector) {
      const s = bySector.get(sector) ?? { rev: 0, revPrev: 0, prof: 0, profPrev: 0, reported: 0, revPairs: 0, profPairs: 0 };
      // Only include in sector aggregate when both years exist — avoids inflating
      // YoY by treating missing prior-year as zero.
      if (row.revenue != null && p?.rev != null) {
        s.rev     += row.revenue;
        s.revPrev += p.rev;
        s.revPairs++;
      }
      if (row.net_profit != null && p?.prof != null) {
        s.prof     += row.net_profit;
        s.profPrev += p.prof;
        s.profPairs++;
      }
      s.reported += 1;
      bySector.set(sector, s);
    }
  }

  // Aggregate YoY: total this quarter / total prior quarter - 1.
  // Weights each company by its absolute size so large caps don't get
  // drowned out by dozens of tiny companies — matches industry reporting.
  const aggYoy = (curr: number, prev: number, pairs: number) =>
    pairs === 0 || prev === 0 ? null : (curr - prev) / Math.abs(prev);

  // Sector-level cap: ±200% — sector aggregates should be stable; anything
  // beyond this is a base-effect artefact (tiny prior-year profits), not signal.
  // Also require ≥3 companies with YoY pairs to avoid single-stock sectors.
  const SECTOR_CAP = 2.0;
  const SECTOR_MIN_PAIRS = 3;

  const topSectors = Array.from(bySector.entries())
    .map(([sector, s]) => ({
      sector,
      companies_reported: s.reported,
      revenue_yoy: s.revPairs > 0 && s.revPrev !== 0
        ? (s.rev - s.revPrev) / Math.abs(s.revPrev)
        : null
    }))
    .filter((s) => s.revenue_yoy != null
      && Math.abs(s.revenue_yoy) <= SECTOR_CAP
      && (bySector.get(s.sector)?.revPairs ?? 0) >= SECTOR_MIN_PAIRS)
    .sort((a, b) => (b.revenue_yoy! - a.revenue_yoy!))
    .slice(0, 5);

  // Top and bottom sector by aggregate profit YoY.
  const sectorsByProfit = Array.from(bySector.entries())
    .map(([sector, s]) => ({
      sector,
      profit_yoy: s.profPairs > 0 && s.profPrev !== 0
        ? (s.prof - s.profPrev) / Math.abs(s.profPrev)
        : null,
      profPairs: s.profPairs
    }))
    .filter((s) => s.profit_yoy != null
      && Math.abs(s.profit_yoy) <= SECTOR_CAP
      && s.profPairs >= SECTOR_MIN_PAIRS)
    .sort((a, b) => b.profit_yoy! - a.profit_yoy!);

  const top_sector_by_profit    = sectorsByProfit[0]                          ?? null;
  const bottom_sector_by_profit = sectorsByProfit[sectorsByProfit.length - 1] ?? null;

  return jsonOk({
    quarter: targetQuarter,
    companies_tracked: universeCount ?? 0,
    companies_reported: reportedCount,
    avg_revenue_yoy: aggYoy(totalRev, totalRevPrev, revPairs),
    avg_profit_yoy: aggYoy(totalProf, totalProfPrev, profPairs),
    top_sectors_by_rev_growth: topSectors,
    top_sector_by_profit,
    bottom_sector_by_profit,
    last_refreshed_at: lastFetched.data?.fetched_at ?? null
  });
}
