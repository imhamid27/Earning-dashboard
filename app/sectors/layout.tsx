// Server-side wrapper for /sectors. Owns the page's metadata, canonical
// URL, and baseline JSON-LD (BreadcrumbList + FAQPage + CollectionPage).
// The client page below renders the actual interactive sector grid.

import type { Metadata } from "next";
import {
  ACTIVE_QUARTER,
  canonical,
  buildBreadcrumbLd,
  SOCIAL_CARD_DEFAULTS,
} from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import JsonLd from "@/components/JsonLd";
import FaqBlock from "@/components/FaqBlock";

const URL_PATH = "/sectors";

export const metadata: Metadata = {
  title: `Sector-wise Earnings ${ACTIVE_QUARTER} — Revenue & Profit by Indian Sector`,
  description: `Compare ${ACTIVE_QUARTER} revenue and net-profit growth across Indian sectors — IT, Banking, FMCG, Auto, Metals, Pharma and more. Find the strongest and weakest sectors by quarter, with company drill-downs.`,
  keywords: [
    // Sector earnings — generic
    "sector earnings India",
    "sector wise quarterly results",
    "sector wise results India",
    "sectoral results India",
    "sectoral indices India",
    `${ACTIVE_QUARTER} sector results`,
    `${ACTIVE_QUARTER} sectoral performance`,
    "Indian sector revenue growth",
    "Indian sector profit growth",
    "best performing sectors India",
    "worst performing sectors India",
    "top performing sectors NSE",
    "top performing sectors BSE",
    "sector heatmap India",
    "sector winners losers India",
    // Per-sector long tail (this is where the volume is — every reader
    // searches by their own sector first)
    "IT sector results India",
    "IT companies results",
    "IT stocks earnings",
    "banking sector results India",
    "banking stocks results",
    "private banks results",
    "PSU banks results",
    "NBFC results",
    "FMCG sector results India",
    "FMCG stocks earnings",
    "consumer goods results India",
    "auto sector results India",
    "auto stocks earnings",
    "automobile results India",
    "metals sector results India",
    "metal stocks results",
    "steel companies results",
    "cement companies results",
    "pharma sector results India",
    "pharma stocks earnings",
    "healthcare sector results",
    "energy sector results India",
    "oil and gas results",
    "power sector results India",
    "telecom sector results",
    "realty sector results India",
    "real estate stocks results",
    "infrastructure sector results",
    "capital goods results India",
    "chemicals sector results",
    "media sector results India",
    // Index-level (Moneycontrol heavy on these)
    "Nifty Bank results",
    "Nifty IT results",
    "Nifty Auto results",
    "Nifty Pharma results",
    "Nifty FMCG results",
    "Nifty Metal results",
    "Nifty Realty results",
    "Nifty Energy results",
    "Nifty Financial Services results",
    "BSE sectoral indices",
    "Nifty sectoral indices",
    "Nifty sector performance",
    // Cross-cutting
    "sector outlook India",
    "sector commentary India",
    "moneycontrol sector results",
  ],
  alternates: { canonical: canonical(URL_PATH) },
  openGraph: {
    ...SOCIAL_CARD_DEFAULTS,
    title: `Sector-wise Earnings ${ACTIVE_QUARTER} — India`,
    description: `Compare ${ACTIVE_QUARTER} revenue and net-profit growth across Indian sectors. Find the strongest and weakest sectors with company drill-downs.`,
    url: canonical(URL_PATH),
  },
  twitter: {
    card: "summary_large_image",
    title: `Sector-wise Earnings ${ACTIVE_QUARTER} — India`,
    description: `Revenue and net-profit growth by sector for ${ACTIVE_QUARTER}.`,
  },
  robots: { index: true, follow: true },
};

export default function SectorsLayout({ children }: { children: React.ReactNode }) {
  const base = siteUrl();
  const url = canonical(URL_PATH);

  const breadcrumbLd = buildBreadcrumbLd([
    { name: "Dashboard", url: `${base}/` },
    { name: "Sector earnings", url },
  ]);

  // CollectionPage describes /sectors as a curated overview page —
  // helps Google understand it's an index/landing rather than an article.
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    name: `Sector-wise Earnings — ${ACTIVE_QUARTER}`,
    description: `Sector-level revenue and net-profit growth for Indian listed companies, ${ACTIVE_QUARTER}.`,
    url,
    isPartOf: { "@id": `${base}/#website` },
    inLanguage: "en-IN",
  };

  const faqItems = [
    {
      q: `Which Indian sectors are reporting strongest in ${ACTIVE_QUARTER}?`,
      a: `Open this page to see the live "Best" and "Weakest" sector tags at the top of the dashboard, sorted by net-profit YoY growth. Sectors are ranked by aggregated revenue and profit across all listed constituents that have filed for the quarter.`,
    },
    {
      q: `How is sector growth calculated?`,
      a: `For each sector, we sum revenue and net profit across all constituent listed companies that have reported for the quarter, and compare those totals to the same companies' figures for the year-ago quarter. Aggregating this way avoids tiny-base distortions that simple averages produce.`,
    },
    {
      q: `Why does a sector show "low base" instead of a percentage?`,
      a: `When a company's prior-year net profit was very small or near zero, even a small absolute change shows as a huge percentage swing — misleading at a glance. We flag those as "low base" so readers don't anchor on a noisy number.`,
    },
    {
      q: `Where do you source sector classifications from?`,
      a: `Sector and industry tags come from NSE/BSE listing metadata. We don't override broker classifications — what you see here matches what the exchanges publish for each ticker.`,
    },
    {
      q: `How often is sector data updated?`,
      a: `Continuously — every two hours during the Indian market day, with full sweeps three times daily. As soon as a constituent company files its quarterly results with NSE or BSE and the XBRL is published, the sector totals on this page recalculate.`,
    },
  ];

  return (
    <>
      <JsonLd data={breadcrumbLd} />
      <JsonLd data={collectionLd} />
      {children}
      <div className="container-core pb-12">
        <FaqBlock
          title={`Frequently asked about Indian sector earnings`}
          items={faqItems}
        />
      </div>
    </>
  );
}
