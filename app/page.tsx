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

  // Date anchors used throughout — anchored to Asia/Kolkata so "today"
  // is India's "today", not the browser's local today (matters for
  // readers viewing from outside India or when a container's clock is
  // in UTC and we're near the midnight boundary).
  const { todayIso, tomorrowIso, weekEndIso } = useMemo(() => {
    // en-CA locale formats as YYYY-MM-DD — perfect for ISO date compare.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit"
    });
    const now = new Date();
    const add = (days: number) => {
      const d = new Date(now.getTime() + days * 86_400_000);
      return fmt.format(d);
    };
    return {
      todayIso:    add(0),
      tomorrowIso: add(1),
      weekEndIso:  add(6)
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
      <section className="pt-4 md:pt-8 pb-4 md:pb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.14em] text-core-muted mb-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink animate-pulse" />
              <span>India earnings</span>
              <span className="text-core-line-2">/</span>
              <span className="text-core-ink font-semibold">{quarter}</span>
              {cal ? <><span className="text-core-line-2">/</span><span>{cal}</span></> : null}
            </div>
            <h1 className="font-sans font-bold tracking-tightest leading-[0.95] text-[clamp(1.75rem,4.5vw,3.25rem)]">
              India Inc. Reporting
            </h1>
          </div>
          <div className="shrink-0 pt-1">
            {summary ? <FreshnessIndicator fetchedAt={summary.last_refreshed_at} /> : null}
          </div>
        </div>
      </section>

      {/* =================================================================
          2. LIVE BAND — inverted, fixed-height, tabbed. Today / Tomorrow /
          This week / Bellwethers all live here; long lists scroll inside
          the band so the table below never gets pushed down.
          ================================================================= */}
      <TodayBand
        lead={todayLead}
        others={todayOthers}
        pending={todayPending}
        tomorrow={tomorrowReporters}
        restOfWeek={restOfWeek}
        bellwethers={majorsPending}
        todayIso={todayIso}
        nextUp={tomorrowReporters[0]}
      />

      <DotDashDivider />


      {/* =================================================================
          3. FIND A COMPANY — search + full table. Primary content
          after the live band. Quarter selector lives here (only place
          readers browse historical data).
          ================================================================= */}
      <section className="mt-4">
        <header className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
          <div className="flex items-baseline gap-3">
            <span className="text-[10px] md:text-[11px] uppercase tracking-[0.22em] text-core-muted font-semibold">
              Find a company
            </span>
            <span className="text-[12px] text-core-muted">
              · Search or browse the full list
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

      <DotDashDivider />

      {/* =================================================================
          4. CHARTS & VISUALIZATIONS — below the table, not above.
          Aggregates + sector bar + pull-quote on sector leaders. This
          is the "zoom out" view — useful, not urgent.
          ================================================================= */}
      <section className="mt-4">
        <header className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-[10px] md:text-[11px] uppercase tracking-[0.22em] text-core-muted font-semibold">
              The season in charts
            </span>
            <span className="text-[12px] text-core-muted tabular-nums">
              · {quarter} · {filed.length} {filed.length === 1 ? "reporter" : "reporters"} · YoY vs {yoyQuarter(quarter)}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 items-start">
          <div className="lg:col-span-6">
            <div className="grid grid-cols-2 border-y-2 border-core-ink">
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
            {(seasonInsight.revLead || seasonInsight.profLead) ? (
              <figure className="mt-5 pl-4 border-l-2 border-core-pink">
                <blockquote className="font-sans text-[15px] md:text-[17px] leading-[1.35] tracking-tight">
                  {seasonInsight.revLead && seasonInsight.profLead && seasonInsight.revLead !== seasonInsight.profLead ? (
                    <>
                      <span className="text-core-ink font-semibold">{seasonInsight.revLead}</span>
                      <span className="text-core-muted"> leads on revenue. </span>
                      <span className="text-core-ink font-semibold">{seasonInsight.profLead}</span>
                      <span className="text-core-muted"> leads on profit.</span>
                    </>
                  ) : (
                    <>
                      <span className="text-core-ink font-semibold">{seasonInsight.revLead || seasonInsight.profLead}</span>
                      <span className="text-core-muted"> leads both revenue and profit growth.</span>
                    </>
                  )}
                </blockquote>
              </figure>
            ) : null}
          </div>

          <div className="lg:col-span-6">
            <div className="text-[10px] uppercase tracking-[0.22em] text-core-muted font-semibold mb-2">
              Sector · revenue YoY
            </div>
            <SectorComparison rows={sectors?.sectors ?? []} metric="revenue_yoy" height={220} />
          </div>
        </div>
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
      className="my-8 md:my-10 flex items-center justify-center gap-1.5 text-core-line-2 select-none"
      aria-hidden
    >
      <span className="inline-block w-1 h-1 rounded-full bg-core-ink" />
      <span className="inline-block w-6 h-[1px] bg-core-ink" />
      <span className="inline-block w-12 h-[1px] bg-core-line" />
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink" />
      <span className="inline-block w-12 h-[1px] bg-core-line" />
      <span className="inline-block w-6 h-[1px] bg-core-ink" />
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
  lead, others, pending, tomorrow, restOfWeek, bellwethers,
  todayIso, nextUp
}: {
  lead: LatestQuarterRow | undefined;
  others: LatestQuarterRow[];
  pending: UpcomingItem[];
  tomorrow: UpcomingItem[];
  restOfWeek: UpcomingItem[];
  bellwethers: LatestQuarterRow[];
  todayIso: string;
  nextUp: UpcomingItem | undefined;
}) {
  const [tab, setTab] = useState<"today" | "tomorrow" | "week" | "bellwethers">("today");

  const [yy, mm, dd] = todayIso.split("-").map(Number);
  const dayDate = new Date(yy, (mm ?? 1) - 1, dd ?? 1);
  const dayOfWeek = dayDate.toLocaleDateString("en-US", { weekday: "long" });
  const dayShort  = dayDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const filedCount = (lead ? 1 : 0) + others.length;
  const hasActivity = filedCount > 0 || pending.length > 0;

  // Counts next to each tab label.
  const counts = {
    today:       filedCount + pending.length,
    tomorrow:    tomorrow.length,
    week:        restOfWeek.length,
    bellwethers: bellwethers.length,
  };

  return (
    <section className="bg-core-ink text-white rounded-lg overflow-hidden flex flex-col max-h-[440px] md:max-h-[480px]">
      {/* Header row — unchanged (live kicker + day + tabs) */}
      <div className="px-5 md:px-6 pt-5 md:pt-6">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div className="flex items-baseline gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-white/60 font-semibold">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${hasActivity ? "bg-core-pink animate-pulse" : "bg-white/30"}`} />
              <span>Live</span>
            </div>
            <h2 className="text-[20px] md:text-[24px] font-bold tracking-tightest leading-none">
              {dayOfWeek} <span className="text-white/50 font-semibold">{dayShort}</span>
            </h2>
          </div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/60">
            {filedCount} filed{pending.length > 0 ? ` · ${pending.length} expected` : ""}
          </div>
        </div>

        {/* Tabs */}
        <nav className="mt-4 md:mt-5 flex flex-wrap gap-x-4 gap-y-1.5 border-b border-white/10 -mx-1">
          <TabButton active={tab === "today"}       onClick={() => setTab("today")}       label="Today"       count={counts.today} />
          <TabButton active={tab === "tomorrow"}    onClick={() => setTab("tomorrow")}    label="Tomorrow"    count={counts.tomorrow} />
          <TabButton active={tab === "week"}        onClick={() => setTab("week")}        label="This week"   count={counts.week} />
          <TabButton active={tab === "bellwethers"} onClick={() => setTab("bellwethers")} label="Big names"   count={counts.bellwethers} />
        </nav>
      </div>

      {/* Scroll area — inner content swaps by tab. Fixed band height
          above means a long list just scrolls inside rather than
          pushing the table down the page. */}
      <div className="px-5 md:px-6 pb-5 md:pb-6 pt-4 md:pt-5 overflow-y-auto flex-1">
        {tab === "today" ? (
          <>
            {lead ? (
              <Link
                href={`/company/${encodeURIComponent(lead.ticker)}`}
                className="block group"
              >
                <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
                  <span className="text-[9px] uppercase tracking-[0.22em] text-core-pink font-semibold">Lead</span>
                  {lead.sector ? (
                    <span className="text-[9px] uppercase tracking-[0.14em] text-white/60">{lead.sector}</span>
                  ) : null}
                  <span className="text-[10px] text-white/40 tabular-nums">· {lead.ticker}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-6 items-baseline">
                  <div className="md:col-span-5">
                    <div className="font-sans font-bold tracking-tightest leading-[1.1] text-[20px] md:text-[24px] group-hover:text-core-pink transition-colors">
                      {lead.company_name}
                    </div>
                  </div>
                  <div className="md:col-span-3">
                    <BigNumber label="Revenue" value={formatINR(lead.revenue)} delta={lead.revenue_yoy} dark />
                  </div>
                  <div className="md:col-span-3">
                    <BigNumber label="Net profit" value={formatINR(lead.net_profit)} delta={lead.profit_yoy} dark />
                  </div>
                  <div className="hidden md:flex md:col-span-1 justify-end text-white/40 text-sm group-hover:text-core-pink transition-colors">→</div>
                </div>
              </Link>
            ) : null}

            {others.length > 0 ? (
              <div className={`${lead ? "mt-4" : ""} divide-y divide-white/10 ${lead ? "border-t" : ""} border-white/10`}>
                {others.map((r) => (
                  <Link
                    key={r.ticker}
                    href={`/company/${encodeURIComponent(r.ticker)}`}
                    className="grid grid-cols-12 gap-3 py-2 hover:bg-white/5 transition-colors text-[13px]"
                  >
                    <div className="col-span-12 md:col-span-5 min-w-0 flex items-baseline gap-2">
                      <span className="font-semibold truncate tracking-tightest">{r.company_name}</span>
                      <span className="text-[10px] text-white/40 tabular-nums hidden md:inline">{r.ticker}</span>
                    </div>
                    <div className="col-span-6 md:col-span-3 flex items-baseline gap-1.5 min-w-0">
                      <span className="text-[9px] uppercase tracking-[0.14em] text-white/40">Rev</span>
                      <span className="font-semibold tabular-nums truncate">{formatINR(r.revenue)}</span>
                      <DeltaChipDark value={r.revenue_yoy} />
                    </div>
                    <div className="col-span-6 md:col-span-3 flex items-baseline gap-1.5 min-w-0">
                      <span className="text-[9px] uppercase tracking-[0.14em] text-white/40">Prof</span>
                      <span className="font-semibold tabular-nums truncate">{formatINR(r.net_profit)}</span>
                      <DeltaChipDark value={r.profit_yoy} />
                    </div>
                    <div className="hidden md:flex col-span-1 items-center justify-end text-white/40">→</div>
                  </Link>
                ))}
              </div>
            ) : null}

            {pending.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1.5 text-[13px]">
                <span className="text-[9px] uppercase tracking-[0.22em] text-white/60 mr-1">Filing pending</span>
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

            {!hasActivity ? (
              <div className="text-white/70 text-[13px]">
                No Indian companies reported today.
                {nextUp ? (
                  <> Next up: <span className="text-white font-medium">{nextUp.company_name}</span> tomorrow.</>
                ) : null}
              </div>
            ) : null}
          </>
        ) : tab === "tomorrow" ? (
          <UpcomingListDark items={tomorrow} emptyText="No filings scheduled tomorrow." />
        ) : tab === "week" ? (
          <UpcomingListDark items={restOfWeek} emptyText="Nothing scheduled for the rest of this week." />
        ) : tab === "bellwethers" ? (
          <BellwetherListDark items={bellwethers} />
        ) : null}
      </div>
    </section>
  );
}

// Pill-style tab button used inside the TodayBand header.
function TabButton({ active, onClick, label, count }: {
  active: boolean; onClick: () => void; label: string; count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-1 pb-2 -mb-px text-[12px] uppercase tracking-[0.14em] font-semibold border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "text-white border-core-pink"
          : "text-white/60 border-transparent hover:text-white"
      }`}
    >
      {label}
      <span className={`ml-1.5 text-[10px] tabular-nums ${active ? "text-core-pink" : "text-white/40"}`}>
        {count}
      </span>
    </button>
  );
}

