"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import FreshnessIndicator from "@/components/FreshnessIndicator";
import EmptyState from "@/components/EmptyState";
import TabScroller from "@/components/TabScroller";
import FilingLoader from "@/components/FilingLoader";
import PdfLink from "@/components/PdfLink";
import PriceChip from "@/components/PriceChip";
import InfoTooltip from "@/components/InfoTooltip";
import { simplifyPurpose } from "@/lib/purpose";
import { formatINR, formatPct, formatDate, pctToneClass } from "@/lib/format";
import { DISCLAIMER_SHORT } from "@/lib/disclaimer";

type PriceMap = Record<
  string,
  { last_price: number | null; change_pct: number | null }
>;

interface Company {
  ticker: string; company_name: string; sector: string | null; industry: string | null;
  revenue: number | null; net_profit: number | null; operating_profit: number | null;
  eps: number | null; data_quality_status: any;
  revenue_yoy: number | null; profit_yoy: number | null;
  filing_url: string | null;
}
interface ScheduledCompany {
  ticker: string; company_name: string; sector: string | null; purpose: string | null;
}
interface DateGroup {
  date: string;
  kind: "reported" | "scheduled";
  companies: Company[] | ScheduledCompany[];
}
interface Payload {
  quarter: string;
  total_reported: number;
  total_scheduled?: number;
  dates: DateGroup[];
  undated: Company[];
}

// This page is scoped to the current reporting quarter only — it's a
// "track this quarter as it happens" view, not a history browser. If you
// need to browse older quarters, use the Dashboard's quarter dropdown.
const QUARTER = process.env.NEXT_PUBLIC_DEFAULT_QUARTER || "Q4 FY26";

