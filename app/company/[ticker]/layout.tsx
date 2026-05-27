// Server-side wrapper for /company/[ticker]. The page itself is a client
// component (charts, live price polling), so dynamic metadata + page-level
// JSON-LD live here in the server layout.
//
// Goals:
//   • Per-ticker <title> and <meta description> targeting "{TICKER} Q4 FY26
//     results", "{Company} earnings" — matches the queries readers run.
//   • Canonical URL anchored to /company/{ticker}.
//   • Per-page JSON-LD: BreadcrumbList + Corporation + (when data available)
//     FinancialProduct/Article schemas. The client page emits a richer
//     Dataset block once data resolves; this layout's schema is the
//     server-rendered baseline that crawlers see on first byte.
//   • FAQPage with answers to the 4 most common ticker-level queries.

import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase";
import {
  ACTIVE_QUARTER,
  cleanCompanyName,
  canonical,
  buildBreadcrumbLd,
  SOCIAL_CARD_DEFAULTS,
} from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import JsonLd from "@/components/JsonLd";
import FaqBlock from "@/components/FaqBlock";
import Glossary from "@/components/Glossary";

// Set a 5-minute ISR window. NB: in practice Next can't honour this when
// generateMetadata uses supabase-js (raw transport, not Next's memoized
// fetch), so it keeps emitting `Cache-Control: no-cache` on responses.
// The actual CDN cache header is set by middleware.ts which catches
// /company/* and overrides Cache-Control to the LONG cache tier. We keep
// `revalidate = 300` as a defensive hint — harmless when middleware does
// its job, useful if a future Next version starts respecting the value.
export const revalidate = 300;

interface CompanyMeta {
  ticker: string;
  company_name: string;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  isin: string | null;
}

interface LatestQuarter {
  quarter_label: string;
  quarter_end_date: string;
  revenue: number | null;
  net_profit: number | null;
  operating_profit: number | null;
  eps: number | null;
}

// Lightweight company + latest-quarter lookup. Runs the two queries in
// parallel so the layout adds at most ~80ms of DB latency on top of
// whatever else generateMetadata does.
//
// Why we need the latest quarter HERE (in the server layout) and not
// just inside the client page: GSC's "Duplicate without user-selected
// canonical" report flagged 42 company pages as duplicates of each
// other. Cause: at SSR time, every /company/[ticker] page has the same
// templated structure (FAQ + glossary + chrome) with only the company
// name varying. Google's dedup filter trips on that. Server-rendering
// the latest filed numbers per ticker (Revenue ₹61,180 Cr vs ₹2,16,737
// Cr etc.) gives each page genuinely unique factual content in the
// first byte of HTML — strong dedup signal.
//
// Errors return null so the page still renders with generic metadata
// if the DB is briefly unreachable during build / SSR.
async function getCompanyAndLatest(
  rawTicker: string
): Promise<{ company: CompanyMeta | null; latest: LatestQuarter | null }> {
  try {
    const ticker = decodeURIComponent(rawTicker).trim().toUpperCase();
    if (!ticker) return { company: null, latest: null };
    const sb = supabaseServer();
    const [{ data: company }, { data: quarters }] = await Promise.all([
      sb
        .from("companies")
        .select("ticker,company_name,sector,industry,exchange,isin")
        .eq("ticker", ticker)
        .maybeSingle(),
      sb
        .from("quarterly_financials")
        .select("quarter_label,quarter_end_date,revenue,net_profit,operating_profit,eps")
        .eq("ticker", ticker)
        .order("quarter_end_date", { ascending: false })
        .limit(1),
    ]);
    const latest =
      Array.isArray(quarters) && quarters.length > 0
        ? (quarters[0] as LatestQuarter)
        : null;
    return { company: (company as CompanyMeta) ?? null, latest };
  } catch {
    return { company: null, latest: null };
  }
}

// Back-compat: existing generateMetadata calls expect the company-only
// shape. Wraps the combined fetch.
async function getCompany(rawTicker: string): Promise<CompanyMeta | null> {
  return (await getCompanyAndLatest(rawTicker)).company;
}

