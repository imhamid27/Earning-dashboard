"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import FilingLoader from "@/components/FilingLoader";
import CompanyTable from "@/components/CompanyTable";
import CompanySearch from "@/components/CompanySearch";
import FreshnessIndicator from "@/components/FreshnessIndicator";
import EmptyState from "@/components/EmptyState";
import IntelligenceStrip from "@/components/IntelligenceStrip";
import InfoTooltip from "@/components/InfoTooltip";
import { DISCLAIMER_SHORT, DISCLAIMER_MARKETS } from "@/lib/disclaimer";
import { trackLiveBandTab } from "@/lib/analytics";
import { formatINR, formatDate, formatPct, pctToneClass } from "@/lib/format";
import type { LatestQuarterRow } from "@/lib/types";

const DEFAULT_QUARTER = process.env.NEXT_PUBLIC_DEFAULT_QUARTER || "Q4 FY26";

// Bellwethers shown under the "Big names" tab when pending.
const MAJOR_TICKERS = [
  "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "INFY.NS", "ICICIBANK.NS",
  "ITC.NS", "HINDUNILVR.NS", "SBIN.NS", "BHARTIARTL.NS", "LT.NS",
  "BAJFINANCE.NS", "HCLTECH.NS", "KOTAKBANK.NS", "MARUTI.NS", "ASIANPAINT.NS"
];

// Editorial short-name for a company. Drops corporate suffixes so big
// names read as their natural press-reference form, and converts
// ALL-CAPS DB rows to Title Case. Used in the inline previews where
// space is tight (big names strip, surprise movers).
function shortName(raw: string): string {
  if (!raw) return "";
  let s = raw.trim()
    // Drop corporate suffixes + common boilerplate
    .replace(/\s+(Limited|Ltd\.?|Inc\.?|Corp\.?|Corporation|PLC|LLP)\b.*$/i, "")
    .replace(/\s+(Industries|Company|Industrial|Infrastructure|Enterprise(s)?|Services?)\b.*$/i, "")
    .trim();
  // Drop ALL-CAPS shout (like "ANAND RATHI SHARE AND STOCK BROK")
  // and re-case to Title Case. Leave mixed-case names untouched.
  if (/^[A-Z0-9 &\.\-\/]+$/.test(s) && s.length > 3) {
    s = s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
  }
  // Trim to 24 chars for really stubborn names.
  if (s.length > 28) s = s.slice(0, 26).trim() + "…";
  return s;
}

// "Updated 3m ago" / "Updated just now" / "Updated 12:04 PM IST" —
// readable relative timestamp for the Market strip. Falls back to the
// absolute IST clock time when the source is more than an hour old.
function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = Date.now() - t;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  // Past an hour — show the absolute IST clock time instead of "Xh".
  const clock = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric", minute: "2-digit", hour12: true
  }).format(new Date(iso));
  return `${clock} IST`;
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