export default function Q4Page() {
  const [data, setData] = useState<Payload | null>(null);
  const [prices, setPrices] = useState<PriceMap>({});
  const [err, setErr] = useState<string | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setErr(null);
    fetch(`/api/q4-announcements?quarter=${encodeURIComponent(QUARTER)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error);
        setData(j.data);
        // Default-active = most recent *reported* tab (readers care about
        // what just landed); fall back to the first upcoming date if no
        // company has reported yet.
        const reported: DateGroup[] = j.data.dates.filter((d: DateGroup) => d.kind === "reported");
        if (reported.length > 0) {
          setActiveDate(reported[reported.length - 1].date);
        } else if (j.data.dates.length > 0) {
          setActiveDate(j.data.dates[0].date);
        } else {
          setActiveDate(null);
        }
      })
      .catch((e) => setErr(String(e)));

    // Prices are a separate endpoint (same as homepage). We don't want
    // the price sidecar to block the main payload — if prices fail, the
    // table still renders without the price chip.
    fetch(`/api/prices`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.data?.prices) setPrices(j.data.prices);
      })
      .catch(() => { /* silent */ });
  }, []);

  // Back-compat for the rest of the template, which still references `quarter`.
  const quarter = QUARTER;

  // When the active date changes (default or user click), scroll the active
  // tab into the centre of the tab scroller. Keeps the selection visible
  // even when the rail has 30+ tabs.
  useEffect(() => {
    if (!activeDate) return;
    const btn = document.querySelector(
      `button[data-active="true"]`
    ) as HTMLElement | null;
    btn?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeDate]);

  const activeGroup = useMemo(
    () => data?.dates.find((d) => d.date === activeDate),
    [data, activeDate]
  );

  return (
    <div className="container-core py-8 space-y-6">
      {/* Heading */}
      <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b border-core-line pb-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-core-muted">Earnings tracker</div>
          <h1 className="serif text-4xl md:text-5xl leading-tight tracking-tight mt-1 flex items-baseline gap-2">
            <span>{quarter} announcements</span>
            <InfoTooltip text={DISCLAIMER_SHORT} />
          </h1>
          <p className="text-core-muted mt-2 max-w-2xl text-sm">
            Companies filing their {quarter} results, grouped by the day they announced.
            Pick a date below to see who reported then.
          </p>
        </div>
        <div className="flex items-baseline gap-6">
          <div className="serif text-3xl font-bold tabular-nums tracking-tightest">
            {data ? data.total_reported : "—"}
            <span className="block text-[10px] uppercase tracking-[0.14em] text-core-muted font-normal">reported</span>
          </div>
          <div className="serif text-3xl font-bold tabular-nums tracking-tightest text-core-muted">
            {data ? (data.total_scheduled ?? 0) : "—"}
            <span className="block text-[10px] uppercase tracking-[0.14em] text-core-muted font-normal">scheduled</span>
          </div>
        </div>
      </section>

      {err ? (
        <EmptyState title="Couldn't load" message={err} />
      ) : !data ? (
        <FilingLoader quarter={QUARTER} total={500} label="Reading filings" />
      ) : data.dates.length === 0 ? (
        <EmptyState
          title={`No ${quarter} results yet`}
          message="No company has announced this quarter yet. Results start landing once the quarter ends — usually a few days to weeks after."
        />
      ) : (
        <>
          {/* Date tabs — one chronological timeline from earliest past filing
              through today and into upcoming scheduled dates. Horizontal
              scroll has chevron controls + fade masks so nothing hides. */}
          <section className="border-b border-core-line">
            <TabScroller>
              {data.dates.map((g) => {
                const isActive = g.date === activeDate;
                const today = new Date().toISOString().slice(0, 10);
                const isToday = g.date === today;
                const isFuture = g.kind === "scheduled";
                return (
                  <button
                    key={`${g.kind}-${g.date}`}
                    data-active={isActive || undefined}
                    onClick={() => setActiveDate(g.date)}
                    className={`shrink-0 px-4 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap ${
                      isActive
                        ? "border-core-pink text-core-ink font-semibold"
                        : "border-transparent text-core-muted hover:text-core-ink"
                    }`}
                  >
                    <span className={isFuture ? "italic" : ""}>{formatDate(g.date)}</span>
                    {isToday ? (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-core-pink font-semibold">today</span>
                    ) : isFuture ? (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-core-muted">upcoming</span>
                    ) : null}
                    <span className="ml-2 text-[11px] text-core-muted tabular-nums">{g.companies.length}</span>
                  </button>
                );
              })}
            </TabScroller>
          </section>

          {/* Active group — two variants: "reported" shows the full filed
              numbers; "scheduled" shows the bare-bones list of upcoming
              filers (no financials, they haven't announced yet). */}
          {activeGroup ? (
            activeGroup.kind === "reported" ? (
              (() => {
                // Separate filed-with-numbers rows from "scheduled but filing
                // still pending" rows. The calendar puts a company on
                // DATE X because their board meeting was booked for that
                // day, but the formal XBRL filing is usually submitted
                // hours (sometimes a day or two) later. Showing both in
                // the same table with em-dashes made it look like a data
                // bug — instead, put filed rows on top and pending ones in
                // a clearly-labelled sub-section.
                const all = activeGroup.companies as Company[];
                const filed = all
                  .filter((c) => c.revenue != null || c.net_profit != null)
                  .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
                const pending = all
                  .filter((c) => c.revenue == null && c.net_profit == null)
                  .sort((a, b) => a.company_name.localeCompare(b.company_name));
                return (
              <section className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-xl font-bold tracking-tightest">
                    Results announced on {formatDate(activeGroup.date)}
                    <span className="ml-3 text-sm text-core-muted font-normal">
                      {filed.length} filed
                      {pending.length > 0 ? ` · ${pending.length} filing pending` : ""}
                    </span>
                  </h2>
                </div>
                {filed.length > 0 ? (
                  <div className="card overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Sector</th>
                          <th className="text-right">Revenue</th>
                          <th className="text-right">Rev YoY</th>
                          <th className="text-right">Net profit</th>
                          <th className="text-right">Profit YoY</th>
                          <th className="text-right">Op. profit</th>
                          <th className="text-right">EPS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filed.map((c) => (
                          <tr key={c.ticker}>
                            <td>
                              <Link href={`/company/${encodeURIComponent(c.ticker)}`} className="font-semibold hover:text-core-pink">
                                {c.company_name}
                              </Link>
                              <div className="text-[11px] text-core-muted flex items-center gap-2 flex-wrap">
                                <span>{c.ticker}</span>
                                <PdfLink url={c.filing_url} label="View filing" />
                                <PriceChip p={prices[c.ticker]} />
                              </div>
                            </td>
                            <td className="text-sm text-core-muted">{c.sector ?? "—"}</td>
                            <td className="text-right tabular-nums font-semibold">{formatINR(c.revenue)}</td>
                            <td className={`text-right tabular-nums font-semibold ${pctToneClass(c.revenue_yoy)}`}>{formatPct(c.revenue_yoy)}</td>
                            <td className="text-right tabular-nums font-semibold">{formatINR(c.net_profit)}</td>
                            <td className={`text-right tabular-nums font-semibold ${pctToneClass(c.profit_yoy)}`}>{formatPct(c.profit_yoy)}</td>
                            <td className="text-right tabular-nums">{formatINR(c.operating_profit)}</td>
                            <td className="text-right tabular-nums">{c.eps != null ? c.eps.toFixed(2) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {pending.length > 0 ? (
                  <div>
                    <div className="text-xs uppercase tracking-[0.14em] text-core-muted mb-2">
                      Filing pending · board meeting held, numbers not yet submitted
                    </div>
                    <div className="card overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Company</th>
                            <th>Sector</th>
                            <th className="text-right">Revenue</th>
                            <th className="text-right">Rev YoY</th>
                            <th className="text-right">Net profit</th>
                            <th className="text-right">Profit YoY</th>
                            <th className="text-right">Op. profit</th>
                            <th className="text-right">EPS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pending.map((c) => (
                            <tr key={c.ticker}>
                              <td>
                                <Link href={`/company/${encodeURIComponent(c.ticker)}`} className="font-semibold hover:text-core-pink">
                                  {c.company_name}
                                </Link>
                                <div className="text-[11px] text-core-muted flex items-center gap-2 flex-wrap">
                                  <span>{c.ticker}</span>
                                  <PdfLink url={c.filing_url} label="View filing" />
                                  <PriceChip p={prices[c.ticker]} />
                                </div>
                              </td>
                              <td className="text-sm text-core-muted">{c.sector ?? "—"}</td>
                              <td colSpan={6} className="text-left text-sm text-core-muted italic">
                                Awaiting filing · numbers will appear once published
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </section>
                );
              })()
            ) : (
              <section className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-xl font-bold tracking-tightest">
                    Results expected on {formatDate(activeGroup.date)}
                    <span className="ml-3 text-sm text-core-muted font-normal">
                      {activeGroup.companies.length} {activeGroup.companies.length === 1 ? "company" : "companies"} expected
                    </span>
                  </h2>
                </div>
                <div className="card overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Sector</th>
                        <th>Purpose</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeGroup.companies as ScheduledCompany[]).map((c) => (
                        <tr key={c.ticker}>
                          <td>
                            <Link href={`/company/${encodeURIComponent(c.ticker)}`} className="font-semibold hover:text-core-pink">
                              {c.company_name}
                            </Link>
                            <div className="text-[11px] text-core-muted flex items-center gap-2 flex-wrap">
                              <span>{c.ticker}</span>
                              <PriceChip p={prices[c.ticker]} />
                            </div>
                          </td>
                          <td className="text-sm text-core-muted">{c.sector ?? "—"}</td>
                          <td className="text-sm text-core-ink max-w-[480px]" title={c.purpose ?? undefined}>
                            {simplifyPurpose(c.purpose, activeGroup.date)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          ) : null}

          {/* Undated stragglers */}
          {data.undated.length > 0 ? (
            <section className="mt-8">
              <div className="text-xs uppercase tracking-wide text-core-muted mb-2">
                {data.undated.length} without a confirmed announcement date
              </div>
              <div className="card p-4 text-sm text-core-muted">
                {data.undated.slice(0, 20).map((c, i) => (
                  <span key={c.ticker}>
                    {i > 0 ? " · " : ""}
                    <Link href={`/company/${encodeURIComponent(c.ticker)}`} className="hover:text-core-ink">
                      {c.company_name}
                    </Link>
                  </span>
                ))}
                {data.undated.length > 20 ? <span> · +{data.undated.length - 20} more</span> : null}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