// Crore formatter for the SSR "About" block — keeps the numbers
// readable + brand-consistent ("₹61,180 Cr" instead of raw rupees).
function formatCrore(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const cr = n / 1e7;
  if (cr >= 1000) return `₹${cr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
  if (cr >= 10)   return `₹${cr.toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`;
  return `₹${cr.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw).toUpperCase();
  const co = await getCompany(raw);
  const display = co ? cleanCompanyName(co.company_name) : ticker;
  const tickerBare = ticker.replace(/\.(NS|BO)$/, "");
  const url = canonical(`/company/${encodeURIComponent(ticker)}`);

  // Title is engineered for both search intent ("TCS Q4 FY26 results") and
  // brand recognition. Keep it under ~60 chars where possible — anything
  // longer gets clipped in Google's SERP.
  const title = `${display} (${tickerBare}) — ${ACTIVE_QUARTER} Results & Earnings`;

  // Tightened to ~120-140 chars (varies with company-name length).
  // Bing/Google truncate past ~155 with "…". The previous 197-char
  // version was flagged in Bing Webmaster Tools as too long.
  const description = co
    ? `${display} (${tickerBare}) ${ACTIVE_QUARTER} results — revenue, net profit, EPS, YoY growth & filing PDFs from NSE/BSE.${
        co.sector ? ` ${co.sector} sector.` : ""
      }`
    : `${ticker} ${ACTIVE_QUARTER} quarterly results — revenue, net profit, EPS, YoY growth, and filing PDFs.`;

  return {
    title,
    description,
    keywords: [
      // Result/earnings — verbatim queries
      `${display} results`,
      `${display} quarterly results`,
      `${display} ${ACTIVE_QUARTER} results`,
      `${display} ${ACTIVE_QUARTER}`,
      `${display} earnings`,
      `${display} latest results`,
      `${display} annual results`,
      `${display} FY26 results`,
      // Ticker-bare variants (search volume comes from "TCS share price",
      // not "TCS.NS share price")
      `${tickerBare} results`,
      `${tickerBare} earnings`,
      `${tickerBare} quarterly results`,
      `${tickerBare} ${ACTIVE_QUARTER}`,
      `${tickerBare} share price`,
      // Metrics (high-volume per-company queries)
      `${display} net profit`,
      `${display} revenue`,
      `${display} sales`,
      `${display} EBITDA`,
      `${display} operating profit`,
      `${display} EPS`,
      `${display} PAT`,
      `${display} profit margin`,
      `${display} financials`,
      `${display} P&L`,
      `${display} balance sheet`,
      `${display} YoY growth`,
      `${display} QoQ growth`,
      `${display} consolidated results`,
      `${display} standalone results`,
      // Stock/market terms
      `${display} share price`,
      `${display} stock price`,
      `${display} stock`,
      `${display} NSE`,
      `${display} BSE`,
      // Corporate actions
      `${display} dividend`,
      `${display} dividend history`,
      `${display} bonus issue`,
      `${display} stock split`,
      `${display} buyback`,
      // Result intimation / dates
      `${display} result date`,
      `${display} next results`,
      `${display} board meeting`,
      `${display} concall`,
      `${display} earnings call`,
      `${display} investor presentation`,
      // Generic
      "India earnings tracker",
      ...(co?.sector ? [`${co.sector} sector results`, `${co.sector} stocks`] : []),
      ...(co?.industry ? [`${co.industry} stocks India`] : []),
    ],
    alternates: { canonical: url },
    openGraph: {
      ...SOCIAL_CARD_DEFAULTS,
      title,
      description,
      url,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: { index: true, follow: true },
  };
}

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw).toUpperCase();
  const { company: co, latest } = await getCompanyAndLatest(raw);
  const display = co ? cleanCompanyName(co.company_name) : ticker;
  const tickerBare = ticker.replace(/\.(NS|BO)$/, "");
  const base = siteUrl();
  const url = canonical(`/company/${encodeURIComponent(ticker)}`);

  // Server-rendered breadcrumb — duplicate of the client one but emitted on
  // first byte so search-engine crawlers that don't run JS can still see it.
  const breadcrumbLd = buildBreadcrumbLd([
    { name: "Dashboard", url: `${base}/` },
    ...(co?.sector
      ? [{ name: co.sector, url: `${base}/sectors` }]
      : []),
    { name: display, url },
  ]);

  // FinancialProduct schema is technically more about instruments than
  // companies, but for an equity-tracking page it surfaces "ticker symbol",
  // "exchange", "issuer" cleanly to Google Knowledge Panel + AI engines.
  const corporationLd = co
    ? {
        "@context": "https://schema.org",
        "@type": "Corporation",
        "@id": `${url}#corporation`,
        name: co.company_name,
        alternateName: display,
        tickerSymbol: tickerBare,
        ...(co.isin ? { identifier: co.isin } : {}),
        ...(co.exchange ? { exchange: co.exchange } : {}),
        ...(co.industry ? { industry: co.industry } : {}),
        url,
        sameAs: [
          ...(co.ticker.endsWith(".NS")
            ? [`https://www.nseindia.com/get-quotes/equity?symbol=${tickerBare}`]
            : []),
        ],
        publishingPrinciples: `${base}/`,
      }
    : null;

  // 4 FAQ entries that match real Google-suggest queries for any Indian
  // listed company. "{Company} share price target" is intentionally avoided —
  // we don't publish targets, only filed numbers.
  const faqItems = [
    {
      q: `When does ${display} announce ${ACTIVE_QUARTER} results?`,
      a: `${display} files quarterly results with NSE and BSE within 45 days of quarter-end. Visit this page for the latest filing date, board-meeting notice, and the actual results PDF as soon as the company reports. We pull data directly from NSE/BSE filings — no broker estimates.`,
    },
    {
      q: `What were ${display}'s latest revenue and net profit?`,
      a: `Scroll to the "Latest quarter" KPI strip on this page for ${display}'s most recently filed revenue, net profit, operating profit and EPS figures, alongside YoY and QoQ growth. Historical quarters are listed below in a sortable table.`,
    },
    {
      q: `Where can I read ${display}'s official quarterly results PDF?`,
      a: `Each quarter row on this page links to the original filing PDF as published on NSE or BSE. The "View latest filing" link in the page header points to the most recent results document submitted by the company to the exchanges.`,
    },
    {
      q: `Does ${display} report quarterly or half-yearly results?`,
      a: `All listed Indian companies are required by SEBI to publish quarterly financial results within 45 days of quarter-end. ${display} follows the standard April–March fiscal year, so Q1 covers Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, and Q4 Jan–Mar.`,
    },
  ];

  // Pre-format the latest filed numbers for the SSR "About" block. We use
  // the crore convention because that's how Indian filings + business
  // press present these — keeps the page brand-natural.
  const revFmt = formatCrore(latest?.revenue);
  const profitFmt = formatCrore(latest?.net_profit);
  const epsFmt =
    latest?.eps != null && Number.isFinite(latest.eps)
      ? `₹${latest.eps.toFixed(2)}`
      : null;

  // The intro paragraph below the client component's header. Composed at
  // render time so each /company/[ticker] page has demonstrably unique
  // text content in the SSR HTML — different company name, different
  // sector, different latest-quarter numbers. This is what breaks
  // Google's "Duplicate without user-selected canonical" classification
  // (42 pages flagged in GSC). Keep it short but factual.
  const aboutSentence = co
    ? [
        `${display} (${tickerBare}) is a${
          co.sector
            ? ` ${co.sector.toLowerCase()} sector`
            : "n actively listed"
        } company on ${co.exchange || "NSE/BSE"}${
          co.industry ? `, classified under ${co.industry}` : ""
        }.`,
        latest
          ? `Latest filed quarter: ${latest.quarter_label}${
              revFmt ? `, revenue ${revFmt}` : ""
            }${profitFmt ? `, net profit ${profitFmt}` : ""}${
              epsFmt ? `, EPS ${epsFmt}` : ""
            }.`
          : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  return (
    <>
      <JsonLd data={breadcrumbLd} />
      {corporationLd ? <JsonLd data={corporationLd} /> : null}

      {/* SSR-rendered "About" sentence — runs on the server so it
          appears in the first byte of HTML. Visible to readers too
          (acts as a brief intro while the live charts/data hydrate
          below). Per-company unique content that breaks Google's
          duplicate-page detection. */}
      {aboutSentence ? (
        <aside
          className="container-core pt-6 md:pt-8 pb-2"
          aria-label="Company summary"
        >
          <p className="text-[13px] md:text-sm text-core-muted leading-relaxed max-w-3xl">
            {aboutSentence}
          </p>
        </aside>
      ) : null}

      {children}
      <div className="container-core pb-12">
        <FaqBlock
          title={`Frequently asked about ${display} (${tickerBare})`}
          items={faqItems}
        />
        <Glossary heading="How to read these numbers" />
      </div>
    </>
  );
}
