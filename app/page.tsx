"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import FeaturedHeroCard from "@/components/FeaturedHeroCard";
import FeaturedCard from "@/components/FeaturedCard";
import FilingLoader from "@/components/FilingLoader";
import CompanyTable from "@/components/CompanyTable";
import SectorComparison from "@/components/SectorComparison";
import TrendChart from "@/components/TrendChart";
import CompanySearch from "@/components/CompanySearch";
import FreshnessIndicator from "@/components/FreshnessIndicator";
import EmptyState from "@/components/EmptyState";
import { formatDate, formatPct, pctToneClass } from "@/lib/format";
import type { LatestQuarterRow } from "@/lib/types";

const DEFAULT_QUARTER = process.env.NEXT_PUBLIC_DEFAULT_QUARTER || "Q4 FY26";

// Curated "major" names used in the "Major companies yet to report"
// strip. These are the big-cap bellwethers readers expect to see in
// every quarter's headline coverage. Keep the list short — 6 show in
// the UI, the rest are fall-throughs if some are already reported.
const MAJOR_TICKERS = [
  "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "INFY.NS", "ICICIBANK.NS",
  "ITC.NS", "HINDUNILVR.NS", "SBIN.NS", "BHARTIARTL.NS", "LT.NS",
  "BAJFINANCE.NS", "HCLTECH.NS", "KOTAKBANK.NS", "MARUTI.NS", "ASIANPAINT.NS"
];

function yoyQuarter(q: string): string {
  const m = /^Q([1-4])\s*FY(\d{2})$/.exec(q.trim());
  if (!m) return q;
  return `Q${m[1]} FY${String(Number(m[2]) - 1).padStart(2, "0")}`;
}
function quarterAsCalendar(q: string): string {
  const m = /^Q([1-4])\s*FY(\d{2})$/.exec(q.trim());
  if (!m) return "";
  const fq = Number(m[1]);
  const fyEnd = 2000 + Number(m[2]);
  const ranges: Record<number, [string, number]> = {
    1: ["Apr–Jun", fyEnd - 1],
    2: ["Jul–Sep", fyEnd - 1],
    3: ["Oct–Dec", fyEnd - 1],
    4: ["Jan–Mar", fyEnd]
  };
  const [label, year] = ranges[fq];
  return `${label} ${year}`;
}

interface DashboardResp { quarter: string | null; rows: LatestQuarterRow[]; quarters: string[]; }
interface SummaryResp {
  quarter: string | null;
  companies_tracked: number;
  companies_reported: number;
  avg_revenue_yoy: number | null;
  avg_profit_yoy: number | null;
  top_sectors_by_rev_growth: Array<{ sector: string; revenue_yoy: number | null; companies_reported: number }>;
  last_refreshed_at: string | null;
}
interface SectorResp {
  quarter: string | null;
  sectors: Array<{ sector: string; companies_reported: number; total_revenue: number; total_net_profit: number; revenue_yoy: number | null; profit_yoy: number | null }>;
}
interface UpcomingItem { ticker: string; company_name: string; sector: string | null; next_result_date: string }

// Minimum time the brand loader stays on screen. Prevents the ~200 ms
// Supabase round-trip from flashing past so the loader has a real presence.
const MIN_LOADER_MS = 850;

