"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import FeaturedHeroCard from "@/components/FeaturedHeroCard";
import FeaturedCard from "@/components/FeaturedCard";
import CompanyTable from "@/components/CompanyTable";
import SectorComparison from "@/components/SectorComparison";
import TrendChart from "@/components/TrendChart";
import CompanySearch from "@/components/CompanySearch";
import FreshnessIndicator from "@/components/FreshnessIndicator";
import EmptyState from "@/components/EmptyState";
import { formatDate, formatPct, pctToneClass } from "@/lib/format";
import type { LatestQuarterRow } from "@/lib/types";

const DEFAULT_QUARTER = process.env.NEXT_PUBLIC_DEFAULT_QUARTER || "Q4 FY26";

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

export default function DashboardPage() {
  const [quarter, setQuarter] = useState<string>(DEFAULT_QUARTER);
  const [availableQuarters, setAvailableQuarters] = useState<string[]>([DEFAULT_QUARTER]);
  const [board, setBoard] = useState<DashboardResp | null>(null);
  const [summary, setSummary] = useState<SummaryResp | null>(null);
  const [sectors, setSectors] = useState<SectorResp | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [error, setError] = useState<string | null>(null);

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
            <div className="mt-6 flex items-baseline gap-3">
              <span className="text-2xl md:text-3xl font-bold tabular-nums tracking-tightest">
                {reportedCount}
              </span>
              <span className="text-core-muted-2 text-lg md:text-xl font-semibold tabular-nums">
                of {trackedTotal}
              </span>
              <span className="text-[11px] uppercase tracking-[0.14em] text-core-muted">filed</span>
            </div>
            <div className="mt-3 max-w-md">
              <div
                className="h-[5px] rounded-full bg-core-line overflow-hidden"
                role="progressbar"
                aria-valuenow={reportedCount}
                aria-valuemax={trackedTotal}
              >
                <div
                  className="h-full bg-core-ink transition-all duration-700"
                  style={{ width: `${(progress * 100).toFixed(1)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-core-muted tabular-nums">
                <span>{(progress * 100).toFixed(0)}% of the NIFTY 500</span>
                <span>{trackedTotal - reportedCount} to go</span>
              </div>
            </div>
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

      {/* Prominent search — placed right after the hero so finding a
          specific company is the most obvious action. Auto-completes from
          the NIFTY 500 and can pull fresh results on demand. */}
      <section className="mt-6 md:mt-8">
        <CompanySearch />
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
          ALL REPORTERS TABLE
          ================================================================= */}
      {rest.length > 0 ? (
        <section className="mt-12">
          <header className="flex items-baseline justify-between mb-3">
            <h2 className="text-xl font-bold tracking-tightest">All reporters</h2>
            <Link href={`/q4?quarter=${encodeURIComponent(quarter)}`} className="text-xs link-pink">
              Grouped by date →
            </Link>
          </header>
          <CompanyTable rows={rest.slice(0, 50)} />
          {rest.length > 50 ? (
            <div className="text-xs text-core-muted mt-2 text-right">
              Showing top 50 by revenue.
            </div>
          ) : null}
        </section>
      ) : null}

      {/* =================================================================
          ANALYTICAL — charts in a 3-column layout with Coming Up on the side
          ================================================================= */}
      <section className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-4">
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
        <div className="card p-5">
          <header className="flex items-baseline justify-between mb-4">
            <h3 className="text-lg font-semibold tracking-tightest">Coming up · 7 days</h3>
            <Link href="/upcoming" className="text-xs link-pink">All →</Link>
          </header>
          <UpcomingList items={upcoming} days={7} />
        </div>
      </section>

      <section className="mt-12"><GainersLaggards quarter={quarter} /></section>

      <div className="h-16" />
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
