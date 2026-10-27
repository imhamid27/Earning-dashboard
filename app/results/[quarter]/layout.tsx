import type { Metadata } from "next";
import {
  quarterToCalendar,
  canonical,
  buildBreadcrumbLd,
  SOCIAL_CARD_DEFAULTS,
} from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import JsonLd from "@/components/JsonLd";
import FaqBlock from "@/components/FaqBlock";

function slugToLabel(slug: string): string {
  // "Q2-FY27" → "Q2 FY27"
  return decodeURIComponent(slug).replace(/-/g, " ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ quarter: string }>;
}): Promise<Metadata> {
  const { quarter: slug } = await params;
  const q = slugToLabel(slug);
  const calendar = quarterToCalendar(q);
  const title = `${q} Results — Quarterly Results Today, NSE & BSE (${calendar})`;
  const description = `Live ${q} quarterly results — every Indian company announcement on NSE & BSE, by date. Filed numbers, YoY growth, board-meeting dates, PDFs.`;
  const url = canonical(`/results/${slug}`);
  return {
    title,
    description,
    keywords: [
      `${q} results`, `${q} earnings`, `${q} announcements`, `${q} results India`,
      `${calendar} quarterly results`, `${calendar} earnings`,
      "quarterly results today", "quarterly results India", "results today NSE", "results today BSE",
      "live results India", "earnings season India", "quarterly results calendar India",
    ],
    alternates: { canonical: url },
    openGraph: { ...SOCIAL_CARD_DEFAULTS, title, description, url, type: "website" },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

export default async function ResultsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ quarter: string }>;
}) {
  const { quarter: slug } = await params;
  const q = slugToLabel(slug);
  const calendar = quarterToCalendar(q);
  const base = siteUrl();
  const url = canonical(`/results/${slug}`);
  const description = `Live ${q} quarterly results — every Indian company announcement on NSE & BSE, by date. Filed numbers, YoY growth, board-meeting dates, PDFs.`;

  const breadcrumbLd = buildBreadcrumbLd([
    { name: "Dashboard", url: `${base}/` },
    { name: `${q} announcements`, url },
  ]);

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    name: `${q} Results — Quarterly Results Today, NSE & BSE`,
    headline: `${q} (${calendar}) Indian Quarterly Results Calendar`,
    description, url,
    isPartOf: { "@id": `${base}/#website` },
    inLanguage: "en-IN",
    about: { "@type": "Thing", name: `${q} quarterly results calendar` },
    publisher: { "@id": `${base}/#organization` },
  };

  const faqItems = [
    {
      q: `Where can I see quarterly results announced today?`,
      a: `The date timeline above is the live ${q} quarterly results calendar — every NSE and BSE filing, by date. The "today" tab is selected by default whenever a company has reported on the current trading day.`,
    },
    {
      q: `When do Indian companies announce ${q} results?`,
      a: `SEBI requires listed companies to file quarterly results within 45 days of quarter-end. ${q} covers ${calendar}, so most filings land in the four to six weeks immediately after.`,
    },
    {
      q: `Where do you source these results from?`,
      a: `Every row on this page is sourced directly from NSE and BSE corporate-announcement filings — the same XBRL feeds the exchanges publish to brokers and data terminals.`,
    },
    {
      q: `How do I find a specific company's ${q} results?`,
      a: `Jump straight to the company's dedicated page (e.g. /company/TCS.NS) for its full quarter-by-quarter history with revenue, net profit, EPS, and direct links to every filing PDF.`,
    },
  ];

  return (
    <>
      <JsonLd data={breadcrumbLd} />
      <JsonLd data={collectionLd} />
      {children}
      <div className="container-core pb-12">
        <FaqBlock title={`Frequently asked about ${q} earnings`} items={faqItems} />
      </div>
    </>
  );
}
