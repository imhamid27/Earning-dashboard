"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import EmptyState from "@/components/EmptyState";
import TabScroller from "@/components/TabScroller";
import FilingLoader from "@/components/FilingLoader";
import PdfLink from "@/components/PdfLink";
import PriceChip from "@/components/PriceChip";
import InfoTooltip from "@/components/InfoTooltip";
import JsonLd from "@/components/JsonLd";
import { simplifyPurpose } from "@/lib/purpose";
import { formatINR, formatYoY, formatDate, pctToneClass } from "@/lib/format";
import { DISCLAIMER_SHORT } from "@/lib/disclaimer";
import { siteUrl } from "@/lib/site";

type PriceMap = Record<string, { last_price: number | null; change_pct: number | null }>;
interface Company {
  ticker: string; company_name: string; sector: string | null; industry: string | null;
  revenue: number | null; net_profit: number | null; operating_profit: number | null;
  eps: number | null; data_quality_status: any;
  revenue_yoy: number | null; profit_yoy: number | null; filing_url: string | null;
}
interface ScheduledCompany {
  ticker: string; company_name: string; sector: string | null; purpose: string | null;
}
interface DateGroup {
  date: string; kind: "reported" | "scheduled";
  companies: Company[] | ScheduledCompany[];
}
interface Payload {
  quarter: string; total_reported: number; total_scheduled?: number;
  dates: DateGroup[]; undated: Company[];
}

function slugToLabel(slug: string): string {
  return decodeURIComponent(slug).replace(/-/g, " ");
}
function labelToSlug(label: string): string {
  return label.replace(/ /g, "-");
}

