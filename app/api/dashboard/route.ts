import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanQuarterLabel } from "@/lib/api";
import { pctChange, withGrowth } from "@/lib/growth";
import type { LatestQuarterRow } from "@/lib/types";

// GET /api/dashboard?quarter=Q4 FY26&sector=Financials&q=bank&bucket=LARGE
//
// Aggregated endpoint used by the main table so the frontend can make one
// request instead of five. Returns one row per company with the latest
// reported quarter, YoY/QoQ growth, and an 8-quarter sparkline of revenue.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const quarter = cleanQuarterLabel(sp.get("quarter"));
  const sector = sp.get("sector");
  const search = sp.get("q")?.trim();
  const bucket = sp.get("bucket");

  const sb = supabaseServer();

  // Universe of active companies, filtered by sector / bucket / search.
  let cQuery = sb.from("companies").select("*").eq("is_active", true);
  if (sector) cQuery = cQuery.eq("sector", sector);
  if (bucket) cQuery = cQuery.eq("market_cap_bucket", bucket);
  if (search) cQuery = cQuery.or(`company_name.ilike.%${search}%,ticker.ilike.%${search}%`);
  const { data: companies, error: cErr } = await cQuery;
  if (cErr) return jsonError(cErr.message, 500);
  if (!companies || companies.length === 0) return jsonOk({ quarter, rows: [] });

  const tickers = companies.map((c) => c.ticker);
  // Supabase caps a single select() at 1000 rows. With 500 companies × ~5
  // quarters each we blow past that — so we paginate via `.range()`.
  const PAGE = 1000;
  const allFin: Array<{
    ticker: string; quarter_label: string; quarter_end_date: string;
    fiscal_year: number; fiscal_quarter: number;
    revenue: number | null; net_profit: number | null;
    operating_profit: number | null; eps: number | null;
    data_quality_status: any; fetched_at: string;
  }> = [];
  for (let page = 0; page < 20; page++) {
    const { data, error: fErr } = await sb
      .from("quarterly_financials")
      .select("ticker,quarter_label,quarter_end_date,fiscal_year,fiscal_quarter,revenue,net_profit,operating_profit,eps,data_quality_status,fetched_at")
      .in("ticker", tickers)
      .order("quarter_end_date", { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (fErr) return jsonError(fErr.message, 500);
    if (!data || data.length === 0) break;
    allFin.push(...data as any);
    if (data.length < PAGE) break;
  }

  type FinRow = (typeof allFin)[number];
  const byTicker = new Map<string, FinRow[]>();
  for (const row of allFin) {
    const arr = byTicker.get(row.ticker) ?? [];
    arr.push(row);
    byTicker.set(row.ticker, arr);
  }

  // Per-ticker upcoming announcement date (nearest pending event). Used on
  // "Not reported yet" rows so the reader knows when to check back.
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: upcomingEvents } = await sb
    .from("announcement_events")
    .select("ticker,announcement_date")
    .in("ticker", tickers)
    .eq("status", "pending")
    .gte("announcement_date", todayIso)
    .order("announcement_date", { ascending: true });
  const nextDateByTicker = new Map<string, string>();
  for (const e of upcomingEvents ?? []) {
    if (!nextDateByTicker.has(e.ticker)) nextDateByTicker.set(e.ticker, e.announcement_date);
  }

  const rows: LatestQuarterRow[] = companies.map((c) => {
    const hist = byTicker.get(c.ticker) ?? [];
    // When a quarter filter is set, only use that quarter's row — do NOT
    // fall back to an older one. That way the table shows "not reported"
    // for companies that haven't filed Q4 yet, instead of silently mixing
    // quarters (which made the whole table misleading).
    const match = quarter ? hist.find((r) => r.quarter_label === quarter) : null;
    const latest = quarter ? match : hist[hist.length - 1];
    // Prefer the scraped event date; fall back to the hand-curated column.
    const nextDate = nextDateByTicker.get(c.ticker) ?? c.next_result_date ?? null;
    if (!latest) {
      return {
        company_id: c.id,
        company_name: c.company_name,
        sector: c.sector,
        industry: c.industry,
        exchange: c.exchange,
        ticker: c.ticker,
        quarter_label: quarter ?? "—",
        quarter_end_date: "",
        revenue: null,
        net_profit: null,
        operating_profit: null,
        eps: null,
        data_quality_status: "missing",
        fetched_at: "",
        revenue_trend: hist.slice(-8).map((r) => ({ q: r.quarter_label, v: r.revenue })),
        next_result_date: nextDate
      };
    }
    const idx = hist.findIndex((r) => r.quarter_end_date === latest.quarter_end_date);
    const prevQ = idx >= 1 ? hist[idx - 1] : null;
    const prevY = idx >= 4 ? hist[idx - 4] : null;

    return {
      company_id: c.id,
      company_name: c.company_name,
      sector: c.sector,
      industry: c.industry,
      exchange: c.exchange,
      ticker: c.ticker,
      quarter_label: latest.quarter_label,
      quarter_end_date: latest.quarter_end_date,
      revenue: latest.revenue,
      net_profit: latest.net_profit,
      operating_profit: latest.operating_profit,
      eps: latest.eps,
      data_quality_status: latest.data_quality_status,
      fetched_at: latest.fetched_at,
      revenue_qoq: pctChange(latest.revenue, prevQ?.revenue ?? null),
      revenue_yoy: pctChange(latest.revenue, prevY?.revenue ?? null),
      profit_qoq: pctChange(latest.net_profit, prevQ?.net_profit ?? null),
      profit_yoy: pctChange(latest.net_profit, prevY?.net_profit ?? null),
      revenue_trend: hist.slice(-8).map((r) => ({ q: r.quarter_label, v: r.revenue })),
      next_result_date: nextDate
    };
  });

  // Also return the distinct quarters present in the data, for the selector.
  const quarters = Array.from(new Set(allFin.map((r) => r.quarter_label))).sort();

  return jsonOk({ quarter: quarter ?? null, rows, quarters });
}
