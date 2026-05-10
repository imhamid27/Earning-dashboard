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

const title = `Quarterly Results Calendar 2026 — Upcoming NSE & BSE Earnings`;
const description = `Live quarterly results calendar for India — upcoming earnings announcements from NSE and BSE listed companies, day by day. See quarterly results scheduled today, tomorrow and through the week, including bellwethers like Reliance, TCS, HDFC Bank and Infosys. Board-meeting dates updated as exchanges receive notices.`;

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    // Calendar / upcoming — primary head terms
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
    "upcoming results India",
    "upcoming earnings India",
    "upcoming results NSE",
    "upcoming results BSE",
    "upcoming quarterly results NSE",
    "upcoming quarterly results NSE tomorrow",
    "upcoming quarterly results BSE",
    "upcoming results NSE stocks 2026",
    "earnings calendar India",
    "results schedule India",
    "next earnings date",
    "next results date",
    "quarterly results today",
    "quarterly results today NSE",
    "quarterly results today BSE",
    "today's results",
    "tomorrow's results",
    "quarterly results tomorrow",
    "results this week India",
    "results next week India",
    "results this month India",
    `${ACTIVE_QUARTER} upcoming results`,
    `${ACTIVE_QUARTER} results date`,
    `${ACTIVE_QUARTER} board meeting`,
    // Board meetings / intimations
    "board meeting calendar India",
    "board meeting intimation",
    "result intimation",
    "result announcement date",
    "AGM calendar India",
    "EGM calendar India",
    // Bellwethers (these queries drive the most traffic to this page)
    "Reliance results date",
    "TCS results date",
    "Infosys results date",
    "HDFC Bank results date",
    "ICICI Bank results date",
    "ITC results date",
    "SBI results date",
    "Bharti Airtel results date",
    "Hindustan Unilever results date",
    "L&T results date",
    "Bajaj Finance results date",
    "Maruti Suzuki results date",
    "Asian Paints results date",
    // Quarter
    "Q1 results date India",
    "Q2 results date India",
    "Q3 results date India",
    "Q4 results date India",
    "FY26 results date",
    "annual results date India",
    // Generic results / meta
    "earnings season India",
    "India Inc results",
    "Nifty 50 result dates",
    "Sensex result dates",
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
    name: "Quarterly Results Calendar — Upcoming NSE & BSE Earnings",
    headline: "Quarterly Results Calendar 2026 — Upcoming Indian Earnings",
    description,
    url,
    isPartOf: { "@id": `${base}/#website` },
    inLanguage: "en-IN",
    about: { "@type": "Thing", name: "Quarterly results calendar India" },
  };

  const faqItems = [
    {
      q: "Is this an NSE and BSE quarterly results calendar?",
      a: "Yes. Every date on this page is a board-meeting intimation filed by a listed company directly with NSE or BSE — the formal exchange notice that quarterly financial results will be considered on that date. We pull those filings as they're published, so the calendar reflects the official schedule, not estimated or rumoured dates.",
    },
    {
      q: "How do I see quarterly results scheduled for tomorrow?",
      a: "Look for the 'Tomorrow' pill in the date timeline above. It groups every company whose board meeting to consider results is scheduled for the next calendar day. The day-after-tomorrow and the rest of the week are listed alongside it for quick scanning.",
    },
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
          title="Frequently asked about the quarterly results calendar"
          items={faqItems}
        />
      </div>
    </>
  );
}
