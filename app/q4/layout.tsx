// Server-side wrapper for /q4 — the active-quarter announcement tracker.
// Owns metadata + JSON-LD (BreadcrumbList, NewsArticle-style CollectionPage,
// FAQPage) so the live announcements page below can stay focused on the
// interactive UI.

import type { Metadata } from "next";
import {
  ACTIVE_QUARTER,
  quarterToCalendar,
  canonical,
  buildBreadcrumbLd,
  SOCIAL_CARD_DEFAULTS,
} from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import JsonLd from "@/components/JsonLd";
import FaqBlock from "@/components/FaqBlock";

const URL_PATH = "/q4";

const calendar = quarterToCalendar(ACTIVE_QUARTER); // e.g. "Jan–Mar 2026"
const title = `${ACTIVE_QUARTER} Results — Quarterly Results Today, NSE & BSE (${calendar})`;
// Tightened to ~150 chars — Bing/Google truncate past ~155 with "…".
const description = `Live ${ACTIVE_QUARTER} quarterly results — every Indian company announcement on NSE & BSE, by date. Filed numbers, YoY growth, board-meeting dates, PDFs.`;

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    // Quarter-specific
    `${ACTIVE_QUARTER} results`,
    `${ACTIVE_QUARTER} earnings`,
    `${ACTIVE_QUARTER} earnings India`,
    `${ACTIVE_QUARTER} announcements`,
    `${ACTIVE_QUARTER} results India`,
    `${ACTIVE_QUARTER} results today`,
    `${ACTIVE_QUARTER} corporate results`,
    `${calendar} quarterly results`,
    `${calendar} earnings`,
    `${calendar} results India`,
    // Quarter rotation — capture other quarter searches that still
    // land here as the "live tracker" page during transition periods.
    "Q1 results FY26",
    "Q2 results FY26",
    "Q3 results FY26",
    "Q4 results FY26",
    "Q4 FY26 result date",
    "quarterly results India",
    "quarterly earnings India",
    "annual results India",
    // Today / live / live tracker — primary head terms
    "quarterly results today",
    "quarterly results today NSE",
    "quarterly results today BSE",
    "Quarterly results Today nse",
    "results today",
    "today's results India",
    "results today NSE",
    "results today BSE",
    "live results India",
    "results live updates",
    "earnings season India",
    "India Inc results",
    // Calendar / upcoming
    "quarterly results calendar",
    "quarterly results calendar 2026",
    "quarterly results calendar India",
    "quarterly results calendar NSE",
    "quarterly results calendar BSE",
    "results calendar India",
    "results calendar 2026",
    "NSE result calendar",
    "NSE result calendar 2026",
    "BSE result calendar",
    "BSE result calendar 2026",
    "company results calendar",
    "company results calendar India",
    "earnings calendar India",
    "upcoming results NSE",
    "upcoming results BSE",
    "upcoming quarterly results NSE",
    "upcoming quarterly results NSE tomorrow",
    "board meeting results India",
    "result intimation India",
    // Specific result actions
    "result announcement India",
    "result declaration India",
    "filed results India",
    "filing pending India",
    // Metrics
    "net profit",
    "PAT",
    "EBITDA",
    "EPS",
    "revenue YoY growth",
    "profit YoY growth",
    "operating profit margin",
    "consolidated results",
    "standalone results",
    // Bellwether names that drive search to this page
    "Reliance Q4 results",
    "TCS Q4 results",
    "Infosys Q4 results",
    "HDFC Bank Q4 results",
    "ICICI Bank Q4 results",
    // Corporate actions adjacent
    "dividend declaration",
    "bonus issue announcement",
    "concall transcript",
    "earnings call India",
  ],
  alternates: { canonical: canonical(URL_PATH) },
  openGraph: {
    ...SOCIAL_CARD_DEFAULTS,
    title,
    description,
    url: canonical(URL_PATH),
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: { index: true, follow: true },
};

export default function Q4Layout({ children }: { children: React.ReactNode }) {
  const base = siteUrl();
  const url = canonical(URL_PATH);

  const breadcrumbLd = buildBreadcrumbLd([
    { name: "Dashboard", url: `${base}/` },
    { name: `${ACTIVE_QUARTER} announcements`, url },
  ]);

  // CollectionPage with datePublished/dateModified ≈ now signals freshness
  // to crawlers. Useful for "results today" / "results this week" queries.
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    name: `${ACTIVE_QUARTER} Results — Quarterly Results Today, NSE & BSE`,
    headline: `${ACTIVE_QUARTER} (${calendar}) Indian Quarterly Results Calendar`,
    description,
    url,
    isPartOf: { "@id": `${base}/#website` },
    inLanguage: "en-IN",
    about: {
      "@type": "Thing",
      name: `${ACTIVE_QUARTER} quarterly results calendar`,
    },
    publisher: { "@id": `${base}/#organization` },
  };

  const faqItems = [
    {
      q: `Where can I see quarterly results announced today?`,
      a: `The date timeline above is the live ${ACTIVE_QUARTER} quarterly results calendar — every NSE and BSE filing, by date. The "today" tab is selected by default whenever a company has reported on the current trading day; otherwise it shows the most recent date with filings.`,
    },
    {
      q: `When do Indian companies announce ${ACTIVE_QUARTER} results?`,
      a: `SEBI requires listed companies to file quarterly results within 45 days of quarter-end. ${ACTIVE_QUARTER} covers ${calendar}, so most filings land in the four to six weeks immediately after. Bellwethers like TCS and Reliance typically file early; smaller caps tend to use the full window.`,
    },
    {
      q: `Where do you source these results from?`,
      a: `Every row on this page is sourced directly from NSE and BSE corporate-announcement filings — the same XBRL feeds the exchanges publish to brokers and data terminals. We don't republish broker estimates or unverified previews; only filed, official numbers.`,
    },
    {
      q: `What's the difference between "reported" and "filing pending" companies?`,
      a: `A company appears under "filing pending" when its board meeting date is on the calendar but the formal financial results document hasn't been uploaded yet. Most companies file the same day or within 24 hours of the board meeting; we update the row to "reported" the moment the XBRL filing is published.`,
    },
    {
      q: `How do I find a specific company's ${ACTIVE_QUARTER} results?`,
      a: `Use the date tabs to scan results announced on a particular day, or jump straight to the company's dedicated page (e.g. /company/TCS.NS) for its full quarter-by-quarter history with revenue, net profit, EPS, and direct links to every filing PDF.`,
    },
    {
      q: `Are these consolidated or standalone numbers?`,
      a: `Where a company files both, we surface the consolidated figures by default — they reflect group-level performance including subsidiaries. Standalone numbers are available in the underlying filing PDF, which is one click away from every row.`,
    },
  ];

  return (
    <>
      <JsonLd data={breadcrumbLd} />
      <JsonLd data={collectionLd} />
      {children}
      <div className="container-core pb-12">
        <FaqBlock
          title={`Frequently asked about ${ACTIVE_QUARTER} earnings`}
          items={faqItems}
        />
      </div>
    </>
  );
}
