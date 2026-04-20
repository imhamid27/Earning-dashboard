import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanQuarterLabel } from "@/lib/api";
import { pctChange } from "@/lib/growth";

// GET /api/q4-announcements?quarter=Q4 FY26
//
// Returns all companies that have filed the requested quarter (defaults to
// Q4 FY26), grouped by the actual announcement/filing date so the dashboard
// can render a date-tabbed view.
//
// Announcement date resolution order:
//   1. NSE rows: raw_json.broadCastDate or filingDate ("17-Apr-2026 15:30")
//   2. A matching row in announcement_events (status = 'fetched')
//   3. quarterly_financials.fetched_at (timestamp we ingested it — usually
//      within a few hours of the actual filing)

interface Row {
  ticker: string;
  quarter_label: string;
  quarter_end_date: string;
  revenue: number | null;
  net_profit: number | null;
  operating_profit: number | null;
  eps: number | null;
  fetched_at: string;
  data_quality_status: string;
  raw_json: any;
  companies: { company_name: string; sector: string | null; industry: string | null } | null;
}

function parseLooseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Accept "17-Apr-2026", "17-Apr-2026 15:30:00", "2026-04-17", "17/04/2026".
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Try direct Date.parse first (handles ISO).
  const iso = new Date(trimmed).toISOString().slice(0, 10);
  if (iso && iso !== "Invalid Date" && !Number.isNaN(new Date(iso).getTime())) {
    // Guard: Date.parse accepts "17-Apr-2026 15:30" in most runtimes.
    const t = new Date(trimmed).getTime();
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  }
  // Manual "DD-MMM-YYYY"
  const m = /^(\d{1,2})[-\/ ]([A-Za-z]{3})[-\/ ](\d{4})/.exec(trimmed);
  if (m) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const mm = months.indexOf(m[2].toLowerCase());
    if (mm >= 0) return `${m[3]}-${String(mm + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function announcementDateFor(row: Row, eventDateByKey: Map<string, string>): string | null {
  const fromRaw =
    parseLooseDate(row.raw_json?.broadCastDate) ||
    parseLooseDate(row.raw_json?.filingDate) ||
    parseLooseDate(row.raw_json?.exchdisstime);
  if (fromRaw) return fromRaw;
  const fromEvent = eventDateByKey.get(`${row.ticker}|${row.quarter_end_date}`);
  if (fromEvent) return fromEvent;
  return row.fetched_at ? row.fetched_at.slice(0, 10) : null;
}

export async function GET(req: NextRequest) {
  const quarter = cleanQuarterLabel(req.nextUrl.searchParams.get("quarter")) || "Q4 FY26";
  const sb = supabaseServer();

  const { data: rows, error } = await sb
    .from("quarterly_financials")
    .select("ticker,quarter_label,quarter_end_date,revenue,net_profit,operating_profit,eps,fetched_at,data_quality_status,raw_json,companies!inner(company_name,sector,industry)")
    .eq("quarter_label", quarter);
  if (error) return jsonError(error.message, 500);

  // Load the YoY counterpart (Q4 FY25 if quarter=Q4 FY26) for growth calc.
  const fyMatch = /^Q([1-4])\s*FY(\d{2})$/.exec(quarter);
  let priorByTicker = new Map<string, { revenue: number | null; net_profit: number | null }>();
  if (fyMatch) {
    const fq = Number(fyMatch[1]);
    const fy = 2000 + Number(fyMatch[2]);
    const priorLabel = `Q${fq} FY${String(fy - 1).slice(-2)}`;
    const { data: prior } = await sb
      .from("quarterly_financials")
      .select("ticker,revenue,net_profit")
      .eq("quarter_label", priorLabel);
    for (const p of prior ?? []) {
      priorByTicker.set(p.ticker, { revenue: p.revenue, net_profit: p.net_profit });
    }
  }

  // Pull announcement_events to recover the REAL filing date per ticker.
  // We pick the most-recent fetched event (most Screener-sourced rows have
  // no broadCastDate, so without this every row falsely gets the scrape
  // timestamp as its "announcement" date).
  const tickers = Array.from(new Set((rows ?? []).map((r: any) => r.ticker)));
  const eventDateByKey = new Map<string, string>();
  if (tickers.length > 0) {
    const { data: events } = await sb
      .from("announcement_events")
      .select("ticker,announcement_date")
      .in("ticker", tickers)
      .eq("status", "fetched")
      .order("announcement_date", { ascending: false });
    for (const e of events ?? []) {
      // First one wins = most recent. Keeps one map entry per ticker.
      if (!eventDateByKey.has(e.ticker)) eventDateByKey.set(e.ticker, e.announcement_date);
    }
  }

  // Group by announcement date.
  type Company = {
    ticker: string; company_name: string; sector: string | null; industry: string | null;
    revenue: number | null; net_profit: number | null; operating_profit: number | null;
    eps: number | null; data_quality_status: string;
    revenue_yoy: number | null; profit_yoy: number | null;
  };
  const grouped = new Map<string, Company[]>();
  const undated: Company[] = [];

  for (const r of ((rows ?? []) as unknown) as Row[]) {
    // Prefer the fetched-event date from announcement_events — that's the
    // real day the company filed. XBRL broadCastDate is authoritative when
    // it exists (NSE filings), so check it next. Scrape timestamp is only
    // a last resort.
    const fromEvent = eventDateByKey.get(r.ticker);
    const fromRaw =
      parseLooseDate(r.raw_json?.broadCastDate) ||
      parseLooseDate(r.raw_json?.filingDate) ||
      parseLooseDate(r.raw_json?.exchdisstime);
    const date = fromEvent ?? fromRaw ?? (r.fetched_at ? r.fetched_at.slice(0, 10) : null);
    const prior = priorByTicker.get(r.ticker);
    const comp: Company = {
      ticker: r.ticker,
      company_name: r.companies?.company_name ?? r.ticker,
      sector: r.companies?.sector ?? null,
      industry: r.companies?.industry ?? null,
      revenue: r.revenue,
      net_profit: r.net_profit,
      operating_profit: r.operating_profit,
      eps: r.eps,
      data_quality_status: r.data_quality_status,
      revenue_yoy: pctChange(r.revenue, prior?.revenue ?? null),
      profit_yoy: pctChange(r.net_profit, prior?.net_profit ?? null),
    };
    if (!date) { undated.push(comp); continue; }
    const arr = grouped.get(date) ?? [];
    arr.push(comp);
    grouped.set(date, arr);
  }

  // Past tabs: dates when companies actually reported, grouped by day.
  // Sort ASCENDING so past + future form one chronological timeline.
  const past = Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, companies]) => ({
      date,
      kind: "reported" as const,
      companies: companies.sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
    }));

  // Future tabs: companies SCHEDULED to report in the coming weeks. Pulled
  // from announcement_events where status='pending' and date >= today.
  // We don't filter by purpose string because during a given reporting
  // season, the only pending announcements are for the current quarter.
  const todayIso = new Date().toISOString().slice(0, 10);
  const alreadyReported = new Set<string>();
  for (const d of past) for (const c of d.companies) alreadyReported.add(c.ticker);

  const { data: scheduledEvents } = await sb
    .from("announcement_events")
    .select("ticker,announcement_date,purpose,companies!inner(company_name,sector)")
    .gte("announcement_date", todayIso)
    .eq("status", "pending")
    .order("announcement_date", { ascending: true });

  // Dedupe by (ticker, date) — a company often has rows from both BSE + NSE
  // calendars for the same meeting. Skip any ticker that's already reported.
  type ScheduledCompany = {
    ticker: string; company_name: string; sector: string | null;
    purpose: string | null;
  };
  const scheduledGroups = new Map<string, Map<string, ScheduledCompany>>();
  for (const e of scheduledEvents ?? []) {
    if (alreadyReported.has(e.ticker)) continue;
    const dateKey = e.announcement_date;
    if (!scheduledGroups.has(dateKey)) scheduledGroups.set(dateKey, new Map());
    const perDate = scheduledGroups.get(dateKey)!;
    const cur = perDate.get(e.ticker);
    // Keep the longer/more informative purpose if we have two rows.
    if (!cur || ((e.purpose?.length ?? 0) > (cur.purpose?.length ?? 0))) {
      perDate.set(e.ticker, {
        ticker: e.ticker,
        company_name: (e as any).companies?.company_name ?? e.ticker,
        sector: (e as any).companies?.sector ?? null,
        purpose: e.purpose ?? null
      });
    }
  }
  const future = Array.from(scheduledGroups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, m]) => ({
      date,
      kind: "scheduled" as const,
      companies: Array.from(m.values()).sort((a, b) => a.company_name.localeCompare(b.company_name))
    }));

  const total_scheduled = future.reduce((n, d) => n + d.companies.length, 0);

  return jsonOk({
    quarter,
    total_reported: (rows ?? []).length,
    total_scheduled,
    dates: [...past, ...future],
    undated
  });
}
