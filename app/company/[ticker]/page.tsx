"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import TrendChart from "@/components/TrendChart";
import FreshnessIndicator from "@/components/FreshnessIndicator";
import EmptyState from "@/components/EmptyState";
import PdfLink from "@/components/PdfLink";
import InfoTooltip from "@/components/InfoTooltip";
import JsonLd from "@/components/JsonLd";
import { formatINR, formatPct, formatYoY, formatDate, pctToneClass } from "@/lib/format";
import { DISCLAIMER_SHORT, DISCLAIMER_PRICE } from "@/lib/disclaimer";
import { trackCompanyView } from "@/lib/analytics";
import { siteUrl } from "@/lib/site";

interface DetailResp {
  company: {
    id: string; company_name: string; ticker: string; exchange: string;
    sector: string | null; industry: string | null; isin: string | null;
    market_cap_bucket: string | null; next_result_date: string | null;
    bse_scrip?: string | null;
  };
  quarters: Array<{
    id: string; ticker: string; quarter_label: string; quarter_end_date: string;
    fiscal_year: number; fiscal_quarter: number;
    revenue: number | null; net_profit: number | null; operating_profit: number | null;
    eps: number | null; currency: string; data_quality_status: any;
    fetched_at: string;
    revenue_qoq: number | null; revenue_yoy: number | null;
    profit_qoq: number | null; profit_yoy: number | null;
    filing_url: string | null;
  }>;
  latest_filing_url?: string | null;
}

type PriceInfo = {
  last_price: number | null; previous_close: number | null;
  change_pct: number | null; day_high: number | null; day_low: number | null;
  volume: number | null; updated_at: string;
};

// Resolved once at module load — avoids re-calling siteUrl() on every render.
const COMPANY_BASE = siteUrl();

