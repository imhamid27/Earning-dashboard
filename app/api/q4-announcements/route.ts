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

  type Company = {
    ticker: string; company_name: string; sector: string | null; industry: string | null;
    revenue: number | null; net_profit: number | null; operating_profit: number | null;
    eps: number | null; data_quality_status: string;
    revenue_yoy: number | null; profit_yoy: number | null;
  };
  const undated: Company[] = [];

  // ---------------------------------------------------------------------
  // Past (announced) tabs.
  //
  // Previously we built these from `quarterly_financials` — meaning a
  // company only appeared once we'd successfully scraped its numbers.
  // That under-counted compared to Moneycontrol: e.g. 16 Apr showed 5 on
  // our page but 14 on theirs.
  //
  // Source of truth is now `announcement_events` with status='fetched' —
  // every company our calendar scrapers have confirmed as "announced".
  // We enrich each row with its Q4 FY26 numbers when available; if the
  // numbers haven't been fetched yet, the tab still shows the company
  // (with blank figures — the StatusBadge then reads "Announced, numbers
  // to follow" in the UI).
  // ---------------------------------------------------------------------
  const todayIso = new Date().toISOString().slice(0, 10);

  // Key the quarterly rows by ticker so we can look up numbers in O(1).
  const numbersByTicker = new Map<string, Row>();
  for (const r of ((rows ?? []) as unknown) as Row[]) {
    numbersByTicker.set(r.ticker, r);
  }

  // Pull all "fetched" events whose announcement_date looks like it could
  // belong to the target quarter's reporting season. For Q4 FY26 (Mar-end)
  // the filing window runs mid-April through June, so 90 days back from
  // today is a safe upper bound.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const { data: pastEvents } = await sb
    .from("announcement_events")
    .select("ticker,announcement_date,companies!inner(company_name,sector,industry)")
    .eq("status", "fetched")
    .gte("announcement_date", ninetyDaysAgo)
    .lte("announcement_date", todayIso)
    .order("announcement_date", { ascending: true });

  // Dedupe: one row per (ticker, date). Same meeting can appear under
  // multiple sources (NSE + BSE + Moneycontrol); collapse them.
  const pastByDate = new Map<string, Map<string, Company>>();
  for (const e of pastEvents ?? []) {
    const dateKey = e.announcement_date;
    if (!pastByDate.has(dateKey)) pastByDate.set(dateKey, new Map());
    const per = pastByDate.get(dateKey)!;
    if (per.has(e.ticker)) continue;
    const numbers = numbersByTicker.get(e.ticker);
    const prior = priorByTicker.get(e.ticker);
    const info: any = (e as any).companies || {};
    per.set(e.ticker, {
      ticker: e.ticker,
      company_name: info.company_name ?? e.ticker,
      sector: info.sector ?? null,
      industry: info.industry ?? null,
      revenue: numbers?.revenue ?? null,
      net_profit: numbers?.net_profit ?? null,
      operating_profit: numbers?.operating_profit ?? null,
      eps: numbers?.eps ?? null,
      data_quality_status: numbers?.data_quality_status ?? "partial",
      revenue_yoy: numbers ? pctChange(numbers.revenue, prior?.revenue ?? null) : null,
      profit_yoy:  numbers ? pctChange(numbers.net_profit, prior?.net_profit ?? null) : null,
    });
  }

  // Past tabs: chronological ascending. Companies within a date sorted by
  // revenue (big first), then by name for the numbers-less tail.
  const past = Array.from(pastByDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, m]) => ({
      date,
      kind: "reported" as const,
      companies: Array.from(m.values()).sort((a, b) => {
        const ra = a.revenue ?? -1, rb = b.revenue ?? -1;
        if (ra !== rb) return rb - ra;
        return a.company_name.localeCompare(b.company_name);
      })
    }));

  // Future tabs: companies SCHEDULED to report in the coming weeks. Pulled
  // from announcement_events where status='pending' and date >= today.
  // We don't filter by purpose string because during a given reporting
  // season, the only pending announcements are for the current quarter.
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
  // Drop any future date that also exists in past — otherwise "today"
  // appears twice (once as a reported tab with the companies that have
  // filed, once as a scheduled tab with the ones still pending). Rolling
  // pending-today tickers into today's reported tab is the right UX but
  // complicates the data shape; for now, suppress the duplicate tab and
  // let those tickers resurface tomorrow if they slip.
  const pastDates = new Set(past.map((d) => d.date));
  const future = Array.from(scheduledGroups.entries())
    .filter(([date]) => !pastDates.has(date))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, m]) => ({
      date,
      kind: "scheduled" as const,
      companies: Array.from(m.values()).sort((a, b) => a.company_name.localeCompare(b.company_name))
    }));

  const total_scheduled = future.reduce((n, d) => n + d.companies.length, 0);
  // total_reported = distinct companies across past tabs (matches tab
  // counts). Previously used rows.length from quarterly_financials, which
  // undercounted because many announced companies don't have numbers
  // fetched yet.
  const reportedTickers = new Set<string>();
  for (const d of past) for (const c of d.companies) reportedTickers.add(c.ticker);

  return jsonOk({
    quarter,
    total_reported: reportedTickers.size,
    total_scheduled,
    dates: [...past, ...future],
    undated
  });
}