interface MarketContextResp {
  as_of: string;
  // "open"  : values are live-ticking (snapshot <30 min old)
  // "closed": post-market — show last close with a "Closed" chip
  // "stale" : no fresh data at all (extended downtime); values may be null
  market_status?: "open" | "closed" | "stale";
  indices: Array<{
    key: string;
    name: string;
    change_pct: number | null;
    last_price: number | null;
  }>;
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
  const [market, setMarket] = useState<MarketContextResp | null>(null);
  const [prices, setPrices] = useState<Record<string, { last_price: number | null; change_pct: number | null }>>({});
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
      const [b, s, up, mk, px] = await Promise.all([
        fetch(`/api/dashboard?quarter=${encodeURIComponent(quarter)}`).then((r) => r.json()),
        fetch(`/api/summary?quarter=${encodeURIComponent(quarter)}`).then((r) => r.json()),
        fetch(`/api/upcoming`).then((r) => r.json()),
        fetch(`/api/market-context`).then((r) => r.json()).catch(() => ({ ok: false })),
        fetch(`/api/prices`).then((r) => r.json()).catch(() => ({ ok: false })),
      ]);
      if (!b.ok) throw new Error(b.error || "dashboard failed");
      setBoard(b.data);
      setSummary(s.ok ? s.data : null);
      setUpcoming(up.ok ? up.data : []);
      // Market is supporting context only — silent failure, keep last good value.
      if (mk?.ok) setMarket(mk.data);
      if (px?.ok && px.data?.prices) setPrices(px.data.prices);
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
  const { yesterdayIso, todayIso, tomorrowIso, weekEndIso } = useMemo(() => {
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
      yesterdayIso: add(-1),
      todayIso:     add(0),
      tomorrowIso:  add(1),
      weekEndIso:   add(6),
    };
  }, []);

  // All companies that have filed Q4 FY26 with at least SOME numbers
  // extracted. Full rows (rev + np) land first; partial rows (e.g. we
  // parsed revenue but couldn't extract net profit from the PDF) appear
  // with dashes in missing cells so the reader can still see what's
  // available and click through to the filing. This is more honest than
  // hiding partials entirely — they're real filings, just with one
  // number stuck.
  const filed = useMemo(
    () => (board?.rows ?? [])
      .filter((r) =>
        r.status === "announced_with_numbers" ||
        (r.status === "announced" && (r.revenue != null || r.net_profit != null))
      ),
    [board]
  );

  // TODAY — companies whose result landed today, sorted revenue-desc.
  const todayReporters = useMemo(
    () => filed
      .filter((r) => r.result_date === todayIso)
      .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0)),
    [filed, todayIso]
  );

  // YESTERDAY — companies whose result landed yesterday. Used as a fallback
  // default tab in the LIVE band so the reader lands on filled content
  // first thing in the morning, before today's filings have started
  // coming in.
  const yesterdayReporters = useMemo(
    () => filed
      .filter((r) => r.result_date === yesterdayIso)
      .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0)),
    [filed, yesterdayIso]
  );

  // Pending today = has an event today but no numbers. Pulled from
  // upcoming (status=pending, date>=today) intersected with "date=today",
  // PLUS dashboard rows with status='announced' and result_date=today —
  // those are companies whose announcement event fired today but whose
  // numbers haven't been indexed by Screener/NSE yet. Dedupe against
  // reporters that already have numbers.
  const todayPending = useMemo(() => {
    const pendingFromUpcoming = upcoming
      .filter((u) => u.next_result_date === todayIso);
    const pendingFromAnnounced = (board?.rows ?? [])
      .filter((r) => r.status === "announced" && r.result_date === todayIso)
      .map((r) => ({
        ticker: r.ticker,
        company_name: r.company_name,
        sector: r.sector,
        next_result_date: todayIso,
      }));
    const seen = new Set<string>();
    const all: UpcomingItem[] = [];
    for (const u of [...pendingFromAnnounced, ...pendingFromUpcoming]) {
      if (seen.has(u.ticker)) continue;
      if (todayReporters.some((r) => r.ticker === u.ticker)) continue;
      seen.add(u.ticker);
      all.push(u);
    }
    return all;
  }, [upcoming, todayIso, todayReporters, board]);

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

  // ─── Intelligence layer (feature 1/2/3/6) ────────────────────────────
  // 1. "What changed today" — simple counts with strong / weak labels.
  //    Always renders (even with zeros) so the reader knows the count
  //    is a live reading, not a missing module.
  const todayChange = useMemo(() => {
    const filedToday = [...(todayReporters ?? [])];
    const strong = filedToday.filter((r) => (r.profit_yoy ?? 0) > 0.2).length;
    const weak   = filedToday.filter((r) => (r.profit_yoy ?? 0) < 0).length;
    return { total: filedToday.length, strong, weak };
  }, [todayReporters]);

  // 2. Earnings pulse — top + weakest sector by profit YoY across
  //    filed companies this quarter. Only if we have enough signal.
  const earningsPulse = useMemo(() => {
    if (filed.length < 5) return null;
    const bySector = new Map<string, number[]>();
    for (const r of filed) {
      if (!r.sector || r.profit_yoy == null) continue;
      if (!bySector.has(r.sector)) bySector.set(r.sector, []);
      bySector.get(r.sector)!.push(r.profit_yoy);
    }
    let top: [string, number] | null = null;
    let bot: [string, number] | null = null;
    for (const [s, vs] of bySector) {
      if (vs.length < 2) continue;
      const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
      if (!top || avg > top[1]) top = [s, avg];
      if (!bot || avg < bot[1]) bot = [s, avg];
    }
    if (!top || !bot || top[0] === bot[0]) return null;
    return { top: top[0], bot: bot[0] };
  }, [filed]);

  // 3. Big names today — bellwethers actually scheduled to file today.
  //    Shown inline under the LIVE band as a tiny preview of the
  //    "Big names" tab.
  const bigNamesToday = useMemo(() => {
    const MAJOR = new Set(MAJOR_TICKERS);
    // First: already-filed bellwethers today (highest signal).
    const filedBig = todayReporters.filter((r) => MAJOR.has(r.ticker));
    // Then: bellwethers scheduled for today but still pending.
    const scheduledBig = upcoming
      .filter((u) => u.next_result_date === todayIso && MAJOR.has(u.ticker))
      .filter((u) => !filedBig.some((r) => r.ticker === u.ticker))
      .map((u) => ({ ticker: u.ticker, company_name: u.company_name }));
    return [...filedBig.map((r) => ({ ticker: r.ticker, company_name: r.company_name })), ...scheduledBig].slice(0, 3);
  }, [todayReporters, upcoming, todayIso]);

  // 6. Surprise movers — biggest up / biggest down profit YoY for the
  //    quarter. Guards against absurd ±500% from tiny prior-year bases.
  const surpriseMovers = useMemo(() => {
    const clean = filed.filter((r) => r.profit_yoy != null && Math.abs(r.profit_yoy!) <= 5);
    if (clean.length < 2) return null;
    const sorted = [...clean].sort((a, b) => (b.profit_yoy ?? 0) - (a.profit_yoy ?? 0));
    const up = sorted[0];
    const down = sorted[sorted.length - 1];
    if (up.ticker === down.ticker) return null;
    return { up, down };
  }, [filed]);

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
    if (idx < 0) {
      // Ticker isn't in the filed table (hasn't reported this quarter
      // yet, or is in a different segment). Go straight to its company
      // page instead of silently doing nothing.
      window.location.href = `/company/${encodeURIComponent(ticker)}`;
      return;
    }
    setAllPage(Math.floor(idx / PAGE_SIZE));
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
        {/* Breadcrumb row — on mobile the freshness chip sits BELOW
            the breadcrumb so neither wraps onto two awkward lines. */}
        <div className="flex items-center gap-x-2 gap-y-1.5 text-[10px] uppercase tracking-[0.14em] text-core-muted mb-3 flex-wrap">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink animate-pulse" />
          <span>India earnings</span>
          <span className="text-core-line-2">/</span>
          <span className="text-core-ink font-semibold">{quarter}</span>
          {cal ? <><span className="text-core-line-2">/</span><span>{cal}</span></> : null}
          {/* Freshness chip — pushed to the right on wide viewports, wraps
              onto its own line on mobile automatically. */}
          {summary ? (
            <span className="md:ml-auto">
              <FreshnessIndicator fetchedAt={summary.last_refreshed_at} />
            </span>
          ) : null}
        </div>

        {/* Title with inline ⓘ. Critical trick: the heading is a plain
            block element (not flex) so text can wrap naturally, AND the
            InfoTooltip is inside a zero-width inline-block that hugs the
            last word. This prevents the icon from being orphaned on its
            own line on narrow viewports. */}
        <h1 className="font-sans font-bold tracking-tightest leading-[1.02] md:leading-[0.95] text-[clamp(1.75rem,4.5vw,3.25rem)]">
          India Inc. Reporting
          <span className="inline-block align-middle ml-2 -translate-y-0.5">
            <InfoTooltip text={DISCLAIMER_SHORT} size="md" />
          </span>
        </h1>
      </section>

      {/* ==== MARKET CONTEXT STRIP ====
          Always visible. Outside market hours we tag it "Closed" and show
          last-traded levels instead of hiding it — readers expect reference
          numbers the moment the page loads, whether the market is open or
          not.
       */}
      {market ? (
        <div className="border-y border-core-line mb-6 py-2.5">
          {/* Label row — Markets + LIVE/CLOSED chip on its own line so
              the indices row below can use the full width on mobile. */}
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.22em] text-core-muted font-semibold mb-1.5">
            <span>Markets</span>
            <InfoTooltip text={DISCLAIMER_MARKETS} />
            {market.market_status === "open" ? (
              <span className="inline-flex items-center gap-1 text-[8px] font-bold tracking-[0.15em] text-core-teal">
                <span className="w-1 h-1 rounded-full bg-core-teal animate-pulse" />
                LIVE
              </span>
            ) : market.market_status === "closed" ? (
              <span className="text-[8px] font-bold tracking-[0.15em] text-core-muted">
                · CLOSED
              </span>
            ) : null}
            {/* Freshness stamp, pushed right — on mobile this keeps in
                the label row (short), leaving the full indices row
                available below. */}
            <span
              className="ml-auto text-[10px] font-normal normal-case tracking-[0.14em] text-core-muted tabular-nums"
              title={market.as_of}
            >
              {market.market_status === "closed" ? "Last close " : "Updated "}
              {formatRelative(market.as_of)}
            </span>
          </div>

          {/* Indices row — horizontally scrollable on mobile. Never wraps,
              never clips — readers swipe to see any index. On desktop
              they all fit side-by-side naturally. */}
          <div className="flex flex-nowrap items-baseline gap-x-5 overflow-x-auto scrollbar-thin text-[13px] -mx-1 px-1">
            {market.indices.map((ix, i) => {
              const up   = (ix.change_pct ?? 0) > 0;
              const down = (ix.change_pct ?? 0) < 0;
              const arrow = ix.change_pct == null ? "" : up ? "▲" : down ? "▼" : "■";
              const cls = ix.change_pct == null
                ? "text-core-muted"
                : up ? "text-core-teal"
                : down ? "text-core-negative"
                : "text-core-muted";
              const priceText = ix.last_price != null
                ? ix.last_price.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : null;
              return (
                <span key={ix.key} className="whitespace-nowrap flex-shrink-0">
                  <span className="text-core-ink font-medium">{ix.name}</span>
                  {priceText ? (
                    <span className="ml-1.5 text-core-ink tabular-nums">{priceText}</span>
                  ) : null}
                  <span className={`ml-1.5 tabular-nums font-semibold ${cls}`}>
                    <span className="text-[10px] mr-0.5">{arrow}</span>
                    {ix.change_pct != null ? formatPct(ix.change_pct) : "Data not available"}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ==== INTELLIGENCE STRIP ====
          Dense 4-card grid above the LIVE band. Season progress,
          avg growth, top gainer, top decliner. Each card is a hard
          number with a one-line context tail.
       */}
      <IntelligenceStrip
        quarter={summary?.quarter ?? quarter}
        companies_tracked={summary?.companies_tracked ?? 0}
        companies_reported={summary?.companies_reported ?? 0}
        avg_revenue_yoy={summary?.avg_revenue_yoy ?? null}
        avg_profit_yoy={summary?.avg_profit_yoy ?? null}
        biggestGainer={surpriseMovers?.up ?? null}
        biggestLoser={surpriseMovers?.down ?? null}
        heaviestFiler={todayReporters[0] ?? null}
      />

      {/* =================================================================
          2. LIVE BAND — inverted black newsroom panel. Today's lead
          reporter + other filers + any companies whose filing is still
          pending. Scrolls with the page (no fixed height, no tabs).
          ================================================================= */}
      <TodayBand
        lead={todayLead}
        others={todayOthers}
        yesterday={yesterdayReporters}
        pending={todayPending}
        tomorrow={tomorrowReporters}
        restOfWeek={restOfWeek}
        bellwethers={bellwethers}
        todayIso={todayIso}
        yesterdayIso={yesterdayIso}
        nextUp={tomorrowReporters[0]}
        todayChange={todayChange}
        bigNamesToday={bigNamesToday}
      />

      {earningsPulse ? (() => {
        // If the DB sector literal is 'Other', spell it out as 'other
        // sectors' so the sentence reads naturally. Otherwise keep the
        // proper-noun sector name as-is.
        const isGenericBot = /^other$/i.test(earningsPulse.bot);
        const isGenericTop = /^other$/i.test(earningsPulse.top);
        return (
          <p className="mt-4 md:mt-5 text-[13px] md:text-[14px] text-core-muted italic leading-snug max-w-3xl">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink mr-2 align-middle" />
            {isGenericTop ? (
              <>Other sectors are driving profit growth; </>
            ) : (
              <>
                <span className="text-core-ink font-semibold not-italic">{earningsPulse.top}</span>
                {" "}are driving profit growth;{" "}
              </>
            )}
            {isGenericBot ? (
              <>other sectors are lagging so far.</>
            ) : (
              <>
                <span className="text-core-ink font-semibold not-italic">{earningsPulse.bot}</span>
                {" "}are lagging so far.
              </>
            )}
          </p>
        );
      })() : null}

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
              {/* 6. Surprise movers — biggest upside / downside, short
                  form. e.g. "Biggest upside: Anand Rathi (+133%)". */}
              {surpriseMovers ? (
                <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px] md:text-[13px]">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-core-muted font-semibold">Surprise movers</span>
                  <span>
                    <span className="text-core-muted">Biggest upside: </span>
                    <Link href={`/company/${encodeURIComponent(surpriseMovers.up.ticker)}`} className="font-semibold hover:text-core-pink">
                      {shortName(surpriseMovers.up.company_name)}
                    </Link>
                    <span className={`ml-1 font-semibold tabular-nums ${pctToneClass(surpriseMovers.up.profit_yoy)}`}>
                      ({formatPct(surpriseMovers.up.profit_yoy)})
                    </span>
                  </span>
                  <span className="text-core-line-2 hidden sm:inline">·</span>
                  <span>
                    <span className="text-core-muted">Biggest downside: </span>
                    <Link href={`/company/${encodeURIComponent(surpriseMovers.down.ticker)}`} className="font-semibold hover:text-core-pink">
                      {shortName(surpriseMovers.down.company_name)}
                    </Link>
                    <span className={`ml-1 font-semibold tabular-nums ${pctToneClass(surpriseMovers.down.profit_yoy)}`}>
                      ({formatPct(surpriseMovers.down.profit_yoy)})
                    </span>
                  </span>
                </div>
              ) : null}

              <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
                <span className="text-[10px] uppercase tracking-[0.14em] text-core-muted">
                  All {sorted.length} with numbers · {quarter}
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
              <CompanyTable
                rows={pageRows}
                preserveOrder
                highlightUp={surpriseMovers?.up.ticker}
                highlightDown={surpriseMovers?.down.ticker}
                prices={prices}
              />
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
type TabKey = "yesterday" | "today" | "tomorrow" | "week" | "bellwethers";

function TodayBand({
  lead, others, yesterday, pending, tomorrow, restOfWeek, bellwethers,
  todayIso, yesterdayIso, nextUp, todayChange, bigNamesToday
}: {
  lead: LatestQuarterRow | undefined;
  others: LatestQuarterRow[];
  yesterday: LatestQuarterRow[];
  pending: UpcomingItem[];
  tomorrow: UpcomingItem[];
  restOfWeek: UpcomingItem[];
  bellwethers: LatestQuarterRow[];
  todayIso: string;
  yesterdayIso: string;
  nextUp: UpcomingItem | undefined;
  todayChange: { total: number; strong: number; weak: number } | null;
  bigNamesToday: Array<{ ticker: string; company_name: string }>;
}) {
  const filedCount = (lead ? 1 : 0) + others.length;

  // Default to Today when there's actual filed content. Otherwise start
  // the reader on Yesterday's filings — a populated tab beats an empty
  // one with pending rows, especially in the morning before the first
  // filings drop.
  const initialTab: TabKey =
    filedCount > 0 ? "today"
    : yesterday.length > 0 ? "yesterday"
    : "today";
  const [tab, setTabRaw] = useState<TabKey>(initialTab);
  // Wrap setTab so every user-initiated tab switch fires a GA4
  // select_content event. The initial tab selection (driven by
  // filedCount / yesterday.length) doesn't go through this wrapper
  // so we don't double-count on page load.
  const setTab = (next: TabKey) => {
    if (next !== tab) trackLiveBandTab(next);
    setTabRaw(next);
  };

  const [yy, mm, dd] = todayIso.split("-").map(Number);
  const dayDate = new Date(yy, (mm ?? 1) - 1, dd ?? 1);
  const dayOfWeek = dayDate.toLocaleDateString("en-US", { weekday: "long" });
  const dayShort  = dayDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const [yy2, mm2, dd2] = yesterdayIso.split("-").map(Number);
  const yesterdayDate = new Date(yy2, (mm2 ?? 1) - 1, dd2 ?? 1);
  const yesterdayShort = yesterdayDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const hasActivity = filedCount > 0 || pending.length > 0;

  const counts = {
    yesterday:   yesterday.length,
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
            <span className="text-white/60"> filed today</span>
            {pending.length > 0 ? (
              <>
                <span className="text-white/30 mx-2">·</span>
                <span className="text-white tabular-nums">{pending.length}</span>
                <span className="text-white/60"> expected</span>
              </>
            ) : null}
            {/* Subtle reference so readers know yesterday's filings are a
                click away — especially useful in the morning before the
                first post-market drop. */}
            {yesterday.length > 0 && filedCount === 0 ? (
              <>
                <span className="text-white/30 mx-2">·</span>
                <button
                  onClick={() => setTab("yesterday")}
                  className="text-core-pink hover:text-white tabular-nums font-semibold"
                >
                  {yesterday.length} filed yesterday
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* Tabs: horizontally scrollable on narrow screens so no tab ever
            wraps or gets cut off. Flex with nowrap + overflow-x-auto,
            and a right-edge fade mask to hint that more tabs exist. */}
        <nav className="mt-4 md:mt-5 border-b border-white/10 -mx-5 md:mx-0 relative">
          <div className="flex flex-nowrap gap-x-4 overflow-x-auto scrollbar-thin px-5 md:px-0">
            {/* Yesterday tab is hidden when there's nothing to show —
                keeps the nav clean mid-quarter when we're deep into
                today's reporting. */}
            {counts.yesterday > 0 ? (
              <TabButton active={tab === "yesterday"}    onClick={() => setTab("yesterday")}    label="Yesterday"   count={counts.yesterday} />
            ) : null}
            <TabButton active={tab === "today"}       onClick={() => setTab("today")}       label="Today"       count={counts.today} />
            <TabButton active={tab === "tomorrow"}    onClick={() => setTab("tomorrow")}    label="Tomorrow"    count={counts.tomorrow} />
            <TabButton active={tab === "week"}        onClick={() => setTab("week")}        label="This week"   count={counts.week} />
            <TabButton active={tab === "bellwethers"} onClick={() => setTab("bellwethers")} label="Big names"   count={counts.bellwethers} />
          </div>
        </nav>

        {/* #3 Big names today — up to 3 bellwethers filing today.
            Names short-formed for inline legibility. */}
        {bigNamesToday.length > 0 ? (
          <div className="mt-3 md:mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px]">
            <span className="text-[9px] uppercase tracking-[0.22em] text-white/50 font-semibold mr-1">
              Big names today
            </span>
            {bigNamesToday.map((b, i) => (
              <span key={b.ticker} className="whitespace-nowrap">
                <Link href={`/company/${encodeURIComponent(b.ticker)}`} className="text-white hover:text-core-pink font-medium">
                  {shortName(b.company_name)}
                </Link>
                {i < bigNamesToday.length - 1 ? <span className="text-white/30 ml-2">·</span> : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Scrollable tab content */}
      <div className="px-5 md:px-6 pb-5 md:pb-6 pt-4 md:pt-5 overflow-y-auto flex-1">
        {/* #1 What changed today — always visible on the Today tab so the
            reader sees a live count, even when zero.
            strong = profit YoY > 20%, weak = profit YoY < 0%. */}
        {tab === "today" && todayChange ? (
          <div className="mb-4 pb-3 border-b border-white/10 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px]">
            <span className="text-[9px] uppercase tracking-[0.22em] text-white/50 font-semibold">Today</span>
            <span className={todayChange.total > 0 ? "text-white" : "text-white/60"}>
              <span className="font-semibold tabular-nums">{todayChange.total}</span>
              {" "}reported
            </span>
            <span className={todayChange.strong > 0 ? "text-core-teal" : "text-white/40"}>
              <span className="font-semibold tabular-nums">{todayChange.strong}</span>
              {" "}strong {todayChange.strong === 1 ? "result" : "results"}
            </span>
            <span className={todayChange.weak > 0 ? "text-core-pink" : "text-white/40"}>
              <span className="font-semibold tabular-nums">{todayChange.weak}</span>
              {" "}weak {todayChange.weak === 1 ? "result" : "results"}
            </span>
          </div>
        ) : null}

        {tab === "yesterday" ? (
          <>
            <div className="mb-4 pb-3 border-b border-white/10 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px]">
              <span className="text-[9px] uppercase tracking-[0.22em] text-white/50 font-semibold">
                {yesterdayShort}
              </span>
              <span className="text-white">
                <span className="font-semibold tabular-nums">{yesterday.length}</span>
                {" "}{yesterday.length === 1 ? "company" : "companies"} reported
              </span>
              {filedCount === 0 ? (
                <span className="ml-auto text-white/50 italic">
                  Today's filings expected post market
                </span>
              ) : null}
            </div>
            {/* Use the same TodayTableDark shape so layout stays identical
                — just no pending rows (everything already filed). */}
            <TodayTableDark
              reported={yesterday}
              pending={[]}
              nextUp={undefined}
              todayIso={yesterdayIso}
            />
          </>
        ) : tab === "today" ? (
          <TodayTableDark
            reported={lead ? [lead, ...others] : others}
            pending={pending}
            nextUp={nextUp}
            todayIso={todayIso}
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
function TodayTableDark({ reported, pending, nextUp, todayIso }: {
  reported: LatestQuarterRow[];
  pending: UpcomingItem[];
  nextUp: UpcomingItem | undefined;
  todayIso: string;
}) {
  // #4 Pending clarity — rough "when to expect" hint based on IST time.
  // BSE/NSE earnings typically land either before market open (pre 9:15)
  // or after market close (post 15:30). We show:
  //   - "Expected after market close" when IST < 15:30
  //   - "Filing expected any time now" when >= 15:30 (meetings often go
  //     late into the evening)
  const istHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false
    }).format(new Date())
  );
  const pendingHint = (u: UpcomingItem) => {
    if (u.next_result_date !== todayIso) return "Expected " + formatDate(u.next_result_date);
    if (istHour < 15) return "Expected today (post market)";
    return "Expected today (any time now)";
  };
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
            <span className="font-semibold tabular-nums truncate">
              {formatINR(r.revenue, { invalid: !!r.revenue_validation_issue })}
            </span>
            <DeltaChipDarkLabelled value={r.revenue_yoy} />
          </div>
          <div className="col-span-6 md:col-span-3 flex items-baseline gap-1.5 min-w-0">
            <span className="font-semibold tabular-nums truncate">
              {formatINR(r.net_profit, {
                invalid: !!r.net_profit_validation_issue,
                zeroLabel: "No profit reported",
              })}
            </span>
            <DeltaChipDarkLabelled value={r.profit_yoy} label={r.profit_yoy_label} />
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
          <div className="col-span-12 md:col-span-6 text-white/50 text-[12px] italic">
            {pendingHint(p)}
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
            {u.sector ?? "Data not available"}
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
            {r.sector ?? "Data not available"}
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
function DeltaChipDarkLabelled({
  value,
  label,
}: {
  value: number | null | undefined;
  label?: string | null;
}) {
  if (label) return <span className="text-[11px] text-white/70">{label}</span>;
  if (value == null) return <span className="text-[11px] text-white/40">Data not available</span>;
  return <DeltaChipDark value={value} />;
}
