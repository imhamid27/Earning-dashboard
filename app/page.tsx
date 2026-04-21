"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import FilingLoader from "@/components/FilingLoader";
import CompanyTable from "@/components/CompanyTable";
import CompanySearch from "@/components/CompanySearch";
import FreshnessIndicator from "@/components/FreshnessIndicator";
import EmptyState from "@/components/EmptyState";
import { formatINR, formatDate, formatPct, pctToneClass } from "@/lib/format";
import type { LatestQuarterRow } from "@/lib/types";

const DEFAULT_QUARTER = process.env.NEXT_PUBLIC_DEFAULT_QUARTER || "Q4 FY26";

// Bellwethers shown under the "Big names" tab when pending.
const MAJOR_TICKERS = [
  "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "INFY.NS", "ICICIBANK.NS",
  "ITC.NS", "HINDUNILVR.NS", "SBIN.NS", "BHARTIARTL.NS", "LT.NS",
  "BAJFINANCE.NS", "HCLTECH.NS", "KOTAKBANK.NS", "MARUTI.NS", "ASIANPAINT.NS"
];

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
interface UpcomingItem { ticker: string; company_name: string; sector: string | null; next_result_date: string }

// Brand loader gets a minimum display time so fast Supabase round-trips
// don't flash past in 80ms.
const MIN_LOADER_MS = 850;

