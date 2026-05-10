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

interface CompanyMeta {
  ticker: string;
  company_name: string;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  isin: string | null;
}

// Lightweight company lookup — only the fields we need for metadata.
// Errors return null so the page still renders with generic metadata if
// the DB is briefly unreachable during build / SSR.
async function getCompany(rawTicker: string): Promise<CompanyMeta | null> {
  try {
    const ticker = decodeURIComponent(rawTicker).trim().toUpperCase();
    if (!ticker) return null;
    const sb = supabaseServer();
    const { data } = await sb
      .from("companies")
      .select("ticker,company_name,sector,industry,exchange,isin")
      .eq("ticker", ticker)
      .maybeSingle();
    return (data as CompanyMeta) ?? null;
  } catch {
    return null;
  }
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

  const description = co
    ? `${display} (${tickerBare}) quarterly results — revenue, net profit, EPS, YoY/QoQ growth, and filing PDFs. ${
        co.sector ? `Sector: ${co.sector}. ` : ""
      }Free dashboard tracking ${ACTIVE_QUARTER} earnings for listed Indian companies.`
    : `${ticker} quarterly results — revenue, net profit, EPS, YoY/QoQ growth, and filing PDFs across multiple quarters.`;

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
      // Metrics (Moneycontrol-style per-company queries)
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
      "moneycontrol alternative",
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
  const co = await getCompany(raw);
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

  return (
    <>
      <JsonLd data={breadcrumbLd} />
      {corporationLd ? <JsonLd data={corporationLd} /> : null}
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
