// Server-side wrapper for /upcoming — the upcoming-results calendar.
// Targets queries like "upcoming results India", "next earnings date TCS",
// "results calendar this week".

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

const URL_PATH = "/upcoming";

const title = `Upcoming Results Calendar — Indian Earnings Schedule (${ACTIVE_QUARTER})`;
const description = `Day-by-day calendar of upcoming earnings announcements from listed Indian companies on NSE and BSE — including bellwethers like Reliance, TCS, HDFC Bank, Infosys. Board-meeting dates updated as exchanges receive notices.`;

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "upcoming results India",
    "earnings calendar India",
    "upcoming results NSE",
    "upcoming results BSE",
    "next earnings date",
    `${ACTIVE_QUARTER} upcoming results`,
    "Reliance results date",
    "TCS results date",
    "HDFC Bank results date",
    "Infosys results date",
    "Q4 results date India",
    "board meeting calendar India",
    "results this week India",
  ],
  alternates: { canonical: canonical(URL_PATH) },
  openGraph: {
    ...SOCIAL_CARD_DEFAULTS,
    title,
    description,
    url: canonical(URL_PATH),
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: { index: true, follow: true },
};

export default function UpcomingLayout({ children }: { children: React.ReactNode }) {
  const base = siteUrl();
  const url = canonical(URL_PATH);

  const breadcrumbLd = buildBreadcrumbLd([
    { name: "Dashboard", url: `${base}/` },
    { name: "Upcoming results", url },
  ]);

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    name: "Upcoming Indian Earnings Results",
    description,
    url,
    isPartOf: { "@id": `${base}/#website` },
    inLanguage: "en-IN",
    about: { "@type": "Thing", name: "Upcoming earnings calendar" },
  };

  const faqItems = [
    {
      q: "How do you know when a company will announce results?",
      a: "Listed Indian companies are required to give NSE/BSE at least two working days' notice before any board meeting where financial results will be considered. We pull those notices directly from the exchange announcements feed and surface them here as soon as they appear.",
    },
    {
      q: "Why don't I see a date for some companies?",
      a: "If a company hasn't yet filed a board-meeting intimation with the exchanges, we have no source for the date — and we don't fill in guesses. Once the company files the intimation, the row appears here automatically within an hour.",
    },
    {
      q: "Can a result date change?",
      a: "Yes. Companies sometimes reschedule board meetings — usually with a fresh intimation to the exchanges. When that happens, we update the calendar to match the latest filed date, and the previous date drops off.",
    },
    {
      q: "What does 'bellwether' mean in the highlight strip?",
      a: "We use 'bellwethers' to mean ~15 large-cap names whose results disproportionately move sentiment for the broader market — Reliance, HDFC Bank, TCS, Infosys, ICICI Bank, ITC, Hindustan Unilever, SBI, Bharti Airtel, Larsen & Toubro, Bajaj Finance, HCL Tech, Kotak Mahindra Bank, Maruti Suzuki, Asian Paints. They're highlighted at the top of this page when their filings are still pending.",
    },
    {
      q: "How can I track a specific company's upcoming result date?",
      a: "Open the company's dedicated page (e.g. /company/TCS.NS) — the page header shows the next scheduled result date prominently when one is filed with the exchanges. Or scan this calendar for the company name in the relevant date group.",
    },
  ];

  return (
    <>
      <JsonLd data={breadcrumbLd} />
      <JsonLd data={collectionLd} />
      {children}
      <div className="container-core pb-12">
        <FaqBlock
          title="Frequently asked about upcoming Indian earnings"
          items={faqItems}
        />
      </div>
    </>
  );
}