export default function DashboardPage() {
  const [quarter, setQuarter] = useState<string>(DEFAULT_QUARTER);
  const [availableQuarters, setAvailableQuarters] = useState<string[]>([DEFAULT_QUARTER]);
  const [board, setBoard] = useState<DashboardResp | null>(null);
  const [summary, setSummary] = useState<SummaryResp | null>(null);
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
      const [b, s, up] = await Promise.all([
        fetch(`/api/dashboard?quarter=${encodeURIComponent(quarter)}`).then((r) => r.json()),
        fetch(`/api/summary?quarter=${encodeURIComponent(quarter)}`).then((r) => r.json()),
        fetch(`/api/upcoming`).then((r) => r.json())
      ]);
      if (!b.ok) throw new Error(b.error || "dashboard failed");
      setBoard(b.data);
      setSummary(s.ok ? s.data : null);
      setUpcoming(up.ok ? up.data : []);
    } catch (err: any) { setError(err.message || "Failed to load"); }
  }, [quarter]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh so the LIVE band picks up freshly-landed filings
  // without the reader having to reload. Polls every 2 min while the
  // tab is visible; also fires once immediately when the tab regains
  // focus (user switching back after looking at a source PDF, etc.).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") fetchAll();
    }, 120_000);
    const onVis = () => {
      if (document.visibilityState === "visible") fetchAll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchAll]);

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
    return { todayIso: add(0), tomorrowIso: add(1), weekEndIso: add(6) };
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

  // Tabs on the Live band use these.
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
  const bellwethers = useMemo(() => {
    const filedSet = new Set(filed.map((r) => r.ticker));
    const out: LatestQuarterRow[] = [];
    for (const t of MAJOR_TICKERS) {
      const r = (board?.rows ?? []).find((x) => x.ticker === t);
      if (!r || filedSet.has(t)) continue;
      out.push(r);
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
          2. LIVE BAND — inverted black newsroom panel. Today's lead
          reporter + other filers + any companies whose filing is still
          pending. Scrolls with the page (no fixed height, no tabs).
          ================================================================= */}
      <TodayBand
        lead={todayLead}
        others={todayOthers}
        pending={todayPending}
        tomorrow={tomorrowReporters}
        restOfWeek={restOfWeek}
        bellwethers={bellwethers}
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
  lead, others, pending, tomorrow, restOfWeek, bellwethers, todayIso, nextUp
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

  const counts = {
    today:       filedCount + pending.length,
    tomorrow:    tomorrow.length,
    week:        restOfWeek.length,
    bellwethers: bellwethers.length,
  };

  return (
    <section className="bg-core-ink text-white rounded-lg overflow-hidden flex flex-col max-h-[460px] md:max-h-[500px]">
      {/* Header — single-line banner: pulse · LIVE · WEEKDAY, DATE · count.
          All elements the same size so nothing floats, gap-2 keeps the
          group tight. */}
      <div className="px-5 md:px-6 pt-5 md:pt-6">
        <div className="flex items-center justify-between gap-4 flex-wrap text-[11px] uppercase tracking-[0.22em] text-white/60 font-semibold">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${hasActivity ? "bg-core-pink animate-pulse" : "bg-white/30"}`} />
            <span>Live</span>
            <span className="text-white/20">·</span>
            <span className="text-white">
              {dayOfWeek}, {dayShort}
            </span>
          </div>
          <div>
            <span className="text-white tabular-nums">{filedCount}</span>
            <span className="text-white/60"> filed</span>
            {pending.length > 0 ? (
              <>
                <span className="text-white/30 mx-2">·</span>
                <span className="text-white tabular-nums">{pending.length}</span>
                <span className="text-white/60"> expected</span>
              </>
            ) : null}
          </div>
        </div>

        <nav className="mt-4 md:mt-5 flex flex-wrap gap-x-4 gap-y-1.5 border-b border-white/10 -mx-1">
          <TabButton active={tab === "today"}       onClick={() => setTab("today")}       label="Today"       count={counts.today} />
          <TabButton active={tab === "tomorrow"}    onClick={() => setTab("tomorrow")}    label="Tomorrow"    count={counts.tomorrow} />
          <TabButton active={tab === "week"}        onClick={() => setTab("week")}        label="This week"   count={counts.week} />
          <TabButton active={tab === "bellwethers"} onClick={() => setTab("bellwethers")} label="Big names"   count={counts.bellwethers} />
        </nav>
      </div>

      {/* Scrollable tab content */}
      <div className="px-5 md:px-6 pb-5 md:pb-6 pt-4 md:pt-5 overflow-y-auto flex-1">
        {tab === "today" ? (
          <TodayTableDark
            reported={lead ? [lead, ...others] : others}
            pending={pending}
            nextUp={nextUp}
          />
        ) : tab === "tomorrow" ? (
          <UpcomingTableDark items={tomorrow} emptyText="No filings scheduled tomorrow." />
        ) : tab === "week" ? (
          <UpcomingTableDark items={restOfWeek} emptyText="Nothing else scheduled this week." />
        ) : tab === "bellwethers" ? (
          <BellwetherTableDark items={bellwethers} />
        ) : null}
      </div>
    </section>
  );
}

// Tab pill in the Live-band header.
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

// Today tab — unified table. Reported companies get live numbers;
// pending companies share the same row shape but with a muted
// "Filing pending" placeholder in the numeric columns. Table fills
// in as new filings land during the day (no reload required — the
// parent re-fetches on interval or user interaction).
function TodayTableDark({ reported, pending, nextUp }: {
  reported: LatestQuarterRow[];
  pending: UpcomingItem[];
  nextUp: UpcomingItem | undefined;
}) {
  if (reported.length === 0 && pending.length === 0) {
    return (
      <div className="text-white/70 text-[13px]">
        No Indian companies have reported today.
        {nextUp ? (
          <> Next up: <span className="text-white font-medium">{nextUp.company_name}</span> tomorrow.</>
        ) : null}
      </div>
    );
  }
  return (
    <div className="divide-y divide-white/10 border-t border-white/10">
      <div className="grid grid-cols-12 gap-3 py-2 text-[9px] uppercase tracking-[0.14em] text-white/40 font-semibold">
        <div className="col-span-12 md:col-span-5">Company</div>
        <div className="hidden md:block md:col-span-3">Revenue · YoY</div>
        <div className="hidden md:block md:col-span-3">Net profit · YoY</div>
        <div className="hidden md:block md:col-span-1 text-right">Status</div>
      </div>

      {/* Reported — sorted revenue-desc upstream */}
      {reported.map((r) => (
        <Link
          key={r.ticker}
          href={`/company/${encodeURIComponent(r.ticker)}`}
          className="grid grid-cols-12 gap-3 py-2 hover:bg-white/5 transition-colors text-[13px]"
        >
          <div className="col-span-12 md:col-span-5 min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-semibold truncate tracking-tightest">{r.company_name}</span>
              <span className="text-[10px] text-white/40 tabular-nums hidden lg:inline">{r.ticker}</span>
            </div>
            {r.sector ? (
              <div className="text-[10px] text-white/40 uppercase tracking-[0.14em] mt-0.5 md:hidden">
                {r.sector}
              </div>
            ) : null}
          </div>
          <div className="col-span-6 md:col-span-3 flex items-baseline gap-1.5 min-w-0">
            <span className="font-semibold tabular-nums truncate">{formatINR(r.revenue)}</span>
            <DeltaChipDark value={r.revenue_yoy} />
          </div>
          <div className="col-span-6 md:col-span-3 flex items-baseline gap-1.5 min-w-0">
            <span className="font-semibold tabular-nums truncate">{formatINR(r.net_profit)}</span>
            <DeltaChipDark value={r.profit_yoy} />
          </div>
          <div className="hidden md:flex md:col-span-1 items-center justify-end">
            <span className="text-[9px] uppercase tracking-[0.14em] text-core-teal font-semibold">Filed</span>
          </div>
        </Link>
      ))}

      {/* Pending — same shape, muted metrics */}
      {pending.map((p) => (
        <Link
          key={p.ticker + "_pending"}
          href={`/company/${encodeURIComponent(p.ticker)}`}
          className="grid grid-cols-12 gap-3 py-2 hover:bg-white/5 transition-colors text-[13px]"
        >
          <div className="col-span-12 md:col-span-5 min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-semibold truncate tracking-tightest text-white/70">{p.company_name}</span>
              <span className="text-[10px] text-white/40 tabular-nums hidden lg:inline">{p.ticker}</span>
            </div>
            {p.sector ? (
              <div className="text-[10px] text-white/40 uppercase tracking-[0.14em] mt-0.5 md:hidden">
                {p.sector}
              </div>
            ) : null}
          </div>
          <div className="col-span-6 md:col-span-3 text-white/40 text-[12px] italic">
            Awaiting filing
          </div>
          <div className="col-span-6 md:col-span-3 text-white/40 text-[12px] italic">
            Awaiting filing
          </div>
          <div className="hidden md:flex md:col-span-1 items-center justify-end">
            <span className="text-[9px] uppercase tracking-[0.14em] text-core-pink font-semibold">Pending</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

// Table-style row design for Tomorrow + This week tabs. Same rhythm as
// ReportedRowDark but with date + sector where financials would be.
function UpcomingTableDark({ items, emptyText }: {
  items: UpcomingItem[]; emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="text-white/60 text-[13px]">{emptyText}</div>;
  }
  return (
    <div className="divide-y divide-white/10 border-t border-white/10">
      <div className="grid grid-cols-12 gap-3 py-2 text-[9px] uppercase tracking-[0.14em] text-white/40 font-semibold">
        <div className="col-span-12 md:col-span-6">Company</div>
        <div className="hidden md:block md:col-span-3">Sector</div>
        <div className="hidden md:block md:col-span-3 text-right">Date</div>
      </div>
      {items.map((u) => (
        <Link
          key={u.ticker + u.next_result_date}
          href={`/company/${encodeURIComponent(u.ticker)}`}
          className="grid grid-cols-12 gap-3 py-2 hover:bg-white/5 transition-colors text-[13px]"
        >
          <div className="col-span-8 md:col-span-6 min-w-0 flex items-baseline gap-2">
            <span className="font-semibold truncate tracking-tightest">{u.company_name}</span>
            <span className="text-[10px] text-white/40 tabular-nums hidden lg:inline">{u.ticker}</span>
          </div>
          <div className="hidden md:block md:col-span-3 text-[12px] text-white/60 truncate">
            {u.sector ?? "—"}
          </div>
          <div className="col-span-4 md:col-span-3 md:text-right text-[12px] text-white/70 tabular-nums whitespace-nowrap">
            {formatDate(u.next_result_date)}
          </div>
        </Link>
      ))}
    </div>
  );
}

// Table-style row design for Bellwethers tab — company + sector + next
// announcement date.
function BellwetherTableDark({ items }: { items: LatestQuarterRow[] }) {
  if (items.length === 0) {
    return <div className="text-white/60 text-[13px]">All bellwethers have reported this quarter.</div>;
  }
  return (
    <div className="divide-y divide-white/10 border-t border-white/10">
      <div className="grid grid-cols-12 gap-3 py-2 text-[9px] uppercase tracking-[0.14em] text-white/40 font-semibold">
        <div className="col-span-12 md:col-span-6">Company</div>
        <div className="hidden md:block md:col-span-3">Sector</div>
        <div className="hidden md:block md:col-span-3 text-right">Expected</div>
      </div>
      {items.map((r) => (
        <Link
          key={r.ticker}
          href={`/company/${encodeURIComponent(r.ticker)}`}
          className="grid grid-cols-12 gap-3 py-2 hover:bg-white/5 transition-colors text-[13px]"
        >
          <div className="col-span-8 md:col-span-6 min-w-0 flex items-baseline gap-2">
            <span className="font-semibold truncate tracking-tightest">{r.company_name}</span>
            <span className="text-[10px] text-white/40 tabular-nums hidden lg:inline">{r.ticker}</span>
          </div>
          <div className="hidden md:block md:col-span-3 text-[12px] text-white/60 truncate">
            {r.sector ?? "—"}
          </div>
          <div className="col-span-4 md:col-span-3 md:text-right text-[12px] text-white/70 tabular-nums whitespace-nowrap">
            {r.next_result_date ? formatDate(r.next_result_date) : "Unscheduled"}
          </div>
        </Link>
      ))}
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

