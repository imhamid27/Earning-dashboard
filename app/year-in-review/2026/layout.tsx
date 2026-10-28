import type { Metadata } from "next";
import { canonical, buildBreadcrumbLd, SOCIAL_CARD_DEFAULTS } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import JsonLd from "@/components/JsonLd";
import FaqBlock from "@/components/FaqBlock";

const URL_PATH = "/year-in-review/2026";

export const metadata: Metadata = {
  title: "India Corporate Earnings 2026 — Year in Review | The Core",
  description:
    "A full-year look at how India Inc. performed in 2026 — revenue growth, profit trends, best and worst performing sectors, and the year's biggest stock market winners and losers.",
  keywords: [
    "India corporate earnings 2026",
    "India earnings year in review 2026",
    "NSE BSE earnings 2026",
    "Indian stock market 2026 review",
    "best performing stocks India 2026",
    "worst performing stocks India 2026",
    "sector performance India 2026",
    "quarterly results India 2026",
    "India GDP earnings 2026",
    "FY27 earnings review",
    "FY26 earnings review",
    "India Inc results 2026",
    "top gainers India 2026",
    "top losers India 2026",
    "India profit growth 2026",
    "India revenue growth 2026",
  ],
  alternates: { canonical: canonical(URL_PATH) },
  openGraph: {
    ...SOCIAL_CARD_DEFAULTS,
    title: "India Corporate Earnings 2026 — Year in Review",
    description:
      "Revenue, profit, sectors, and markets — a full-year look at how India Inc. performed in 2026.",
    url: canonical(URL_PATH),
  },
  twitter: {
    card: "summary_large_image",
    title: "India Corporate Earnings 2026 — Year in Review",
    description: "The year's biggest earnings stories, sector scorecards, and market movers.",
  },
  robots: { index: true, follow: true },
};

const FAQ_ITEMS = [
  {
    q: "Which quarters are covered in the 2026 Year in Review?",
    a: "The page covers all quarters with results filed in calendar year 2026: Q4 FY26 (January–March 2026), Q1 FY27 (April–June 2026), and Q2 FY27 (July–September 2026). Q3 FY27 results (October–December 2026) will be added as companies file.",
  },
  {
    q: "How are the 'Year's Biggest Movers' calculated?",
    a: "Stock returns use the year-to-date (YTD) change in adjusted closing price from January 1, 2026 to the most recent trading day. Adjusted prices account for dividends, splits, and bonus issues.",
  },
  {
    q: "Why do some companies show different growth numbers across quarters?",
    a: "Each quarter is compared to the same quarter in the prior fiscal year (year-over-year). Different quarters can show very different growth rates depending on seasonality, one-off items, and when companies filed.",
  },
  {
    q: "Is this page updated in real time?",
    a: "The earnings data updates every two hours during the results season. Stock prices update each weekday by 4:30 PM IST. The page will continue to evolve as more companies file Q2 FY27 and Q3 FY27 results.",
  },
];

export default function YearInReviewLayout({ children }: { children: React.ReactNode }) {
  const base = siteUrl();
  const url  = canonical(URL_PATH);

  const breadcrumbLd = buildBreadcrumbLd([
    { name: "Dashboard", url: `${base}/` },
    { name: "Year in Review 2026", url },
  ]);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    headline: "India Corporate Earnings 2026 — Year in Review",
    description:
      "A full-year look at India Inc.'s revenue growth, profit trends, sector performance, and market movers in 2026.",
    url,
    inLanguage: "en-IN",
    publisher: {
      "@type": "Organization",
      name: "The Core",
      url: "https://www.thecore.in",
    },
    isPartOf: { "@id": `${base}/#website` },
  };

  return (
    <>
      <JsonLd data={breadcrumbLd} />
      <JsonLd data={articleLd} />
      {children}
      <div className="container-core pb-12">
        <FaqBlock title="Frequently asked about India Earnings 2026" items={FAQ_ITEMS} />
      </div>
    </>
  );
}