export default function CompanyDetail() {
  const params = useParams<{ ticker: string }>();
  const ticker = decodeURIComponent(params.ticker);
  const [data, setData] = useState<DetailResp | null>(null);
  const [price, setPrice] = useState<PriceInfo | null>(null);
  const [priceStatus, setPriceStatus] = useState<"open" | "closed" | "stale" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ── AEO structured data ────────────────────────────────────────────────
  // BreadcrumbList is stable once `data` arrives and never changes after
  // that, so useMemo is the right hook. The schema renders as a <script>
  // tag in the JSX — Google parses ld+json from anywhere in the HTML body,
  // so client-component pages don't need a special server wrapper for this.
  const BASE = COMPANY_BASE;
  const companyJsonLd = useMemo(() => {
    if (!data) return null;
    const co = data.company;
    const latest = data.quarters[data.quarters.length - 1];
    const companyUrl = `${BASE}/company/${encodeURIComponent(ticker)}`;

    const breadcrumb = {
      "@type": "BreadcrumbList",
      "@id": `${companyUrl}#breadcrumb`,
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Dashboard", "item": `${BASE}/` },
        ...(co.sector ? [{
          "@type": "ListItem", "position": 2, "name": co.sector, "item": `${BASE}/sectors`
        }] : []),
        {
          "@type": "ListItem",
          "position": co.sector ? 3 : 2,
          "name": co.company_name,
          "item": companyUrl
        }
      ]
    };

    const corporation = {
      "@type": "Corporation",
      "@id": `${companyUrl}#company`,
      "name": co.company_name,
      "tickerSymbol": ticker.replace(/\.(NS|BO)$/, ""),
      "exchange": co.exchange,
      ...(co.isin ? { "identifier": co.isin } : {}),
      ...(co.sector ? { "industry": co.sector } : {}),
      ...(co.industry ? { "description": co.industry } : {})
    };

    // Describe the financial data as a Dataset so AI engines can surface
    // the latest numbers directly in answers.
    const dataset = latest ? {
      "@type": "Dataset",
      "name": `${co.company_name} — ${latest.quarter_label} Results`,
      "description": `${co.company_name} (${ticker}) reported revenue of ${formatINR(latest.revenue)} and net profit of ${formatINR(latest.net_profit)} for ${latest.quarter_label}.`,
      "url": companyUrl,
      "temporalCoverage": latest.quarter_end_date,
      "creator": { "@id": `${BASE}/#organization` },
      "about": { "@id": `${companyUrl}#company` },
      "variableMeasured": [
        ...(latest.revenue != null ? [{
          "@type": "PropertyValue",
          "name": "Revenue",
          "value": (latest.revenue / 1e7).toFixed(2),
          "unitText": "Crore INR",
          "measurementTechnique": "NSE/BSE quarterly filing"
        }] : []),
        ...(latest.net_profit != null ? [{
          "@type": "PropertyValue",
          "name": "Net Profit",
          "value": (latest.net_profit / 1e7).toFixed(2),
          "unitText": "Crore INR",
          "measurementTechnique": "NSE/BSE quarterly filing"
        }] : []),
        ...(latest.eps != null ? [{
          "@type": "PropertyValue",
          "name": "EPS",
          "value": latest.eps.toFixed(2),
          "unitText": "INR per share"
        }] : [])
      ]
    } : null;

    return {
      "@context": "https://schema.org",
      "@graph": [breadcrumb, corporation, ...(dataset ? [dataset] : [])]
    };
  }, [data, ticker, BASE]);
  // ──────────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/companies/${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setData(j.data);
          // Fire a structured GA4 view_item event with ticker + sector.
          // Complements the automatic page_view so you can see "top viewed
          // companies" and "most-looked-at sectors" in GA4 reports.
          trackCompanyView({
            ticker: j.data.company.ticker,
            company_name: j.data.company.company_name,
            sector: j.data.company.sector,
          });
        } else {
          setErr(j.error);
        }
      })
      .catch((e) => setErr(String(e)));
    fetch(`/api/prices?tickers=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setPrice(j.data.prices?.[ticker] ?? null);
          setPriceStatus(j.data.market_status ?? null);
        }
      })
      .catch(() => {});
  }, [ticker]);

  if (err) return (
    <div className="container-core py-10">
      <EmptyState title="Company not found" message={err} cta={<Link href="/" className="link-pink text-sm">← Back to dashboard</Link>} />
    </div>
  );
  if (!data) return (
    <div className="container-core py-10"><div className="card p-8 text-sm text-core-muted">Loading…</div></div>
  );

  const latest = data.quarters[data.quarters.length - 1];
  const prevY  = data.quarters.length >= 5 ? data.quarters[data.quarters.length - 5] : null;

  return (
    <div className="container-core py-8 md:py-12 space-y-10">
      {/* AEO: BreadcrumbList + Corporation + Dataset schemas.
          Rendered as part of the initial HTML so Google + AI answer engines
          see the structured data without needing to execute additional JS. */}
      {companyJsonLd && <JsonLd data={companyJsonLd} />}

      {/* Breadcrumb — flex-wrap prevents long sector/industry names from
          causing horizontal overflow on narrow mobile viewports. */}
      <div className="text-[11px] uppercase tracking-[0.14em] text-core-muted flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link href="/" className="hover:text-core-pink shrink-0">Dashboard</Link>
        <span className="text-core-line-2 shrink-0">/</span>
        <span className="truncate max-w-[180px] sm:max-w-none">{data.company.sector ?? "—"}</span>
        {data.company.industry ? (
          <><span className="text-core-line-2 shrink-0">/</span>
          <span className="truncate max-w-[180px] sm:max-w-none">{data.company.industry}</span></>
        ) : null}
      </div>

      {/* Editorial header */}
      <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b border-core-line pb-6">
        <div className="min-w-0">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tightest leading-[1.05]">
            {data.company.company_name}
            <span className="inline-block align-middle ml-2 -translate-y-0.5">
              <InfoTooltip text={DISCLAIMER_SHORT} size="md" />
            </span>
          </h1>
          <div className="text-sm text-core-muted mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-core-ink tabular-nums">{data.company.ticker}</span>
            <span className="text-core-line-2">·</span><span>{data.company.exchange}</span>
            {data.company.industry ? (<><span className="text-core-line-2">·</span><span>{data.company.industry}</span></>) : null}
            {data.company.isin ? (<><span className="text-core-line-2">·</span><span className="tabular-nums">ISIN {data.company.isin}</span></>) : null}
            {data.company.market_cap_bucket ? (<><span className="text-core-line-2">·</span><span>{data.company.market_cap_bucket} cap</span></>) : null}
            {data.company.bse_scrip ? (<><span className="text-core-line-2">·</span><span className="tabular-nums">BSE {data.company.bse_scrip}</span></>) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {data.company.next_result_date ? (
              <span className="chip chip-pink">Next results {formatDate(data.company.next_result_date)}</span>
            ) : null}
            {data.latest_filing_url ? (
              <PdfLink
                url={data.latest_filing_url}
                label="Latest filing"
                ticker={data.company.ticker}
                companyName={data.company.company_name}
                source="company_detail"
              />
            ) : null}
          </div>
        </div>
        {latest ? <FreshnessIndicator fetchedAt={latest.fetched_at} /> : null}
      </section>

      {/* Trading price card — always visible if we have a price, regardless
          of whether quarterly data exists. Separates "what the market thinks
          right now" from "what the company last reported". */}
      {price && price.last_price != null ? (
        <section className="card p-5 md:p-6">
          {/* Row 1: label + LIVE/CLOSED badge. Always on its own line — a
              clean header slug that the big price hangs off. */}
          <div className="text-[11px] uppercase tracking-[0.16em] text-core-ink font-bold flex items-center gap-2">
            Trading price
            {priceStatus === "open" ? (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold tracking-[0.15em] text-core-teal">
                <span className="w-1 h-1 rounded-full bg-core-teal animate-pulse" />
                LIVE
              </span>
            ) : priceStatus === "closed" ? (
              <span className="text-[9px] font-bold tracking-[0.15em] text-core-muted">CLOSED</span>
            ) : null}
          </div>

          {/* Row 2: the headline price and the 3 sub-stats. Stacks
              vertically on mobile; puts the stats on the right on
              desktop. Grid-based (not flex) so the stats columns never
              overlap each other at any viewport width. */}
          <div className="mt-3 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5 md:gap-8 md:items-end">
            <div className="min-w-0">
              <div className="flex items-baseline gap-3 flex-wrap">
                <div className="text-3xl md:text-4xl font-bold tabular-nums tracking-tightest leading-none">
                  ₹{price.last_price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                {price.change_pct != null ? (
                  <div className={`text-lg font-semibold tabular-nums leading-none ${price.change_pct >= 0 ? "text-core-teal" : "text-core-negative"}`}>
                    {price.change_pct >= 0 ? "+" : ""}
                    {(price.change_pct * 100).toFixed(2)}%
                  </div>
                ) : null}
              </div>
              {price.previous_close != null ? (
                <div className="mt-2 text-[11px] text-core-muted tabular-nums">
                  vs previous close ₹{price.previous_close.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs md:justify-self-end">
              <PriceStat
                label="Day high"
                value={price.day_high != null
                  ? `₹${price.day_high.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "—"}
              />
              <PriceStat
                label="Day low"
                value={price.day_low != null
                  ? `₹${price.day_low.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "—"}
              />
              <PriceStat
                label="Volume"
                value={price.volume != null ? formatVolume(price.volume) : "—"}
              />
            </div>
          </div>

          {/* Row 3: disclaimer — ALWAYS on its own line below the grid.
              The old layout tried to squeeze it into the flex row which
              made the text overlap the sub-stats at awkward widths. */}
          <div className="mt-5 pt-3 border-t border-core-line text-[11px] leading-relaxed text-core-muted italic">
            {DISCLAIMER_PRICE}
          </div>
        </section>
      ) : null}

      {data.quarters.length === 0 ? (
        <EmptyState
          title="No quarterly data for this company yet"
          message="Run the ingestion script to pull historical financials."
        />
      ) : (
        <>
          {/* KPI row — hairline-separated cells (matches homepage) */}
          <section className="grid grid-cols-2 md:grid-cols-4 divide-x divide-core-line border-y border-core-line">
            <KPI label="Latest quarter" value={latest!.quarter_label} sub={formatDate(latest!.quarter_end_date)} />
            <KPI
              label="Revenue"
              value={formatINR(latest!.revenue)}
              sub={
                <span className={`${pctToneClass(latest!.revenue_yoy)} font-semibold`}>
                  {formatYoY(latest!.revenue_yoy)} YoY
                </span>
              }
            />
            <KPI
              label="Net profit"
              value={formatINR(latest!.net_profit)}
              sub={
                <span className={`${pctToneClass(latest!.profit_yoy)} font-semibold`}>
                  {formatYoY(latest!.profit_yoy)} YoY
                </span>
              }
            />
            <KPI
              label="EPS"
              value={latest!.eps != null ? `₹${latest!.eps.toFixed(2)}` : "—"}
              sub={prevY ? `vs ${prevY.quarter_label}` : undefined}
            />
          </section>

          {/* About this company — compact metadata card. Kept deliberately
              factual + verifiable: what we can source from exchange filings,
              not marketing blurbs. A future enrichment pass will add a
              one-paragraph business summary from yfinance (committed in a
              follow-up migration). */}
          <section className="card p-5">
            <h3 className="text-sm font-bold tracking-tightest mb-3 text-core-ink uppercase">
              About
            </h3>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
              <AboutField label="Exchange" value={data.company.exchange} />
              <AboutField label="Sector" value={data.company.sector} />
              <AboutField label="Industry" value={data.company.industry} />
              <AboutField label="Market cap" value={data.company.market_cap_bucket} />
              <AboutField label="ISIN" value={data.company.isin} mono />
              <AboutField
                label="NSE symbol"
                value={data.company.ticker.endsWith(".NS") ? data.company.ticker.replace(".NS", "") : null}
                mono
              />
              <AboutField label="BSE scrip" value={data.company.bse_scrip ?? null} mono />
              <AboutField
                label="Next results"
                value={data.company.next_result_date ? formatDate(data.company.next_result_date) : null}
              />
            </dl>
          </section>

          {/* Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-5">
              <header className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold tracking-tightest">Revenue by quarter</h3>
                <span className="text-[11px] uppercase tracking-wide text-core-muted">Last {data.quarters.length}</span>
              </header>
              <TrendChart rows={data.quarters} metric="revenue" height={280} />
            </div>
            <div className="card p-5">
              <header className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold tracking-tightest">Net profit by quarter</h3>
                <span className="text-[11px] uppercase tracking-wide text-core-muted">Last {data.quarters.length}</span>
              </header>
              <TrendChart rows={data.quarters} metric="net_profit" height={280} />
            </div>
          </section>

          {/* Quarterly table */}
          <section>
            <header className="flex items-baseline justify-between mb-3">
              <h2 className="text-xl font-bold tracking-tightest">Quarter-by-Quarter</h2>
              <span className="text-[11px] uppercase tracking-wide text-core-muted">
                {data.quarters.length} quarters
              </span>
            </header>
            <div className="card overflow-x-auto">
              <table className="data-table" style={{ minWidth: "780px" }}>
                <thead>
                  <tr>
                    <th>Quarter</th>
                    <th className="hidden sm:table-cell">Period end</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right hidden sm:table-cell">QoQ</th>
                    <th className="text-right">YoY</th>
                    <th className="text-right">Net profit</th>
                    <th className="text-right">Profit YoY</th>
                    <th className="text-right hidden sm:table-cell">Op. profit</th>
                    <th className="text-right hidden sm:table-cell">EPS</th>
                    <th className="text-right">Filing</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.quarters].reverse().map((q) => (
                    <tr key={q.id}>
                      <td className="font-semibold tabular-nums">{q.quarter_label}</td>
                      <td className="hidden sm:table-cell text-sm text-core-muted tabular-nums">{formatDate(q.quarter_end_date)}</td>
                      <td className="text-right tabular-nums font-semibold">{formatINR(q.revenue)}</td>
                      <td className={`hidden sm:table-cell text-right tabular-nums whitespace-nowrap ${pctToneClass(q.revenue_qoq)}`}>{formatYoY(q.revenue_qoq)}</td>
                      <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(q.revenue_yoy)}`}>{formatYoY(q.revenue_yoy)}</td>
                      <td className="text-right tabular-nums font-semibold">{formatINR(q.net_profit)}</td>
                      <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(q.profit_yoy)}`}>{formatYoY(q.profit_yoy)}</td>
                      <td className="hidden sm:table-cell text-right tabular-nums">{formatINR(q.operating_profit)}</td>
                      <td className="hidden sm:table-cell text-right tabular-nums">{q.eps != null ? q.eps.toFixed(2) : "—"}</td>
                      <td className="text-right">
                        <PdfLink
                          url={q.filing_url}
                          compact
                          ticker={data.company.ticker}
                          companyName={data.company.company_name}
                          source="company_quarters_table"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Footnote — last refresh timestamp only. */}
          <section className="text-[11px] text-core-muted pt-2 border-t border-core-line">
            Last updated {formatDate(latest?.fetched_at ?? null)}.
          </section>
        </>
      )}
    </div>
  );
}

function KPI({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="px-5 py-4 md:px-6 md:py-5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted">{label}</div>
      <div className="mt-2 text-2xl md:text-3xl font-bold tabular-nums tracking-tightest leading-none">
        {value}
      </div>
      {sub ? <div className="mt-2 text-[11px]">{sub}</div> : null}
    </div>
  );
}

// One of the three stats (high / low / volume) shown beside the trading
// price. Tight label + value, tabular-nums so they align vertically
// across rows regardless of digit count.
function PriceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-right">
      <div className="text-[9px] uppercase tracking-[0.14em] text-core-muted whitespace-nowrap">
        {label}
      </div>
      <div className="mt-1 tabular-nums font-semibold text-sm whitespace-nowrap">
        {value}
      </div>
    </div>
  );
}

function formatVolume(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)} L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)} K`;
  return String(v);
}

function AboutField({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-core-muted">{label}</dt>
      <dd className={`mt-0.5 text-sm text-core-ink font-medium ${mono ? "tabular-nums" : ""} truncate`}>
        {value && value.trim().length > 0 ? value : "—"}
      </dd>
    </div>
  );
}