const BASE = siteUrl();

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const quarter = slugToLabel(params.quarter as string);

  const [data, setData] = useState<Payload | null>(null);
  const [prices, setPrices] = useState<PriceMap>({});
  const [err, setErr] = useState<string | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [availableQuarters, setAvailableQuarters] = useState<string[]>([]);

  // Load the quarter list for the picker.
  useEffect(() => {
    fetch("/api/quarters?v=2")
      .then((r) => r.json())
      .then((j) => { if (j.ok && j.data?.length) setAvailableQuarters(j.data); })
      .catch(() => {});
  }, []);

  // Fetch announcements whenever the URL quarter changes.
  useEffect(() => {
    setData(null); setErr(null); setActiveDate(null);
    fetch(`/api/q4-announcements?quarter=${encodeURIComponent(quarter)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error);
        setData(j.data);
        const reported: DateGroup[] = j.data.dates.filter((d: DateGroup) => d.kind === "reported");
        if (reported.length > 0) setActiveDate(reported[reported.length - 1].date);
        else if (j.data.dates.length > 0) setActiveDate(j.data.dates[0].date);
      })
      .catch((e) => setErr(String(e)));
  }, [quarter]);

  // Prices — fetched once.
  useEffect(() => {
    fetch("/api/prices").then((r) => r.json())
      .then((j) => { if (j.ok && j.data?.prices) setPrices(j.data.prices); })
      .catch(() => {});
  }, []);

  // Scroll active date tab into view.
  useEffect(() => {
    if (!activeDate) return;
    const btn = document.querySelector(`button[data-active="true"]`) as HTMLElement | null;
    btn?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeDate]);

  const activeGroup = useMemo(
    () => data?.dates.find((d) => d.date === activeDate),
    [data, activeDate]
  );

  const breadcrumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Dashboard", item: `${BASE}/` },
      { "@type": "ListItem", position: 2, name: `${quarter} announcements`, item: `${BASE}/results/${labelToSlug(quarter)}` },
    ],
  };

  return (
    <div className="container-core py-8 space-y-6">
      <JsonLd data={breadcrumbLd} />

      <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b border-core-line pb-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-core-muted">Earnings tracker</div>
          <h1 className="serif text-4xl md:text-5xl leading-tight tracking-tight mt-1">
            {quarter} Announcements
            <span className="inline-block align-middle ml-2 -translate-y-1">
              <InfoTooltip text={DISCLAIMER_SHORT} size="md" />
            </span>
          </h1>
          <p className="text-core-muted mt-2 max-w-2xl text-sm">
            Live NSE and BSE quarterly results calendar — every {quarter} filing, grouped
            by the day it was announced. Pick a date below for the quarterly results
            announced on that day, with revenue, net profit and YoY growth.
          </p>
          {/* Quarter switcher — each pill navigates to that quarter's own URL */}
          {availableQuarters.length > 1 && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {availableQuarters.map((q) => (
                <button
                  key={q}
                  onClick={() => router.push(`/results/${labelToSlug(q)}`)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    q === quarter
                      ? "border-core-pink bg-core-pink/10 text-core-pink font-semibold"
                      : "border-core-line text-core-muted hover:border-core-ink hover:text-core-ink"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-baseline gap-6">
          <div className="text-3xl font-extrabold tabular-nums tracking-tightest">
            {data ? data.total_reported : "—"}
            <span className="block text-[10px] uppercase tracking-[0.14em] text-core-muted font-normal">reported</span>
          </div>
          <div className="text-3xl font-extrabold tabular-nums tracking-tightest text-core-muted">
            {data ? (data.total_scheduled ?? 0) : "—"}
            <span className="block text-[10px] uppercase tracking-[0.14em] text-core-muted font-normal">scheduled</span>
          </div>
        </div>
      </section>

      {err ? (
        <EmptyState title="Couldn't load" message={err} />
      ) : !data ? (
        <FilingLoader quarter={quarter} total={500} label="Reading filings" />
      ) : data.dates.length === 0 ? (
        <EmptyState
          title={`No ${quarter} results yet`}
          message="No company has announced this quarter yet. Results start landing once the quarter ends."
        />
      ) : (
        <>
          <header className="pt-2">
            <h2 className="text-lg md:text-xl font-bold tracking-tightest leading-snug">
              Quarterly results today, by date
            </h2>
            <p className="mt-1 text-[12px] text-core-muted">
              Pick a day to see every NSE and BSE quarterly result filed on that date.
            </p>
          </header>

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

          {activeGroup ? (
            activeGroup.kind === "reported" ? (
              (() => {
                const all = activeGroup.companies as Company[];
                const filed = all
                  .filter((c) => c.revenue != null || c.net_profit != null)
                  .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
                const pending = all
                  .filter((c) => c.revenue == null && c.net_profit == null)
                  .sort((a, b) => a.company_name.localeCompare(b.company_name));
                return (
                  <section className="space-y-3">
                    <div>
                      <h2 className="text-xl font-bold tracking-tightest leading-snug">
                        Quarterly results announced on {formatDate(activeGroup.date)}
                        <span className="text-core-muted font-semibold"> · NSE & BSE</span>
                      </h2>
                      <div className="mt-1 text-sm text-core-muted">
                        <span className="tabular-nums font-semibold text-core-ink">{filed.length}</span> filed
                        {pending.length > 0 && (
                          <> · <span className="tabular-nums font-semibold text-core-ink">{pending.length}</span> filing pending</>
                        )}
                      </div>
                    </div>
                    {filed.length > 0 && (
                      <div className="card overflow-x-auto">
                        <table className="data-table" style={{ minWidth: "680px" }}>
                          <thead>
                            <tr>
                              <th>Company</th>
                              <th className="hidden sm:table-cell">Sector</th>
                              <th className="text-right">Revenue</th>
                              <th className="text-right hidden sm:table-cell">Rev YoY</th>
                              <th className="text-right">Net profit</th>
                              <th className="text-right">Profit YoY</th>
                              <th className="text-right hidden sm:table-cell">Op. profit</th>
                              <th className="text-right hidden sm:table-cell">EPS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filed.map((c) => (
                              <tr key={c.ticker}>
                                <td>
                                  <Link href={`/company/${encodeURIComponent(c.ticker)}`} className="font-semibold hover:text-core-pink whitespace-nowrap">
                                    {c.company_name}
                                  </Link>
                                  <div className="text-[11px] text-core-muted flex items-center gap-2 flex-wrap">
                                    <span>{c.ticker}</span>
                                    <PdfLink url={c.filing_url} label="View filing" ticker={c.ticker} companyName={c.company_name} source="results_page" />
                                    <PriceChip p={prices[c.ticker]} />
                                  </div>
                                </td>
                                <td className="hidden sm:table-cell text-sm text-core-muted">{c.sector ?? "—"}</td>
                                <td className="text-right tabular-nums font-semibold">{formatINR(c.revenue)}</td>
                                <td className={`hidden sm:table-cell text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(c.revenue_yoy)}`}>{formatYoY(c.revenue_yoy)}</td>
                                <td className="text-right tabular-nums font-semibold">{formatINR(c.net_profit)}</td>
                                <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(c.profit_yoy)}`}>{formatYoY(c.profit_yoy)}</td>
                                <td className="hidden sm:table-cell text-right tabular-nums">{formatINR(c.operating_profit)}</td>
                                <td className="hidden sm:table-cell text-right tabular-nums">{c.eps != null ? c.eps.toFixed(2) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {pending.length > 0 && (
                      <div>
                        <div className="text-xs uppercase tracking-[0.14em] text-core-muted mb-2">
                          Filing pending · board meeting held, numbers not yet submitted
                        </div>
                        <div className="card divide-y divide-core-line">
                          {pending.map((c) => (
                            <div key={c.ticker} className="px-4 md:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-2">
                              <div className="flex-1 min-w-0">
                                <Link href={`/company/${encodeURIComponent(c.ticker)}`} className="font-semibold text-core-ink hover:text-core-pink block truncate">
                                  {c.company_name}
                                </Link>
                                <div className="text-[11px] text-core-muted flex items-center gap-2 flex-wrap mt-0.5">
                                  <span>{c.ticker}</span>
                                  {c.sector && <><span className="text-core-line-2">·</span><span>{c.sector}</span></>}
                                  <PriceChip p={prices[c.ticker]} />
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-[11px] text-core-muted italic">Awaiting filing</span>
                                <PdfLink url={c.filing_url} label="View filing" ticker={c.ticker} companyName={c.company_name} source="results_page" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                );
              })()
            ) : (
              <section className="space-y-3">
                <h2 className="text-xl font-bold tracking-tightest">
                  Results expected on {formatDate(activeGroup.date)}
                  <span className="ml-3 text-sm text-core-muted font-normal">
                    {activeGroup.companies.length} {activeGroup.companies.length === 1 ? "company" : "companies"} expected
                  </span>
                </h2>
                <div className="card overflow-x-auto">
                  <table className="data-table" style={{ minWidth: "420px" }}>
                    <thead><tr><th>Company</th><th className="hidden sm:table-cell">Sector</th><th>Purpose</th></tr></thead>
                    <tbody>
                      {(activeGroup.companies as ScheduledCompany[]).map((c) => (
                        <tr key={c.ticker}>
                          <td>
                            <Link href={`/company/${encodeURIComponent(c.ticker)}`} className="font-semibold hover:text-core-pink whitespace-nowrap">
                              {c.company_name}
                            </Link>
                            <div className="text-[11px] text-core-muted flex items-center gap-2 flex-wrap">
                              <span>{c.ticker}</span>
                              <PriceChip p={prices[c.ticker]} />
                            </div>
                          </td>
                          <td className="hidden sm:table-cell text-sm text-core-muted">{c.sector ?? "—"}</td>
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

          {data.undated.length > 0 && (
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
                {data.undated.length > 20 && <span> · +{data.undated.length - 20} more</span>}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
