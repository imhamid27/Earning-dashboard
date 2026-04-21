"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import FilingLoader from "@/components/FilingLoader";
import CompanyTable from "@/components/CompanyTable";
import SectorComparison from "@/components/SectorComparison";
import CompanySearch from "@/components/CompanySearch";
import FreshnessIndicator from "@/components/FreshnessIndicator";
import EmptyState from "@/components/EmptyState";
import { formatINR, formatDate, formatPct, pctToneClass } from "@/lib/format";
import type { LatestQuarterRow } from "@/lib/types";

const DEFAULT_QUARTER = process.env.NEXT_PUBLIC_DEFAULT_QUARTER || "Q4 FY26";

// Bellwethers the audience expects to see covered every quarter. These
// drive the "Big names still to report" line in COMING UP.
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

// Brand loader gets a minimum display time so fast Supabase round-trips
// don't flash past in 80ms.
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

  // Date anchors used throughout.
  const { todayIso, tomorrowIso, weekEndIso } = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const tom = new Date(t.getTime() + 86_400_000);
    const wk  = new Date(t.getTime() + 6 * 86_400_000);
    return {
      todayIso:    t.toISOString().slice(0, 10),
      tomorrowIso: tom.toISOString().slice(0, 10),
      weekEndIso:  wk.toISOString().slice(0, 10)
    };
  }, []);

  // All companies that have filed Q4 FY26, with actual numbers.
  const filed = useMemo(
    () => (board?.rows ?? [])
      .filter((r) => r.status === "announced_with_numbers"),
    [board]
  );

  // TODAY — companies whose result landed today, sorted revenue-desc.
  const todayReporters = useMemo(
    () => filed
      .filter((r) => r.result_date === todayIso)
      .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0)),
    [filed, todayIso]
  );

  // Pending today = has an event today but no numbers. Pulled from
  // upcoming (status=pending, date>=today) intersected with "date=today",
  // which avoids double-counting companies we've already counted above.
  const todayPending = useMemo(
    () => upcoming
      .filter((u) => u.next_result_date === todayIso)
      .filter((u) => !todayReporters.some((r) => r.ticker === u.ticker)),
    [upcoming, todayIso, todayReporters]
  );

  // Tomorrow + the rest of the next 6 days, for COMING UP.
  const tomorrowReporters = useMemo(
    () => upcoming.filter((u) => u.next_result_date === tomorrowIso),
    [upcoming, tomorrowIso]
  );
  const restOfWeek = useMemo(
    () => upcoming.filter((u) =>
      u.next_result_date > tomorrowIso && u.next_result_date <= weekEndIso
    ),
    [upcoming, tomorrowIso, weekEndIso]
  );
  const weekCount = useMemo(
    () => new Set(upcoming
      .filter((u) => u.next_result_date >= todayIso && u.next_result_date <= weekEndIso)
      .map((u) => u.ticker)
    ).size + todayReporters.length,
    [upcoming, todayIso, weekEndIso, todayReporters]
  );

  // Editorial sentence: revenue + profit sector leaders this quarter.
  const seasonInsight = useMemo<{ revLead?: string; profLead?: string }>(() => {
    const bySector = new Map<string, { rev: number[]; prof: number[] }>();
    for (const r of filed) {
      if (!r.sector) continue;
      if (!bySector.has(r.sector)) bySector.set(r.sector, { rev: [], prof: [] });
      const b = bySector.get(r.sector)!;
      if (r.revenue_yoy != null) b.rev.push(r.revenue_yoy);
      if (r.profit_yoy  != null) b.prof.push(r.profit_yoy);
    }
    const avg = (xs: number[]) => xs.length >= 2 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    let revLead: [string, number] | null = null;
    let profLead: [string, number] | null = null;
    for (const [s, x] of bySector) {
      const ra = avg(x.rev);  if (ra != null && (!revLead  || ra > revLead[1]))  revLead  = [s, ra];
      const pa = avg(x.prof); if (pa != null && (!profLead || pa > profLead[1])) profLead = [s, pa];
    }
    return { revLead: revLead?.[0], profLead: profLead?.[0] };
  }, [filed]);

  const majorsPending = useMemo(() => {
    const filedSet = new Set(filed.map((r) => r.ticker));
    const out: LatestQuarterRow[] = [];
    for (const t of MAJOR_TICKERS) {
      const r = (board?.rows ?? []).find((x) => x.ticker === t);
      if (!r || filedSet.has(t)) continue;
      out.push(r);
      if (out.length >= 6) break;
    }
    return out;
  }, [board, filed]);

  // Browse-all table sort + pagination.
  const [allSort, setAllSort] = useState<"revenue" | "profit_yoy" | "result_date">("revenue");
  const [allPage, setAllPage] = useState(0);
  useEffect(() => { setAllPage(0); }, [allSort, quarter]);

  const scrollToTicker = useCallback((ticker: string) => {
    const PAGE_SIZE = 20;
    const sorted = [...filed].sort((a, b) => {
      if (allSort === "profit_yoy") return (b.profit_yoy ?? -Infinity) - (a.profit_yoy ?? -Infinity);
      if (allSort === "result_date") return (b.result_date ?? "").localeCompare(a.result_date ?? "");
      return (b.revenue ?? 0) - (a.revenue ?? 0);
    });
    const idx = sorted.findIndex((r) => r.ticker === ticker);
    if (idx >= 0) setAllPage(Math.floor(idx / PAGE_SIZE));
    window.setTimeout(() => {
      const el = document.querySelector(`[data-ticker="${CSS.escape(ticker)}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-core-pink", "transition-shadow");
        window.setTimeout(() => el.classList.remove("ring-2", "ring-core-pink"), 1800);
      }
    }, 80);
  }, [filed, allSort]);

  if (error) return (
    <div className="container-core py-10">
      <EmptyState title="Couldn't load the dashboard" message={error}
        cta={<button onClick={fetchAll} className="btn-ink">Retry</button>} />
    </div>
  );

  if (!board || !minTimeElapsed) return (
    <div className="container-core">
      <FilingLoader quarter={quarter} total={500} label="Reading filings" />
    </div>
  );

  const cal = quarterAsCalendar(quarter);
  const todayLead = todayReporters[0];
  const todayOthers = todayReporters.slice(1);

  return (
    <div className="container-core pb-20">
      {/* =================================================================
          1. MASTHEAD — stripped to the bone. Breadcrumb + title, a
          freshness pulse. The status sentence + quarter picker have
          moved into the sections where they naturally belong (TODAY
          for current-quarter state, FIND A COMPANY for historical
          quarter browsing).
          ================================================================= */}
      <section className="pt-6 md:pt-14 pb-6 md:pb-8">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-core-muted mb-3">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink animate-pulse" />
              <span>India earnings</span>
              <span className="text-core-line-2">/</span>
              <span className="text-core-ink font-semibold">{quarter}</span>
              {cal ? <><span className="text-core-line-2">/</span><span>{cal}</span></> : null}
            </div>
            <h1 className="font-sans font-bold tracking-tightest leading-[0.95] text-[clamp(2.5rem,6vw,4.75rem)]">
              India Inc. Reporting
            </h1>
          </div>
          <div className="shrink-0">
            {summary ? <FreshnessIndicator fetchedAt={summary.last_refreshed_at} /> : null}
          </div>
        </div>
      </section>

      {/* =================================================================
          2. TODAY — inverted black band. Signature "live newsroom"
          treatment. Pink pulse dot signals live data; day marker is
          oversized; lead reporter gets the hero slot with display-size
          numbers. Wraps INSIDE the container for now (visually strong
          without breaking layout plumbing).
          ================================================================= */}
      <TodayBand
        lead={todayLead}
        others={todayOthers}
        pending={todayPending}
        todayIso={todayIso}
        nextUp={tomorrowReporters[0]}
        quarter={quarter}
      />

      <DotDashDivider />

      {/* =================================================================
          3. THE SEASON SO FAR — typographic display. Big revenue and
          profit YoY numbers sit as a pair of editorial panels at the
          top. A pull-quote below calls out sector leaders. Sector bar
          chart moves into the support column below.
          ================================================================= */}
      <section className="mt-12 md:mt-16">
        <header className="flex items-baseline justify-between gap-4 flex-wrap mb-6 md:mb-8">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-[10px] md:text-[11px] uppercase tracking-[0.22em] text-core-muted font-semibold">
              The season so far
            </span>
            <span className="text-[13px] text-core-muted tabular-nums">
              · {quarter} · {filed.length} {filed.length === 1 ? "reporter" : "reporters"}
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-[0.14em] text-core-muted">
            YoY vs {yoyQuarter(quarter)}
          </span>
        </header>

        {/* Twin big-number panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 border-y-2 border-core-ink">
          <BigStat
            label="Aggregate revenue"
            value={summary?.avg_revenue_yoy ?? null}
          />
          <BigStat
            label="Aggregate net profit"
            value={summary?.avg_profit_yoy ?? null}
            borderStart
          />
        </div>

        {/* Pull-quote: sector leaders */}
        {(seasonInsight.revLead || seasonInsight.profLead) ? (
          <figure className="mt-10 md:mt-12 pl-6 md:pl-8 border-l-2 border-core-pink max-w-3xl">
            <blockquote className="font-sans text-[22px] md:text-[28px] leading-[1.25] tracking-tightest">
              {seasonInsight.revLead && seasonInsight.profLead && seasonInsight.revLead !== seasonInsight.profLead ? (
                <>
                  <span className="text-core-ink">{seasonInsight.revLead}</span>
                  <span className="text-core-muted"> leads on revenue. </span>
                  <span className="text-core-ink">{seasonInsight.profLead}</span>
                  <span className="text-core-muted"> leads on profit.</span>
                </>
              ) : (seasonInsight.revLead || seasonInsight.profLead) ? (
                <>
                  <span className="text-core-ink">{seasonInsight.revLead || seasonInsight.profLead}</span>
                  <span className="text-core-muted"> leads both revenue and profit growth.</span>
                </>
              ) : null}
            </blockquote>
            <figcaption className="mt-4 text-[11px] uppercase tracking-[0.14em] text-core-muted flex items-center gap-2">
              <span className="inline-block w-1 h-1 bg-core-pink" />
              <span>—</span>
              <span className="inline-block w-3 h-[1px] bg-core-ink" />
              <span>Sector leaders, {quarter}</span>
            </figcaption>
          </figure>
        ) : null}

        {/* Supporting chart — deemphasised */}
        <div className="mt-10 md:mt-12 grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          <div className="md:col-span-4 flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-core-muted">
              Sector breakdown
            </span>
            <p className="text-[13px] text-core-muted leading-snug">
              Average revenue growth by sector across reporters so far. Positive
              side favours sectors with expanding top lines this quarter.
            </p>
          </div>
          <div className="md:col-span-8">
            <SectorComparison rows={sectors?.sectors ?? []} metric="revenue_yoy" height={240} />
          </div>
        </div>
      </section>

      <DotDashDivider />

      {/* =================================================================
          4. COMING UP — horizontal calendar strip of the next 7 days.
          Each day is a click-through cell showing a count; clicking
          expands the list of companies for that day. Bellwethers still
          to report are a visually distinct tile grid.
          ================================================================= */}
      <section className="mt-12 md:mt-16">
        <header className="flex items-baseline justify-between gap-4 flex-wrap mb-6 md:mb-8">
          <div className="flex items-baseline gap-3">
            <span className="text-[10px] md:text-[11px] uppercase tracking-[0.22em] text-core-muted font-semibold">
              Coming up
            </span>
            <span className="text-[13px] text-core-muted">
              · Next 7 days
            </span>
          </div>
          <Link href="/upcoming" className="text-xs link-pink">
            Full calendar →
          </Link>
        </header>

        <CalendarStrip upcoming={upcoming} todayIso={todayIso} />

        {majorsPending.length > 0 ? (
          <div className="mt-10 md:mt-12">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
              <span className="text-[10px] uppercase tracking-[0.22em] text-core-muted font-semibold">
                Big names still to report
              </span>
              <span className="text-[11px] text-core-muted tabular-nums">
                {majorsPending.length} pending
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
              {majorsPending.map((r) => (
                <Link
                  key={r.ticker}
                  href={`/company/${encodeURIComponent(r.ticker)}`}
                  className="group block border border-core-line bg-white p-3.5 hover:border-core-ink transition-colors"
                >
                  <div className="text-[13px] font-semibold tracking-tightest leading-tight truncate group-hover:text-core-pink transition-colors">
                    {r.company_name.replace(/ Limited$| Ltd\.?$| Industries$/i, "").trim()}
                  </div>
                  <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-core-muted flex items-center gap-1.5">
                    <span className="inline-block w-1 h-1 bg-core-pink rounded-full" />
                    {r.next_result_date ? formatDate(r.next_result_date) : "Unscheduled"}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <DotDashDivider />

      {/* =================================================================
          5. FIND A COMPANY — search + full table. Quarter selector
          lives here now, not the masthead: this is the only place
          readers need to switch quarters (to browse historical data).
          ================================================================= */}
      <section className="mt-12 md:mt-16">
        <header className="flex items-baseline justify-between gap-4 flex-wrap mb-6 md:mb-8">
          <div className="flex items-baseline gap-3">
            <span className="text-[10px] md:text-[11px] uppercase tracking-[0.22em] text-core-muted font-semibold">
              Find a company
            </span>
            <span className="text-[13px] text-core-muted">
              · Search, sort, browse historical quarters
            </span>
          </div>
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-core-muted">
            Quarter
            <select
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              className="border border-core-line bg-white text-xs px-2.5 py-1.5 rounded-md normal-case text-core-ink font-semibold focus:outline-none focus:border-core-pink"
            >
              {availableQuarters.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </label>
        </header>

        <CompanySearch onSelect={scrollToTicker} />

        {filed.length > 0 ? (() => {
          const PAGE_SIZE = 20;
          const sorted = [...filed].sort((a, b) => {
            if (allSort === "profit_yoy") return (b.profit_yoy ?? -Infinity) - (a.profit_yoy ?? -Infinity);
            if (allSort === "result_date") return (b.result_date ?? "").localeCompare(a.result_date ?? "");
            return (b.revenue ?? 0) - (a.revenue ?? 0);
          });
          const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
          const page = Math.min(allPage, totalPages - 1);
          const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
          return (
            <div className="mt-8">
              <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
                <span className="text-[10px] uppercase tracking-[0.14em] text-core-muted">
                  All {sorted.length} that have filed · {quarter}
                </span>
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
              </div>
              <CompanyTable rows={pageRows} preserveOrder />
              {totalPages > 1 ? (
                <div className="mt-3 flex items-center justify-between text-xs text-core-muted">
                  <span>
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setAllPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                      className="px-2.5 py-1 border border-core-line rounded-md disabled:opacity-40 hover:border-core-ink"
                    >
                      ← Prev
                    </button>
                    <span className="px-2 tabular-nums">{page + 1} / {totalPages}</span>
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
            </div>
          );
        })() : null}
      </section>
    </div>
  );
}


// Dot-and-dash divider — a nod to The Core's signature pattern.
// Used between major sections instead of a plain hairline so the
// page has a visual rhythm.
function DotDashDivider() {
  return (
    <div
      className="my-12 md:my-16 flex items-center justify-center gap-2 text-core-line-2 select-none"
      aria-hidden
    >
      <span className="inline-block w-1 h-1 rounded-full bg-core-ink" />
      <span className="inline-block w-8 h-[1px] bg-core-ink" />
      <span className="inline-block w-1 h-1 rounded-full bg-core-ink" />
      <span className="inline-block w-16 h-[1px] bg-core-line" />
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink" />
      <span className="inline-block w-16 h-[1px] bg-core-line" />
      <span className="inline-block w-1 h-1 rounded-full bg-core-ink" />
      <span className="inline-block w-8 h-[1px] bg-core-ink" />
      <span className="inline-block w-1 h-1 rounded-full bg-core-ink" />
    </div>
  );
}

// TODAY — inverted black band. Signature Core newsroom treatment.
// Structure:
//   [day marker]                                     [live status]
//   [lead reporter name, very large]
//   [revenue + profit as display-size numbers, with YoY delta]
//   ─────────────
//   [others today — compact horizontal rows]
//   [pending today — chip list]
function TodayBand({
  lead, others, pending, todayIso, nextUp, quarter
}: {
  lead: LatestQuarterRow | undefined;
  others: LatestQuarterRow[];
  pending: UpcomingItem[];
  todayIso: string;
  nextUp: UpcomingItem | undefined;
  quarter: string;
}) {
  const dayOfWeek = new Date(todayIso + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
  const dayShort  = new Date(todayIso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const filedCount = (lead ? 1 : 0) + others.length;
  const hasActivity = filedCount > 0 || pending.length > 0;

  return (
    <section className="bg-core-ink text-white rounded-xl overflow-hidden">
      <div className="p-6 md:p-10">
        {/* Header: day marker + live status */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-white/60 font-semibold mb-2">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${hasActivity ? "bg-core-pink animate-pulse" : "bg-white/30"}`} />
              <span>Today · Live</span>
            </div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="font-sans font-bold tracking-tightest leading-none text-[clamp(2rem,5vw,3.5rem)]">
                {dayOfWeek}
              </h2>
              <span className="text-[clamp(1.25rem,2vw,1.75rem)] font-bold tabular-nums tracking-tightest text-white/50">
                {dayShort}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.22em] text-white/60">
              {filedCount} filed{pending.length > 0 ? ` · ${pending.length} expected` : ""}
            </div>
          </div>
        </div>

        {/* Lead reporter — display-size numbers */}
        {lead ? (
          <div className="mt-8 md:mt-10">
            <Link
              href={`/company/${encodeURIComponent(lead.ticker)}`}
              className="block group"
            >
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.22em] text-white/60">
                  Lead reporter
                </span>
                {lead.sector ? (
                  <span className="text-[10px] uppercase tracking-[0.14em] text-core-pink">
                    {lead.sector}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 font-sans font-bold tracking-tightest leading-[1.05] text-[clamp(1.75rem,4vw,3rem)] group-hover:text-core-pink transition-colors">
                {lead.company_name}
              </div>
              <div className="text-[11px] text-white/50 tabular-nums mt-1">{lead.ticker}</div>

              <div className="mt-6 md:mt-8 grid grid-cols-1 md:grid-cols-2 gap-y-6 md:gap-x-12">
                <BigNumber
                  label="Revenue"
                  value={formatINR(lead.revenue)}
                  delta={lead.revenue_yoy}
                  dark
                />
                <BigNumber
                  label="Net profit"
                  value={formatINR(lead.net_profit)}
                  delta={lead.profit_yoy}
                  dark
                />
              </div>
              <div className="mt-6 inline-flex items-center gap-2 text-[12px] text-white/70 group-hover:text-core-pink transition-colors">
                Full results <span aria-hidden>→</span>
              </div>
            </Link>
          </div>
        ) : null}

        {/* Other reporters today — compact inverted rows */}
        {others.length > 0 ? (
          <div className="mt-8 md:mt-10 divide-y divide-white/10 border-y border-white/10">
            {others.map((r) => (
              <Link
                key={r.ticker}
                href={`/company/${encodeURIComponent(r.ticker)}`}
                className="grid grid-cols-12 gap-3 py-3 hover:bg-white/5 transition-colors"
              >
                <div className="col-span-12 md:col-span-5 min-w-0">
                  <div className="font-semibold truncate tracking-tightest">{r.company_name}</div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-white/40">
                    {r.ticker}{r.sector ? <> · {r.sector}</> : null}
                  </div>
                </div>
                <div className="col-span-6 md:col-span-3 min-w-0">
                  <div className="text-[9px] uppercase tracking-[0.14em] text-white/40">Revenue</div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold tabular-nums">{formatINR(r.revenue)}</span>
                    <DeltaChipDark value={r.revenue_yoy} />
                  </div>
                </div>
                <div className="col-span-6 md:col-span-3 min-w-0">
                  <div className="text-[9px] uppercase tracking-[0.14em] text-white/40">Profit</div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold tabular-nums">{formatINR(r.net_profit)}</span>
                    <DeltaChipDark value={r.profit_yoy} />
                  </div>
                </div>
                <div className="hidden md:flex col-span-1 items-center justify-end text-white/40 text-xs">→</div>
              </Link>
            ))}
          </div>
        ) : null}

        {/* Pending today */}
        {pending.length > 0 ? (
          <div className="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-2 text-sm">
            <span className="text-[10px] uppercase tracking-[0.22em] text-white/60 mr-1">
              Filing pending
            </span>
            {pending.map((p, i) => (
              <span key={p.ticker} className="whitespace-nowrap">
                <Link href={`/company/${encodeURIComponent(p.ticker)}`} className="text-white hover:text-core-pink">
                  {p.company_name}
                </Link>
                {i < pending.length - 1 ? <span className="text-white/30 ml-3">·</span> : null}
              </span>
            ))}
          </div>
        ) : null}

        {/* Empty state */}
        {!hasActivity ? (
          <div className="mt-8 text-white/70 text-sm md:text-base">
            No Indian companies reported today.
            {nextUp ? (
              <> Next up: <span className="text-white font-medium">{nextUp.company_name}</span> tomorrow.</>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// Display-size number with a small kicker label. Used on the inverted
// TODAY band (dark=true) and potentially elsewhere.
function BigNumber({ label, value, delta, dark }: {
  label: string; value: string; delta: number | null | undefined; dark?: boolean;
}) {
  const labelCls = dark ? "text-white/60" : "text-core-muted";
  const valCls   = dark ? "text-white" : "text-core-ink";
  const tone =
    delta == null ? (dark ? "text-white/50" : "text-core-muted") :
    delta > 0     ? "text-core-teal" :
    delta < 0     ? "text-core-negative" : (dark ? "text-white/50" : "text-core-muted");
  const sign = delta == null ? "" : delta > 0 ? "▲" : delta < 0 ? "▼" : "";
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-[0.22em] ${labelCls} font-semibold`}>
        {label}
      </div>
      <div className={`mt-2 font-sans font-bold tabular-nums tracking-tightest leading-none text-[clamp(2rem,4.5vw,3.25rem)] ${valCls}`}>
        {value}
      </div>
      <div className={`mt-2 text-sm font-semibold tabular-nums ${tone}`}>
        {delta != null ? (
          <>
            <span className="text-[10px] mr-1">{sign}</span>
            {formatPct(Math.abs(delta))}
            <span className={`text-[10px] font-normal ml-2 uppercase tracking-wide ${dark ? "text-white/50" : "text-core-muted"}`}>
              YoY
            </span>
          </>
        ) : <span className="text-xs">— YoY</span>}
      </div>
    </div>
  );
}

// Small coloured delta pill used inside the inverted band's compact
// rows. Uses rgba white overlays for non-tonal positive/negative.
function DeltaChipDark({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-[11px] text-white/40">—</span>;
  const tone =
    value > 0 ? "text-core-teal" :
    value < 0 ? "text-core-negative" : "text-white/50";
  const sign = value > 0 ? "▲" : value < 0 ? "▼" : "";
  return (
    <span className={`text-[11px] tabular-nums ${tone}`}>
      <span className="text-[9px] mr-0.5">{sign}</span>
      {formatPct(Math.abs(value))}
    </span>
  );
}

// BigStat — twin panels on the SEASON section. Giant YoY number with
// tiny caps label and a thin "up/down" direction marker.
function BigStat({ label, value, borderStart }: {
  label: string; value: number | null; borderStart?: boolean;
}) {
  const tone =
    value == null ? "text-core-muted" :
    value > 0     ? "text-core-teal" :
    value < 0     ? "text-core-negative" : "text-core-muted";
  const sign = value == null ? "" : value > 0 ? "↑" : value < 0 ? "↓" : "";
  return (
    <div className={`p-6 md:p-10 ${borderStart ? "md:border-l border-core-ink" : ""}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-core-muted font-semibold">
        <span className="inline-block w-2 h-[2px] bg-core-ink" />
        {label}
      </div>
      <div className={`mt-4 md:mt-6 font-sans font-bold tracking-tightest leading-none tabular-nums text-[clamp(3rem,9vw,6rem)] ${tone}`}>
        <span className="text-[0.55em] align-top mr-1 font-semibold">{sign}</span>
        {value != null ? formatPct(Math.abs(value)) : "—"}
      </div>
      <div className="mt-3 text-[11px] uppercase tracking-[0.14em] text-core-muted">
        {value == null ? "Not enough reporters" : `Year on year · all reporters`}
      </div>
    </div>
  );
}

// CalendarStrip — horizontal 7-day strip. Each cell has day-of-week,
// date, and count. Click to expand the list of companies inline below.
function CalendarStrip({ upcoming, todayIso }: {
  upcoming: UpcomingItem[]; todayIso: string;
}) {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const days = useMemo(() => {
    const start = new Date(todayIso + "T00:00:00");
    const out: { iso: string; dow: string; num: string; items: UpcomingItem[] }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + i * 86_400_000);
      const iso = d.toISOString().slice(0, 10);
      const items = upcoming.filter((u) => u.next_result_date === iso);
      out.push({
        iso,
        dow: d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
        num: d.getDate().toString(),
        items
      });
    }
    return out;
  }, [upcoming, todayIso]);

  // Auto-open the first day with >=1 filings.
  useEffect(() => {
    if (openDay === null) {
      const first = days.find((d) => d.items.length > 0);
      if (first) setOpenDay(first.iso);
    }
  }, [days, openDay]);

  const active = days.find((d) => d.iso === openDay);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 md:gap-2">
        {days.map((d) => {
          const isActive = d.iso === openDay;
          const isToday  = d.iso === todayIso;
          const hasItems = d.items.length > 0;
          return (
            <button
              key={d.iso}
              onClick={() => setOpenDay(d.iso)}
              className={`text-left p-2.5 md:p-3.5 border transition-colors ${
                isActive
                  ? "bg-core-ink text-white border-core-ink"
                  : hasItems
                    ? "bg-white border-core-line hover:border-core-ink"
                    : "bg-core-surface border-core-line text-core-muted"
              }`}
            >
              <div className={`text-[9px] md:text-[10px] uppercase tracking-[0.14em] ${isActive ? "text-white/70" : "text-core-muted"}`}>
                {d.dow}
              </div>
              <div className={`mt-0.5 md:mt-1 text-[18px] md:text-[22px] font-bold tabular-nums tracking-tightest leading-none ${isToday && !isActive ? "text-core-pink" : ""}`}>
                {d.num}
              </div>
              <div className={`mt-1 md:mt-1.5 text-[10px] md:text-[11px] tabular-nums ${isActive ? "text-white/80" : hasItems ? "text-core-ink font-semibold" : "text-core-muted"}`}>
                {hasItems ? `${d.items.length} ${d.items.length === 1 ? "company" : "cos"}` : "—"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Expanded day panel */}
      {active && active.items.length > 0 ? (
        <div className="mt-4 md:mt-5 p-4 md:p-5 border border-core-line bg-white">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <span className="text-[10px] uppercase tracking-[0.22em] text-core-muted font-semibold">
              {active.iso === todayIso ? "Today" : formatDate(active.iso)}
            </span>
            <span className="text-[11px] text-core-muted tabular-nums">
              {active.items.length} reporting
            </span>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {active.items.slice(0, 24).map((u, i) => (
              <li key={u.ticker + u.next_result_date} className="whitespace-nowrap">
                <Link href={`/company/${encodeURIComponent(u.ticker)}`} className="font-medium hover:text-core-pink">
                  {u.company_name}
                </Link>
                {u.sector ? (
                  <span className="text-[10px] text-core-muted ml-1.5">· {u.sector}</span>
                ) : null}
                {i < Math.min(active.items.length, 24) - 1 ? <span className="text-core-line-2 ml-3">·</span> : null}
              </li>
            ))}
            {active.items.length > 24 ? (
              <li className="text-[11px] text-core-muted">+{active.items.length - 24} more</li>
            ) : null}
          </ul>
        </div>
      ) : active ? (
        <div className="mt-4 md:mt-5 p-4 md:p-5 border border-core-line bg-core-surface text-sm text-core-muted">
          No companies scheduled on {formatDate(active.iso)}.
        </div>
      ) : null}
    </div>
  );
}
