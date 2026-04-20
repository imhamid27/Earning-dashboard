"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import FeaturedHeroCard from "@/components/FeaturedHeroCard";
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
  const totalFiled = summary?.companies_reported ?? filed.length;
  const totalTracked = summary?.companies_tracked ?? 500;
  const todayLead = todayReporters[0];
  const todayOthers = todayReporters.slice(1);

  return (
    <div className="container-core pb-20">
      {/* =================================================================
          1. MASTHEAD — newspaper-style opening. One headline, one
          sentence of status, one small selector.
          ================================================================= */}
      <section className="pt-6 md:pt-14 pb-6 md:pb-8">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-core-muted mb-3">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink" />
              <span>India earnings</span>
              <span className="text-core-line-2">/</span>
              <span className="text-core-ink font-semibold">{quarter}</span>
              {cal ? <><span className="text-core-line-2">/</span><span>{cal}</span></> : null}
            </div>
            <h1 className="font-sans font-bold tracking-tightest leading-[0.95] text-[clamp(2.5rem,6vw,4.75rem)]">
              India Inc. Reporting
            </h1>
            <p className="mt-5 md:mt-6 text-[15px] md:text-[17px] tracking-tight leading-snug max-w-2xl">
              <span className="font-semibold tabular-nums">{totalFiled}</span>
              <span className="text-core-muted"> have filed so far. </span>
              <span className="font-semibold tabular-nums">{weekCount}</span>
              <span className="text-core-muted"> reporting through this week. </span>
              <span className="text-core-muted">
                <Link href="/q4" className="text-core-pink hover:underline">
                  See the day-by-day →
                </Link>
              </span>
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 text-right shrink-0">
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-core-muted">
              Viewing
              <select
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                className="border border-core-line bg-white text-sm px-3 py-1.5 rounded-md normal-case text-core-ink font-semibold focus:outline-none focus:border-core-pink"
              >
                {availableQuarters.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </label>
            {summary ? <FreshnessIndicator fetchedAt={summary.last_refreshed_at} /> : null}
          </div>
        </div>
      </section>

      {/* =================================================================
          2. TODAY — the story of the day. Lead reporter in a big card,
          others as compact rows, pending today as chips.
          ================================================================= */}
      <section className="border-t border-core-line pt-8 md:pt-10">
        <SectionHead
          kicker="Today"
          date={formatDate(todayIso)}
          subtitle={
            todayReporters.length > 0
              ? `${todayReporters.length} filed${todayPending.length > 0 ? ` · ${todayPending.length} expected` : ""}`
              : todayPending.length > 0
                ? `${todayPending.length} expected to file`
                : "No filings yet today"
          }
        />

        {todayLead ? (
          <div className="mt-5">
            <FeaturedHeroCard row={todayLead} quarter={quarter} />
          </div>
        ) : null}

        {todayOthers.length > 0 ? (
          <div className="mt-4 divide-y divide-core-line border-y border-core-line">
            {todayOthers.map((r) => (
              <TodayRow key={r.ticker} row={r} />
            ))}
          </div>
        ) : null}

        {todayPending.length > 0 ? (
          <div className="mt-4 text-sm">
            <span className="text-[10px] uppercase tracking-[0.14em] text-core-muted mr-3">
              Filing pending
            </span>
            <span className="text-core-ink">
              {todayPending.map((p, i) => (
                <span key={p.ticker} className="whitespace-nowrap">
                  <Link href={`/company/${encodeURIComponent(p.ticker)}`} className="hover:text-core-pink">
                    {p.company_name}
                  </Link>
                  {i < todayPending.length - 1 ? <span className="text-core-line-2 mx-2">·</span> : null}
                </span>
              ))}
            </span>
          </div>
        ) : null}

        {todayReporters.length === 0 && todayPending.length === 0 ? (
          <div className="mt-5 text-sm text-core-muted">
            No Indian companies reported today.
            {tomorrowReporters.length > 0 ? (
              <> Next up: <span className="text-core-ink font-medium">{tomorrowReporters[0].company_name}</span> tomorrow.</>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* =================================================================
          3. THE SEASON SO FAR — editorial aggregate in full sentences,
          then a thin sector bar. No KPI grid, no hero numbers.
          ================================================================= */}
      <section className="mt-14 md:mt-16 border-t border-core-line pt-8 md:pt-10">
        <SectionHead
          kicker={`The ${quarter} season so far`}
          subtitle={`Based on ${filed.length} ${filed.length === 1 ? "company" : "companies"} that have filed`}
        />

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 space-y-4">
            <p className="text-[17px] md:text-[19px] leading-snug tracking-tight">
              Aggregate revenue is
              {" "}<DeltaInline value={summary?.avg_revenue_yoy ?? null} suffix="YoY" />
              {". "}Profit is
              {" "}<DeltaInline value={summary?.avg_profit_yoy ?? null} suffix="YoY" />
              {". "}
              <span className="text-core-muted">
                Year-on-year vs {yoyQuarter(quarter)}.
              </span>
            </p>
            {seasonInsight.revLead || seasonInsight.profLead ? (
              <p className="text-[15px] leading-snug tracking-tight text-core-ink">
                {seasonInsight.revLead ? (
                  <>
                    <span className="font-semibold">{seasonInsight.revLead}</span>
                    <span className="text-core-muted"> is leading revenue growth</span>
                  </>
                ) : null}
                {seasonInsight.revLead && seasonInsight.profLead && seasonInsight.revLead !== seasonInsight.profLead ? (
                  <>
                    <span className="text-core-muted">; </span>
                    <span className="font-semibold">{seasonInsight.profLead}</span>
                    <span className="text-core-muted"> is leading profit growth</span>
                  </>
                ) : seasonInsight.revLead === seasonInsight.profLead && seasonInsight.profLead ? (
                  <span className="text-core-muted"> — and profit growth</span>
                ) : null}
                <span className="text-core-muted">.</span>
              </p>
            ) : null}
          </div>

          <div className="lg:col-span-5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted mb-3">
              Sector · revenue YoY
            </div>
            <SectorComparison rows={sectors?.sectors ?? []} metric="revenue_yoy" height={220} />
          </div>
        </div>
      </section>

      {/* =================================================================
          4. COMING UP — chronologically simple, no tables.
          ================================================================= */}
      <section className="mt-14 md:mt-16 border-t border-core-line pt-8 md:pt-10">
        <SectionHead
          kicker="Coming up"
          subtitle={`Through ${formatDate(weekEndIso)}`}
        />

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          <div className="lg:col-span-7 space-y-5">
            {tomorrowReporters.length > 0 ? (
              <ComingUpGroup
                label={`Tomorrow · ${formatDate(tomorrowIso)}`}
                items={tomorrowReporters}
              />
            ) : null}
            {restOfWeek.length > 0 ? (
              <ComingUpGroup
                label="Rest of the week"
                items={restOfWeek}
              />
            ) : null}
            {tomorrowReporters.length === 0 && restOfWeek.length === 0 ? (
              <div className="text-sm text-core-muted">No filings scheduled this week.</div>
            ) : null}
            <div className="pt-1">
              <Link href="/upcoming" className="text-xs link-pink">
                Full upcoming calendar →
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted mb-3">
              Big names still to report
            </div>
            {majorsPending.length === 0 ? (
              <div className="text-sm text-core-muted">
                All bellwethers have reported.
              </div>
            ) : (
              <ul className="space-y-2.5 text-sm">
                {majorsPending.map((r) => (
                  <li key={r.ticker} className="flex items-baseline justify-between gap-3 border-b border-core-line pb-2 last:border-none">
                    <Link href={`/company/${encodeURIComponent(r.ticker)}`} className="font-medium truncate hover:text-core-pink">
                      {r.company_name}
                    </Link>
                    <span className="text-[11px] text-core-muted tabular-nums whitespace-nowrap">
                      {r.next_result_date ? formatDate(r.next_result_date) : "unscheduled"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* =================================================================
          5. FIND A COMPANY — search + full table.
          ================================================================= */}
      <section className="mt-14 md:mt-16 border-t border-core-line pt-8 md:pt-10">
        <SectionHead kicker="Find a company" />

        <div className="mt-5">
          <CompanySearch onSelect={scrollToTicker} />
        </div>

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
                  All {sorted.length} that have filed
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

// Section head — repeating kicker + subtitle pattern between sections.
// A single place to tune spacing, typographic rhythm for section breaks.
function SectionHead({ kicker, date, subtitle }: {
  kicker: string; date?: string; subtitle?: string;
}) {
  return (
    <header className="flex items-baseline justify-between gap-4 flex-wrap">
      <div className="flex items-baseline gap-4 flex-wrap">
        <h2 className="text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-core-muted font-semibold">
          {kicker}
        </h2>
        {date ? (
          <span className="text-[22px] md:text-[28px] font-bold tracking-tightest leading-none">
            {date}
          </span>
        ) : null}
      </div>
      {subtitle ? (
        <span className="text-[12px] md:text-[13px] text-core-muted tabular-nums">
          {subtitle}
        </span>
      ) : null}
    </header>
  );
}

// Compact row for today's non-lead reporters. Dense, scannable — no
// card chrome, just company name + inline metrics separated by hairlines.
function TodayRow({ row }: { row: LatestQuarterRow }) {
  return (
    <Link
      href={`/company/${encodeURIComponent(row.ticker)}`}
      className="grid grid-cols-12 gap-3 py-3.5 hover:bg-core-surface/60 transition-colors"
    >
      <div className="col-span-12 md:col-span-4 min-w-0">
        <div className="font-semibold tracking-tightest truncate">{row.company_name}</div>
        <div className="text-[11px] text-core-muted">
          {row.ticker}{row.sector ? <> · {row.sector}</> : null}
        </div>
      </div>
      <div className="col-span-6 md:col-span-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted">Revenue</div>
        <div className="flex items-baseline gap-2">
          <span className="font-semibold tabular-nums">{formatINR(row.revenue)}</span>
          <span className={`text-[12px] tabular-nums ${pctToneClass(row.revenue_yoy)}`}>
            {formatPct(row.revenue_yoy)}
          </span>
        </div>
      </div>
      <div className="col-span-6 md:col-span-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted">Net profit</div>
        <div className="flex items-baseline gap-2">
          <span className="font-semibold tabular-nums">{formatINR(row.net_profit)}</span>
          <span className={`text-[12px] tabular-nums ${pctToneClass(row.profit_yoy)}`}>
            {formatPct(row.profit_yoy)}
          </span>
        </div>
      </div>
      <div className="hidden md:flex col-span-2 items-center justify-end text-[12px] text-core-muted group-hover:text-core-pink">
        View →
      </div>
    </Link>
  );
}

// Inline delta — used in SEASON section's full-sentence aggregate.
// "Aggregate revenue is UP 14.9% YoY." — the delta gets the tone colour
// so the sentence communicates direction at a glance.
function DeltaInline({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value == null) return <span className="text-core-muted">unchanged</span>;
  const word = value > 0.0005 ? "up" : value < -0.0005 ? "down" : "flat";
  const cls = pctToneClass(value);
  return (
    <span className={`font-semibold ${cls}`}>
      {word} {formatPct(Math.abs(value))}
      {suffix ? <span className="text-core-muted font-normal"> {suffix}</span> : null}
    </span>
  );
}

// COMING UP group (tomorrow / rest of week). Headlined label + name list.
function ComingUpGroup({ label, items }: { label: string; items: UpcomingItem[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted mb-2">
        {label} · {items.length}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {items.slice(0, 12).map((u, i) => (
          <li key={u.ticker + u.next_result_date} className="whitespace-nowrap">
            <Link href={`/company/${encodeURIComponent(u.ticker)}`} className="font-medium hover:text-core-pink">
              {u.company_name}
            </Link>
            {i < Math.min(items.length, 12) - 1 ? <span className="text-core-line-2 ml-4">·</span> : null}
          </li>
        ))}
        {items.length > 12 ? (
          <li className="text-[11px] text-core-muted">+{items.length - 12} more</li>
        ) : null}
      </ul>
    </div>
  );
}