export default function DashboardPage() {
  const [quarter, setQuarter] = useState<string>(DEFAULT_QUARTER);
  const [availableQuarters, setAvailableQuarters] = useState<string[]>([DEFAULT_QUARTER]);
  const [board, setBoard] = useState<DashboardResp | null>(null);
  const [summary, setSummary] = useState<SummaryResp | null>(null);
  const [sectors, setSectors] = useState<SectorResp | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setMinTimeElapsed(true), MIN_LOADER_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    fetch("/api/quarters").then((r) => r.json())
      .then((j) => { if (j.ok && j.data?.length) setAvailableQuarters(j.data); })
      .catch(() => {});
  }, []);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [b, s, sec, up] = await Promise.all([
        fetch(`/api/dashboard?quarter=${encodeURIComponent(quarter)}`).then((r) => r.json()),
        fetch(`/api/summary?quarter=${encodeURIComponent(quarter)}`).then((r) => r.json()),
        fetch(`/api/sectors?quarter=${encodeURIComponent(quarter)}`).then((r) => r.json()),
        fetch(`/api/upcoming`).then((r) => r.json())
      ]);
      if (!b.ok) throw new Error(b.error || "dashboard failed");
      setBoard(b.data);
      setSummary(s.ok ? s.data : null);
      setSectors(sec.ok ? sec.data : null);
      setUpcoming(up.ok ? up.data : []);
    } catch (err: any) { setError(err.message || "Failed to load"); }
  }, [quarter]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const reported = useMemo(
    () => (board?.rows ?? [])
      .filter((r) => r.quarter_end_date)
      .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0)),
    [board]
  );

  // Today / this week counters for the context row below the hero.
  // Today = reporting today (already announced or still pending).
  // Week = anything scheduled within the next 7 days (today inclusive).
  const { reportingToday, reportingThisWeek } = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString().slice(0, 10);
    const week = new Date(today.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
    const todayTickers = new Set<string>();
    const weekTickers  = new Set<string>();
    for (const u of upcoming) {
      if (u.next_result_date >= todayIso && u.next_result_date <= week) weekTickers.add(u.ticker);
      if (u.next_result_date === todayIso) todayTickers.add(u.ticker);
    }
    // Also add already-reported-today so the count reflects "filing today"
    // not just "not yet reported today".
    for (const r of board?.rows ?? []) {
      if (r.result_date === todayIso && r.status === "announced_with_numbers") {
        todayTickers.add(r.ticker);
        weekTickers.add(r.ticker);
      }
    }
    return { reportingToday: todayTickers.size, reportingThisWeek: weekTickers.size };
  }, [upcoming, board]);

  // Editorial one-liner: which sector is leading revenue vs profit growth
  // this quarter. Derived client-side from board rows so it always tracks
  // the currently-selected quarter.
  const insight = useMemo<string | null>(() => {
    const rows = (board?.rows ?? []).filter((r) => r.status === "announced_with_numbers" && r.sector);
    if (rows.length < 3) return null;
    const bySector = new Map<string, { rev: number[]; prof: number[] }>();
    for (const r of rows) {
      const s = r.sector!;
      if (!bySector.has(s)) bySector.set(s, { rev: [], prof: [] });
      if (r.revenue_yoy != null) bySector.get(s)!.rev.push(r.revenue_yoy);
      if (r.profit_yoy  != null) bySector.get(s)!.prof.push(r.profit_yoy);
    }
    const avg = (xs: number[]) => xs.length >= 2
      ? xs.reduce((a, b) => a + b, 0) / xs.length
      : null;
    let revLead: [string, number] | null = null;
    let profLead: [string, number] | null = null;
    for (const [s, x] of bySector) {
      const ra = avg(x.rev); if (ra != null && (!revLead || ra > revLead[1])) revLead = [s, ra];
      const pa = avg(x.prof); if (pa != null && (!profLead || pa > profLead[1])) profLead = [s, pa];
    }
    if (!revLead && !profLead) return null;
    if (revLead && profLead && revLead[0] !== profLead[0]) {
      return `${revLead[0]} is leading revenue growth; ${profLead[0]} is leading profit growth so far this quarter.`;
    }
    const lead = revLead ?? profLead!;
    return `${lead[0]} is leading both revenue and profit growth so far this quarter.`;
  }, [board]);

  // "Major companies yet to report" — curated big-cap bellwethers that
  // haven't filed Q4 FY26 numbers yet. Shows up to 6.
  const majorsYetToReport = useMemo(() => {
    const rowsByTicker = new Map(((board?.rows ?? []).map((r) => [r.ticker, r])));
    const out: LatestQuarterRow[] = [];
    for (const t of MAJOR_TICKERS) {
      const r = rowsByTicker.get(t);
      if (!r) continue;
      if (r.status !== "announced_with_numbers") out.push(r);
      if (out.length >= 6) break;
    }
    return out;
  }, [board]);

  // "All reporters" sort + pagination. Sort is chosen via a dropdown;
  // 20 rows per page.
  const [allSort, setAllSort] = useState<"revenue" | "profit_yoy" | "result_date">("revenue");
  const [allPage, setAllPage] = useState(0);
  useEffect(() => { setAllPage(0); }, [allSort, quarter]);

  // When a search result is picked, flip "All reporters" to the page
  // containing that company (if any), then scroll the matching row
  // into view and briefly highlight it.
  const scrollToTicker = useCallback((ticker: string) => {
    const rest = (board?.rows ?? [])
      .filter((r) => r.quarter_end_date)
      .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
      .slice(5);
    const sortedRest = [...rest].sort((a, b) => {
      if (allSort === "profit_yoy") return (b.profit_yoy ?? -Infinity) - (a.profit_yoy ?? -Infinity);
      if (allSort === "result_date") return (b.result_date ?? "").localeCompare(a.result_date ?? "");
      return (b.revenue ?? 0) - (a.revenue ?? 0);
    });
    const restIdx = sortedRest.findIndex((r) => r.ticker === ticker);
    if (restIdx >= 0) setAllPage(Math.floor(restIdx / 20));
    window.setTimeout(() => {
      const el = document.querySelector(
        `[data-ticker="${CSS.escape(ticker)}"]`
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-core-pink", "transition-shadow");
        window.setTimeout(() => el.classList.remove("ring-2", "ring-core-pink"), 1800);
      }
    }, 80);
  }, [board, allSort]);

  const overallTrend = useMemo(() => {
    const agg = new Map<string, { quarter_label: string; revenue: number | null; net_profit: number | null }>();
    for (const r of board?.rows ?? []) {
      for (const t of r.revenue_trend ?? []) {
        const cur = agg.get(t.q) ?? { quarter_label: t.q, revenue: 0, net_profit: null };
        cur.revenue = (cur.revenue ?? 0) + (t.v ?? 0);
        agg.set(t.q, cur);
      }
    }
    return Array.from(agg.values()).sort((a, b) => a.quarter_label.localeCompare(b.quarter_label));
  }, [board]);

  const nextUpcoming = upcoming[0];
  const nextLabel = useMemo(() => {
    if (!nextUpcoming) return "—";
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const t = new Date(nextUpcoming.next_result_date + "T00:00:00").getTime();
    const d = Math.round((t - today.getTime()) / 86_400_000);
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    if (d > 0)  return `In ${d}d`;
    return formatDate(nextUpcoming.next_result_date);
  }, [nextUpcoming]);

  if (error) return (
    <div className="container-core py-10">
      <EmptyState title="Couldn't load the dashboard" message={error}
        cta={<button onClick={fetchAll} className="btn-ink">Retry</button>} />
    </div>
  );

  // Show the brand loader on first paint. It stays up until BOTH the
  // dashboard fetch has resolved AND the minimum display time has elapsed.
  // That way fast Supabase responses don't flash the loader for 80 ms and
  // slow responses are still covered gracefully.
  if (!board || !minTimeElapsed) return (
    <div className="container-core">
      <FilingLoader quarter={quarter} total={500} label="Reading filings" />
    </div>
  );

  const lead = reported[0];
  const nextFour = reported.slice(1, 5);
  const restStart = 5;
  const rest = reported.slice(restStart);
  const cal = quarterAsCalendar(quarter);

  // Progress bar: reported-of-tracked, as a data visual in the hero.
  const trackedTotal = summary?.companies_tracked ?? 500;
  const reportedCount = summary?.companies_reported ?? 0;
  const progress = trackedTotal > 0 ? reportedCount / trackedTotal : 0;

  return (
    <div className="container-core">
      {/* =================================================================
          HERO — clean white, editorial masthead composition
          Left: kicker, quarter title, big reporter count + progress bar
          Right: quarter selector + freshness + CTA
          Below: a thin "top reporters" strip (divides the hero from the
          body with real data instead of chrome).
          ================================================================= */}
      <section className="pt-6 md:pt-14 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 items-end">
          <div className="md:col-span-8">
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-core-muted mb-3 md:mb-4 whitespace-nowrap">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink" />
              <span>India earnings</span>
              <span className="text-core-line-2">/</span>
              <span className="text-core-ink font-semibold">{quarter}</span>
              {cal ? <><span className="text-core-line-2">/</span><span>{cal}</span></> : null}
            </div>
            <h1 className="font-sans font-bold tracking-tightest leading-[0.95] text-[clamp(2.5rem,6vw,4.75rem)]">
              India Inc. Reporting
            </h1>
            <p className="mt-5 md:mt-6 text-core-muted text-[14px] md:text-[15px] max-w-lg leading-relaxed">
              Quarterly results across India&apos;s listed companies, updated as each
              filing lands.
            </p>
          </div>

          <div className="md:col-span-4 flex flex-wrap items-center md:flex-col md:items-end gap-2 md:gap-3">
            <label className="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.14em] text-core-muted">
              Viewing
              <select
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                className="border border-core-line bg-white text-sm px-3 py-2 rounded-md normal-case text-core-ink font-semibold focus:outline-none focus:border-core-pink"
              >
                {availableQuarters.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </label>
            {summary ? <FreshnessIndicator fetchedAt={summary.last_refreshed_at} /> : null}
            <Link href="/q4" className="btn-ghost ml-auto md:ml-0">
              Day-by-day view <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Primary reporting-context row — replaces the busier hero
          number block. One clean line with three counts (today, this
          week, season-to-date) and a slim progress bar for the quarter. */}
      <section className="mt-6 md:mt-8 border-y border-core-line py-4 md:py-5">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
          <Stat
            label="Today"
            value={reportingToday}
            suffix={reportingToday === 1 ? "company reporting" : "reporting"}
            accent={reportingToday > 0}
          />
          <Stat
            label="This week"
            value={reportingThisWeek}
            suffix="reporting"
          />
          <Stat
            label={`${quarter} so far`}
            value={reportedCount}
            suffix={`filed · ${trackedTotal.toLocaleString()} tracked`}
          />
        </div>
        <div className="mt-4 max-w-md">
          <div
            className="h-[3px] rounded-full bg-core-line overflow-hidden"
            role="progressbar"
            aria-valuenow={reportedCount}
            aria-valuemax={trackedTotal}
          >
            <div
              className="h-full bg-core-ink transition-all duration-700"
              style={{ width: `${(progress * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-core-muted tabular-nums">
            {(progress * 100).toFixed(0)}% of the reporting season complete
          </div>
        </div>
      </section>

      {/* Prominent search — placed right after the hero so finding a
          specific company is the most obvious action. Auto-completes from
          the tracked universe and can pull fresh results on demand. */}
      <section className="mt-6 md:mt-8">
        <CompanySearch onSelect={scrollToTicker} />
      </section>

      <div className="h-8 md:h-10" />

      {/* =================================================================
          KPI ROW — compact, no cards, just cells separated by hairlines
          ================================================================= */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-0 border-y border-core-line divide-x divide-core-line">
        <Kpi
          label="Avg revenue YoY"
          value={formatPct(summary?.avg_revenue_yoy ?? null)}
          tone={pctToneClass(summary?.avg_revenue_yoy ?? null)}
          hint={`${reported.length} reporters · vs ${yoyQuarter(quarter)}`}
        />
        <Kpi
          label="Avg net profit YoY"
          value={formatPct(summary?.avg_profit_yoy ?? null)}
          tone={pctToneClass(summary?.avg_profit_yoy ?? null)}
          hint={`${reported.length} reporters · vs ${yoyQuarter(quarter)}`}
        />
        <Kpi
          label="Top sector · rev YoY"
          value={summary?.top_sectors_by_rev_growth?.[0]?.sector ?? "—"}
          hint={formatPct(summary?.top_sectors_by_rev_growth?.[0]?.revenue_yoy ?? null) + " revenue growth"}
        />
        <Kpi
          label="Next announcement"
          value={nextLabel}
          hint={nextUpcoming?.company_name ?? "none scheduled"}
          accent
        />
      </section>

      {/* Editorial insight — one factual sentence derived from the data.
          Stays silent until we have enough reporters to say something
          confident (rev/profit growth leaders by sector). */}
      {insight ? (
        <section className="mt-6 md:mt-8">
          <p className="text-[15px] md:text-[17px] tracking-tight text-core-ink leading-snug max-w-3xl">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink mr-2.5 align-middle" />
            {insight}
          </p>
        </section>
      ) : null}

      <div className="h-10 md:h-12" />

      {/* =================================================================
          UPCOMING + MAJORS — lifted up from the analytical grid.
          Upcoming announcements and the big-cap "yet to report" list
          are core to the product; readers shouldn't have to scroll past
          charts to find them.
          ================================================================= */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="card p-5 lg:col-span-3">
          <header className="flex items-baseline justify-between mb-4">
            <h3 className="text-lg font-semibold tracking-tightest">Upcoming this week</h3>
            <Link href="/upcoming" className="text-xs link-pink">All →</Link>
          </header>
          <UpcomingList items={upcoming} days={7} />
        </div>
        <div className="card p-5 lg:col-span-2">
          <header className="flex items-baseline justify-between mb-4">
            <h3 className="text-lg font-semibold tracking-tightest">Major companies yet to report</h3>
            <span className="text-[11px] uppercase tracking-wide text-core-muted">bellwethers</span>
          </header>
          {majorsYetToReport.length === 0 ? (
            <div className="text-sm text-core-muted">All bellwethers have reported — check the table below for numbers.</div>
          ) : (
            <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {majorsYetToReport.map((r, i) => (
                <li key={r.ticker} className="whitespace-nowrap">
                  <Link href={`/company/${encodeURIComponent(r.ticker)}`} className="font-medium hover:text-core-pink">
                    {r.company_name}
                  </Link>
                  {r.next_result_date ? (
                    <span className="text-[11px] text-core-muted ml-1.5">· {formatDate(r.next_result_date)}</span>
                  ) : null}
                  {i < majorsYetToReport.length - 1 ? <span className="text-core-line-2 ml-4">·</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="h-12" />

      {/* =================================================================
          FEATURED REPORTERS — 1 hero + 4 medium (clear visual hierarchy)
          ================================================================= */}
      <section>
        <header className="flex items-baseline justify-between mb-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-core-muted">As it reports</div>
            <h2 className="text-[26px] md:text-[32px] font-bold tracking-tightest mt-1 leading-tight">
              {quarter} results announced
            </h2>
          </div>
          {reported.length > 0 ? (
            <span className="text-[11px] uppercase tracking-[0.14em] text-core-muted">
              {reported.length} companies
            </span>
          ) : null}
        </header>

        {reported.length === 0 ? (
          <div className="card p-10 text-center">
            <div className="text-core-muted max-w-lg mx-auto text-sm">
              No companies have filed <span className="text-core-ink font-medium">{quarter}</span> yet.
              Indian companies typically report 30–60 days after quarter-end. Use the search below to
              pull fresh numbers on demand, or switch to a more complete quarter.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {lead ? <FeaturedHeroCard row={lead} quarter={quarter} /> : null}
            {nextFour.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {nextFour.map((r) => (
                  <FeaturedCard key={r.ticker} row={r} quarter={quarter} />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* =================================================================
          ALL REPORTERS TABLE — sortable + paginated
          ================================================================= */}
      {rest.length > 0 ? (() => {
        const PAGE_SIZE = 20;
        const sortedRest = [...rest].sort((a, b) => {
          if (allSort === "profit_yoy") return (b.profit_yoy ?? -Infinity) - (a.profit_yoy ?? -Infinity);
          if (allSort === "result_date") return (b.result_date ?? "").localeCompare(a.result_date ?? "");
          return (b.revenue ?? 0) - (a.revenue ?? 0);
        });
        const totalPages = Math.max(1, Math.ceil(sortedRest.length / PAGE_SIZE));
        const page = Math.min(allPage, totalPages - 1);
        const pageRows = sortedRest.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        return (
          <section className="mt-12">
            <header className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-baseline gap-4">
                <h2 className="text-xl font-bold tracking-tightest">All reporters</h2>
                <span className="text-[11px] uppercase tracking-[0.14em] text-core-muted">
                  {sortedRest.length} total
                </span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-[10px] uppercase tracking-[0.14em] text-core-muted flex items-center gap-2">
                  Sort by
                  <select
                    value={allSort}
                    onChange={(e) => setAllSort(e.target.value as typeof allSort)}
                    className="border border-core-line bg-white text-xs px-2.5 py-1.5 rounded-md normal-case text-core-ink font-semibold focus:outline-none focus:border-core-pink"
                  >
                    <option value="revenue">Revenue (high → low)</option>
                    <option value="profit_yoy">Profit YoY (high → low)</option>
                    <option value="result_date">Announcement date (recent first)</option>
                  </select>
                </label>
                <Link href={`/q4?quarter=${encodeURIComponent(quarter)}`} className="text-xs link-pink">
                  Grouped by date →
                </Link>
              </div>
            </header>
            <CompanyTable rows={pageRows} preserveOrder />
            {totalPages > 1 ? (
              <div className="mt-3 flex items-center justify-between text-xs text-core-muted">
                <span>
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedRest.length)}
                  {" "}of {sortedRest.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setAllPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="px-2.5 py-1 border border-core-line rounded-md disabled:opacity-40 hover:border-core-ink"
                  >
                    ← Prev
                  </button>
                  <span className="px-2 tabular-nums">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setAllPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-2.5 py-1 border border-core-line rounded-md disabled:opacity-40 hover:border-core-ink"
                  >
                    Next →
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        );
      })() : null}

      {/* =================================================================
          ANALYTICAL — charts in a 2-column layout. "Upcoming this week"
          used to live on the right of this grid; it was lifted up above
          the fold because upcoming filings are core to the product.
          ================================================================= */}
      <section className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <header className="flex items-baseline justify-between mb-3">
            <h3 className="text-lg font-semibold tracking-tightest">Aggregate revenue · last 8 quarters</h3>
            <span className="text-[11px] uppercase tracking-wide text-core-muted">Sum across reporters</span>
          </header>
          {overallTrend.length < 2 ? (
            <div className="h-[260px] flex items-center justify-center text-sm text-core-muted">
              Not enough history
            </div>
          ) : (
            <TrendChart rows={overallTrend} metric="revenue" height={260} />
          )}
        </div>
        <div className="card p-5">
          <header className="flex items-baseline justify-between mb-3">
            <h3 className="text-lg font-semibold tracking-tightest">Sector revenue YoY · {quarter}</h3>
            <span className="text-[11px] uppercase tracking-wide text-core-muted">vs {yoyQuarter(quarter)}</span>
          </header>
          <SectorComparison rows={sectors?.sectors ?? []} metric="revenue_yoy" height={260} />
        </div>
      </section>

      <section className="mt-12"><GainersLaggards quarter={quarter} /></section>

      <div className="h-16" />
    </div>
  );
}

// Inline "Stat" used in the primary context row below the hero — big
// tabular-num, small kicker label, descriptive suffix. A live "today"
// count gets a pink accent so the reader's eye lands on the urgent
// thing first.
function Stat({ label, value, suffix, accent }: {
  label: string; value: number; suffix: string; accent?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-[0.14em] text-core-muted">
        {label}
      </span>
      <span className={`text-[22px] md:text-[26px] font-bold tabular-nums tracking-tightest leading-none ${accent ? "text-core-pink" : "text-core-ink"}`}>
        {value.toLocaleString()}
      </span>
      <span className="text-[12px] md:text-[13px] text-core-muted">{suffix}</span>
    </div>
  );
}

// KPIs are hairline-separated cells (no cards) — tighter rhythm, more
// confident typography.
function Kpi({ label, value, hint, tone, accent }: {
  label: string; value: string; hint?: string; tone?: string; accent?: boolean;
}) {
  return (
    <div className="px-6 py-5 relative">
      {/* Accent cell gets a thin pink stripe across the top — signals "this
          is the live/actionable tile" without full-bleed color. */}
      {accent ? (
        <span className="absolute top-0 left-0 right-0 h-[2px] bg-core-pink" aria-hidden />
      ) : null}
      <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted">{label}</div>
      <div className={`mt-2 text-[30px] font-bold tracking-tightest tabular-nums leading-none ${tone ?? ""}`}>
        {value}
      </div>
      {hint ? <div className="mt-2.5 text-[11px] text-core-muted">{hint}</div> : null}
    </div>
  );
}

function UpcomingList({ items, days }: { items: UpcomingItem[]; days: number }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today.getTime() + days * 86_400_000);
  const shown = items.filter((i) => new Date(i.next_result_date) <= cutoff).slice(0, 6);
  if (shown.length === 0) {
    return <div className="text-sm text-core-muted">No announcements in the next {days} days.</div>;
  }
  return (
    <ul className="divide-y divide-core-line text-sm">
      {shown.map((i) => {
        const t = new Date(i.next_result_date + "T00:00:00").getTime();
        const d = Math.round((t - today.getTime()) / 86_400_000);
        const rel = d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d}d`;
        return (
          <li key={i.ticker + i.next_result_date} className="py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Link href={`/company/${encodeURIComponent(i.ticker)}`} className="font-medium hover:text-core-pink truncate block">
                {i.company_name}
              </Link>
              <div className="text-[11px] text-core-muted truncate">{i.sector ?? "—"}</div>
            </div>
            <div className="text-right whitespace-nowrap">
              <div className="text-sm font-medium tabular-nums">{formatDate(i.next_result_date)}</div>
              <div className="text-[10px] uppercase tracking-wide text-core-muted">{rel}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function GainersLaggards({ quarter }: { quarter: string }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    fetch(`/api/trends?quarter=${encodeURIComponent(quarter)}`)
      .then((r) => r.json()).then((j) => j.ok && setData(j.data))
      .catch(() => {});
  }, [quarter]);

  return (
    <div className="card p-6">
      <header className="flex items-baseline justify-between mb-6">
        <h3 className="text-lg font-semibold tracking-tightest">Gainers & laggards · {quarter}</h3>
        <span className="text-[11px] uppercase tracking-wide text-core-muted">by YoY</span>
      </header>
      {!data ? <div className="text-sm text-core-muted">Loading…</div> : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <List title="Revenue gainers"  rows={data.gainers_rev}     k="revenue_yoy" />
          <List title="Revenue laggards" rows={data.laggards_rev}    k="revenue_yoy" />
          <List title="Profit gainers"   rows={data.gainers_profit}  k="profit_yoy" />
          <List title="Profit laggards"  rows={data.laggards_profit} k="profit_yoy" />
        </div>
      )}
    </div>
  );
}

function List({ title, rows, k }: { title: string; rows: any[]; k: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted mb-3 pb-2 border-b border-core-line">
        {title}
      </div>
      <ul className="space-y-2 text-sm">
        {rows.slice(0, 5).map((r) => (
          <li key={r.ticker} className="flex items-baseline justify-between gap-3">
            <Link href={`/company/${encodeURIComponent(r.ticker)}`} className="truncate hover:text-core-pink">
              {r.company_name}
            </Link>
            <span className={`tabular-nums font-semibold ${pctToneClass(r[k])}`}>{formatPct(r[k])}</span>
          </li>
        ))}
        {rows.length === 0 ? <li className="text-xs text-core-muted">—</li> : null}
      </ul>
    </div>
  );
}
