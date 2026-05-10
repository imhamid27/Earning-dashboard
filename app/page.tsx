// Server-component wrapper for the homepage.
// Owns the page-specific <title>, <meta description>, canonical, OG card,
// and the homepage-level JSON-LD (FAQPage, ItemList of bellwethers).
// Delegates the live UI to ./HomeClient (the original client component).

import type { Metadata } from "next";
import HomeClient from "./HomeClient";
import JsonLd from "@/components/JsonLd";
import FaqBlock from "@/components/FaqBlock";
import {
  ACTIVE_QUARTER,
  quarterToCalendar,
  canonical,
  buildBreadcrumbLd,
  buildItemListLd,
  SOCIAL_CARD_DEFAULTS,
} from "@/lib/seo";
import { siteUrl } from "@/lib/site";

const calendar = quarterToCalendar(ACTIVE_QUARTER);

const TITLE = `India Earnings Tracker — ${ACTIVE_QUARTER} Quarterly Results, Live NSE & BSE`;
const DESCRIPTION = `Live ${ACTIVE_QUARTER} (${calendar}) earnings dashboard for 1,000+ listed Indian companies. Track quarterly revenue, net profit, PAT, EBITDA, EPS, YoY/QoQ growth and operating margins across NSE and BSE — with sector-wise breakdowns, upcoming result dates, dividend declarations, board meetings and direct filing PDFs sourced from official exchange filings. Free, no paywall.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    // Brand + intent
    "India earnings tracker",
    "Indian quarterly results",
    "results dashboard India",
    "earnings dashboard India",
    "best earnings tracker India",
    "free results tracker India",
    "free quarterly results India",
    "best stock results website India",
    "best results aggregator India",
    // Active quarter
    `${ACTIVE_QUARTER} results`,
    `${ACTIVE_QUARTER} earnings`,
    `${ACTIVE_QUARTER} results India`,
    `${ACTIVE_QUARTER} earnings India`,
    `${calendar} results`,
    `${calendar} quarterly results`,
    // All quarter buckets — query volume comes from people typing
    // "Q1 results 2026", "Q2 FY26 results" etc.
    "Q1 results FY26",
    "Q2 results FY26",
    "Q3 results FY26",
    "Q4 results FY26",
    "quarterly results India",
    "quarterly earnings India",
    "annual results India",
    "FY26 results India",
    // Live / today / calendar
    "live earnings India",
    "today's results India",
    "results today NSE",
    "results today BSE",
    "results today India",
    "upcoming results India",
    "earnings calendar India",
    "results calendar India",
    "board meeting calendar India",
    "result date India",
    // Exchanges
    "NSE results",
    "BSE results",
    "NSE earnings",
    "BSE earnings",
    "NSE BSE listed companies",
    // Metrics (high-volume retail finance terms)
    "net profit India",
    "PAT India",
    "revenue growth India",
    "EBITDA India",
    "EPS India",
    "operating profit India",
    "YoY profit growth",
    "QoQ revenue growth",
    "consolidated results",
    "standalone results",
    // Indices
    "Nifty 50 results",
    "Nifty Next 50 results",
    "Nifty 500 results",
    "Sensex results",
    "BSE 500 results",
    "Nifty Bank results",
    "Nifty IT results",
    // Bellwether companies (drives long-tail brand searches)
    "Reliance results",
    "TCS results",
    "Infosys results",
    "HDFC Bank results",
    "ICICI Bank results",
    "ITC results",
    "SBI results",
    "Bharti Airtel results",
    "Larsen Toubro results",
    // Sectors
    "IT sector results",
    "banking sector results",
    "FMCG sector results",
    "auto sector results",
    "pharma sector results",
    "metals sector results",
    // Corporate actions
    "dividend announcement India",
    "bonus issue India",
    "stock split India",
    "share buyback India",
    // Editorial framing
    "earnings season India",
    "India Inc results",
    "corporate India earnings",
  ],
  alternates: { canonical: canonical("/") },
  openGraph: {
    ...SOCIAL_CARD_DEFAULTS,
    title: TITLE,
    description: DESCRIPTION,
    url: canonical("/"),
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

// Bellwether tickers — surfaced as an ItemList so AI engines can answer
// "which bellwether companies report in India?" by quoting from this list.
const BELLWETHERS = [
  { ticker: "RELIANCE.NS", name: "Reliance Industries" },
  { ticker: "HDFCBANK.NS", name: "HDFC Bank" },
  { ticker: "TCS.NS",       name: "Tata Consultancy Services (TCS)" },
  { ticker: "INFY.NS",      name: "Infosys" },
  { ticker: "ICICIBANK.NS", name: "ICICI Bank" },
  { ticker: "ITC.NS",       name: "ITC" },
  { ticker: "HINDUNILVR.NS", name: "Hindustan Unilever" },
  { ticker: "SBIN.NS",      name: "State Bank of India" },
  { ticker: "BHARTIARTL.NS", name: "Bharti Airtel" },
  { ticker: "LT.NS",         name: "Larsen & Toubro" },
  { ticker: "BAJFINANCE.NS", name: "Bajaj Finance" },
  { ticker: "HCLTECH.NS",    name: "HCL Technologies" },
  { ticker: "KOTAKBANK.NS",  name: "Kotak Mahindra Bank" },
  { ticker: "MARUTI.NS",     name: "Maruti Suzuki" },
  { ticker: "ASIANPAINT.NS", name: "Asian Paints" },
];

export default function Home() {
  const base = siteUrl();
  const url = canonical("/");

  const breadcrumbLd = buildBreadcrumbLd([
    { name: "Dashboard", url: `${base}/` },
  ]);

  const bellwetherListLd = buildItemListLd(
    `Bellwether Indian Companies — ${ACTIVE_QUARTER} Earnings`,
    `Large-cap Indian companies whose ${ACTIVE_QUARTER} (${calendar}) results materially shape market sentiment.`,
    BELLWETHERS.map((b) => ({
      name: b.name,
      url: `${base}/company/${encodeURIComponent(b.ticker)}`,
    }))
  );

  // WebPage schema with explicit primaryImageOfPage and significantLink
  // helps AI engines identify the homepage as the canonical landing for
  // "India earnings tracker" / "Indian quarterly results dashboard".
  const webpageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    name: TITLE,
    description: DESCRIPTION,
    url,
    isPartOf: { "@id": `${base}/#website` },
    about: { "@id": `${base}/#datacatalog` },
    inLanguage: "en-IN",
    significantLink: [
      `${base}/q4`,
      `${base}/sectors`,
      `${base}/upcoming`,
    ],
  };

  const faqItems = [
    {
      q: `What is India Earnings Tracker?`,
      a: `India Earnings Tracker is a free, live dashboard of quarterly results for 1,000+ listed Indian companies on NSE and BSE. We aggregate revenue, net profit, operating profit, EPS, and YoY/QoQ growth for every reporting quarter, with direct links to the original filing PDFs. No paywall, no broker estimates — only filed, official numbers from the exchanges.`,
    },
    {
      q: `When are ${ACTIVE_QUARTER} results announced?`,
      a: `${ACTIVE_QUARTER} covers ${calendar}. SEBI requires listed companies to file results within 45 days of quarter-end, so most filings land in the four to six weeks immediately after the quarter closes. The /q4 page on this dashboard tracks every announcement as it happens, grouped by date.`,
    },
    {
      q: `What makes this dashboard different?`,
      a: `Speed, structured data, and verifiable sources. Every metric on the site comes directly from NSE/BSE XBRL filings — not transcripts, not broker rewrites — and the database refreshes every two hours. Pages are designed for fast scanning (KPI strips, sector heatmaps) and for direct linking from search engines and AI answer engines, with no paywall and no login.`,
    },
    {
      q: `Where do you source the data?`,
      a: `All quarterly numbers come from the corporate-filings feeds published by NSE (corporate announcements + BHAVCOPY) and BSE (corporate announcements + filings portal). We parse the original XBRL submissions, the same source brokers and data terminals consume. Historical price data is fetched separately from public market-data APIs.`,
    },
    {
      q: `Is the data delayed?`,
      a: `Quarterly results are picked up within roughly two hours of the company filing with the exchanges — that's how often our ingestion sweeps run during the trading day, with three full sweeps daily as backstops. Live trading prices on company pages are refreshed every few minutes during market hours and clearly badged "LIVE" or "CLOSED" depending on session state.`,
    },
    {
      q: `Which companies are tracked?`,
      a: `We currently track 1,000+ actively listed Indian companies — including all Nifty 50 and Nifty Next 50 constituents, plus broader Nifty 500 names and several smaller mid- and small-caps with meaningful retail-investor interest. Coverage expands as we add tickers from exchange listing files.`,
    },
    {
      q: `Can I track a specific company?`,
      a: `Yes — every tracked company has a dedicated page at /company/[TICKER] with up to 8 quarters of history, charts, KPI summaries, and direct filing PDFs. Use the search bar on the homepage or open URLs directly (e.g. /company/TCS.NS, /company/RELIANCE.NS).`,
    },
  ];

  return (
    <>
      <JsonLd data={breadcrumbLd} />
      <JsonLd data={webpageLd} />
      <JsonLd data={bellwetherListLd} />
      <HomeClient />

      {/* Visible bellwether index — provides crawlable links to the most-
          searched company pages, and reinforces the ItemList JSON-LD above
          with the same data in human-readable form. */}
      <section className="container-core pb-12">
        <div className="border-t border-core-line pt-10 mt-6">
          <h2 className="text-xl md:text-2xl font-bold tracking-tightest mb-2">
            Track {ACTIVE_QUARTER} earnings for India's bellwether companies
          </h2>
          <p className="text-[14px] leading-relaxed text-core-muted mb-5 max-w-3xl">
            Large-cap names whose quarterly results disproportionately shape
            market sentiment. Click through for full quarter-by-quarter
            history, latest filings, and live trading price.
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-2.5 text-[14px]">
            {BELLWETHERS.map((b) => (
              <li key={b.ticker}>
                <a
                  href={`/company/${encodeURIComponent(b.ticker)}`}
                  className="text-core-ink hover:text-core-pink underline-offset-2 hover:underline"
                >
                  {b.name}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Internal linking row — funnels homepage juice to the three
            major secondary indexes. Helps both SEO (depth) and UX. */}
        <div className="border-t border-core-line pt-8 mt-10 grid grid-cols-1 md:grid-cols-3 gap-6 text-[14px]">
          <a href="/q4" className="block group">
            <div className="text-[10px] uppercase tracking-[0.18em] text-core-muted group-hover:text-core-pink">
              Section
            </div>
            <div className="mt-1 font-bold text-core-ink group-hover:text-core-pink">
              {ACTIVE_QUARTER} Announcements →
            </div>
            <p className="mt-1 text-core-muted leading-relaxed">
              Day-by-day timeline of every filed and pending {ACTIVE_QUARTER} result.
            </p>
          </a>
          <a href="/sectors" className="block group">
            <div className="text-[10px] uppercase tracking-[0.18em] text-core-muted group-hover:text-core-pink">
              Section
            </div>
            <div className="mt-1 font-bold text-core-ink group-hover:text-core-pink">
              Sector Earnings View →
            </div>
            <p className="mt-1 text-core-muted leading-relaxed">
              Revenue and profit growth aggregated across IT, Banking, FMCG,
              Auto, Pharma and more.
            </p>
          </a>
          <a href="/upcoming" className="block group">
            <div className="text-[10px] uppercase tracking-[0.18em] text-core-muted group-hover:text-core-pink">
              Section
            </div>
            <div className="mt-1 font-bold text-core-ink group-hover:text-core-pink">
              Upcoming Results Calendar →
            </div>
            <p className="mt-1 text-core-muted leading-relaxed">
              Scheduled earnings dates from filed board-meeting intimations.
            </p>
          </a>
        </div>

        <FaqBlock
          title="Frequently asked about India Earnings Tracker"
          items={faqItems}
        />
      </section>
    </>
  );
}