// Simple inverted list for tomorrow / this-week tabs.
function UpcomingListDark({ items, emptyText }: {
  items: UpcomingItem[]; emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="text-white/60 text-[13px]">{emptyText}</div>;
  }
  // Group by date for easier scanning.
  const byDate = new Map<string, UpcomingItem[]>();
  for (const u of items) {
    if (!byDate.has(u.next_result_date)) byDate.set(u.next_result_date, []);
    byDate.get(u.next_result_date)!.push(u);
  }
  return (
    <div className="space-y-3">
      {Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, list]) => (
        <div key={date}>
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/50 font-semibold mb-1.5 flex items-baseline gap-2">
            <span>{formatDate(date)}</span>
            <span className="text-[9px] text-white/30 tabular-nums">{list.length}</span>
          </div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
            {list.map((u, i) => (
              <li key={u.ticker} className="whitespace-nowrap">
                <Link href={`/company/${encodeURIComponent(u.ticker)}`} className="text-white hover:text-core-pink font-medium">
                  {u.company_name}
                </Link>
                {i < list.length - 1 ? <span className="text-white/30 ml-2">·</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Bellwethers tab — grid of company tiles with next-report date.
function BellwetherListDark({ items }: { items: LatestQuarterRow[] }) {
  if (items.length === 0) {
    return <div className="text-white/60 text-[13px]">All bellwethers have reported this quarter.</div>;
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
      {items.map((r) => (
        <Link
          key={r.ticker}
          href={`/company/${encodeURIComponent(r.ticker)}`}
          className="group block px-2.5 py-2 border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
        >
          <div className="text-[12px] font-semibold tracking-tightest leading-tight truncate group-hover:text-core-pink transition-colors">
            {r.company_name.replace(/ Limited$| Ltd\.?$| Industries$/i, "").trim()}
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.14em] text-white/50 flex items-center gap-1">
            <span className="inline-block w-1 h-1 bg-core-pink rounded-full" />
            {r.next_result_date ? formatDate(r.next_result_date) : "Unscheduled"}
          </div>
        </Link>
      ))}
    </div>
  );
}

// Inline metric block — small kicker label + tight number + delta.
// Used in the inverted TODAY band (dark=true). Tuned for density,
// not display.
function BigNumber({ label, value, delta, dark }: {
  label: string; value: string; delta: number | null | undefined; dark?: boolean;
}) {
  const labelCls = dark ? "text-white/50" : "text-core-muted";
  const valCls   = dark ? "text-white" : "text-core-ink";
  const tone =
    delta == null ? (dark ? "text-white/50" : "text-core-muted") :
    delta > 0     ? "text-core-teal" :
    delta < 0     ? "text-core-negative" : (dark ? "text-white/50" : "text-core-muted");
  const sign = delta == null ? "" : delta > 0 ? "▲" : delta < 0 ? "▼" : "";
  return (
    <div>
      <div className={`text-[9px] uppercase tracking-[0.22em] ${labelCls} font-semibold`}>
        {label}
      </div>
      <div className={`mt-1 font-sans font-bold tabular-nums tracking-tightest leading-none text-[18px] md:text-[22px] ${valCls}`}>
        {value}
      </div>
      <div className={`mt-1 text-[12px] font-semibold tabular-nums ${tone}`}>
        {delta != null ? (
          <>
            <span className="text-[9px] mr-0.5">{sign}</span>
            {formatPct(Math.abs(delta))}
            <span className={`text-[9px] font-normal ml-1 uppercase tracking-wide ${dark ? "text-white/40" : "text-core-muted"}`}>
              YoY
            </span>
          </>
        ) : <span className="text-[11px]">— YoY</span>}
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

// BigStat — twin panels on the SEASON section. YoY number sized for
// presence but not dominance; paired with a thin direction marker.
function BigStat({ label, value, borderStart }: {
  label: string; value: number | null; borderStart?: boolean;
}) {
  const tone =
    value == null ? "text-core-muted" :
    value > 0     ? "text-core-teal" :
    value < 0     ? "text-core-negative" : "text-core-muted";
  const sign = value == null ? "" : value > 0 ? "↑" : value < 0 ? "↓" : "";
  return (
    <div className={`px-4 py-4 md:px-6 md:py-5 ${borderStart ? "md:border-l border-core-ink" : ""}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-core-muted font-semibold">
        <span className="inline-block w-2 h-[2px] bg-core-ink" />
        {label}
      </div>
      <div className={`mt-2 font-sans font-bold tracking-tightest leading-none tabular-nums text-[36px] md:text-[48px] ${tone}`}>
        <span className="text-[0.55em] align-top mr-1 font-semibold">{sign}</span>
        {value != null ? formatPct(Math.abs(value)) : "—"}
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-core-muted">
        {value == null ? "Not enough reporters" : "YoY · all reporters"}
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
    // Parse todayIso (YYYY-MM-DD, already IST-anchored by the parent)
    // as a local-midnight Date; incrementing by calendar days is
    // safest via direct Y/M/D math rather than adding 86.4M ms (DST
    // is moot in IST but the pattern is cleaner).
    const [y, m, d0] = todayIso.split("-").map(Number);
    const out: { iso: string; dow: string; num: string; items: UpcomingItem[] }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(y, (m ?? 1) - 1, (d0 ?? 1) + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
      <div className="grid grid-cols-7 gap-1 md:gap-1.5">
        {days.map((d) => {
          const isActive = d.iso === openDay;
          const isToday  = d.iso === todayIso;
          const hasItems = d.items.length > 0;
          return (
            <button
              key={d.iso}
              onClick={() => setOpenDay(d.iso)}
              className={`text-left px-2 py-1.5 md:px-2.5 md:py-2 border transition-colors ${
                isActive
                  ? "bg-core-ink text-white border-core-ink"
                  : hasItems
                    ? "bg-white border-core-line hover:border-core-ink"
                    : "bg-core-surface border-core-line text-core-muted"
              }`}
            >
              <div className={`text-[9px] uppercase tracking-[0.14em] ${isActive ? "text-white/70" : "text-core-muted"}`}>
                {d.dow}
              </div>
              <div className={`text-[14px] md:text-[16px] font-bold tabular-nums tracking-tightest leading-none ${isToday && !isActive ? "text-core-pink" : ""}`}>
                {d.num}
              </div>
              <div className={`mt-0.5 text-[10px] tabular-nums ${isActive ? "text-white/80" : hasItems ? "text-core-ink font-semibold" : "text-core-muted"}`}>
                {hasItems ? `${d.items.length}` : "—"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Expanded day panel */}
      {active && active.items.length > 0 ? (
        <div className="mt-3 px-3 py-2.5 border border-core-line bg-white">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1.5">
            <span className="text-[10px] uppercase tracking-[0.22em] text-core-muted font-semibold">
              {active.iso === todayIso ? "Today" : formatDate(active.iso)}
            </span>
            <span className="text-[10px] text-core-muted tabular-nums">
              {active.items.length} reporting
            </span>
          </div>
          <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px]">
            {active.items.slice(0, 24).map((u, i) => (
              <li key={u.ticker + u.next_result_date} className="whitespace-nowrap">
                <Link href={`/company/${encodeURIComponent(u.ticker)}`} className="font-medium hover:text-core-pink">
                  {u.company_name}
                </Link>
                {i < Math.min(active.items.length, 24) - 1 ? <span className="text-core-line-2 ml-2">·</span> : null}
              </li>
            ))}
            {active.items.length > 24 ? (
              <li className="text-[11px] text-core-muted">+{active.items.length - 24} more</li>
            ) : null}
          </ul>
        </div>
      ) : active ? (
        <div className="mt-3 px-3 py-2.5 border border-core-line bg-core-surface text-[13px] text-core-muted">
          No companies scheduled on {formatDate(active.iso)}.
        </div>
      ) : null}
    </div>
  );
}
