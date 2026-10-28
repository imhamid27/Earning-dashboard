import type { Metadata } from "next";
import { canonical, buildBreadcrumbLd, SOCIAL_CARD_DEFAULTS } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import JsonLd from "@/components/JsonLd";
import FaqBlock from "@/components/FaqBlock";

const URL_PATH = "/market-movers";

export const metadata: Metadata = {
  title: "Market Movers India — Top Stock Gainers & Losers | NSE BSE",
  description:
    "Track top gainers and losers across NIFTY 500 stocks. Filter by 1 week, 1 month, 3 months, 6 months, YTD or 1 year. Powered by daily price data from NSE and BSE.",
  keywords: [
    "market movers India",
    "top gainers NSE today",
    "top losers NSE today",
    "top gainers BSE",
    "top losers BSE",
    "best performing stocks India",
    "worst performing stocks India",
    "stock gainers India",
    "stock losers India",
    "NIFTY 500 top gainers",
    "NSE top movers",
    "BSE top movers",
    "top performing stocks India 1 month",
    "top performing stocks India 3 months",
    "multibagger stocks India",
    "biggest losers NSE",
    "stock price returns India",
    "best stocks to buy India",
    "stock screener India gainers",
    "52 week high stocks India",
    "52 week low stocks India",
    "YTD gainers India",
    "market winners losers India",
  ],
  alternates: { canonical: canonical(URL_PATH) },
  openGraph: {
    ...SOCIAL_CARD_DEFAULTS,
    title: "Market Movers India — Top Gainers & Losers",
    description:
      "Top gainers and losers across NSE & BSE — filter by 1W, 1M, 3M, 6M, YTD or 1Y returns.",
    url: canonical(URL_PATH),
  },
  twitter: {
    card: "summary_large_image",
    title: "Market Movers India — Top Gainers & Losers",
    description:
      "Track top-performing and worst-performing stocks across NIFTY 500.",
  },
  robots: { index: true, follow: true },
};

const FAQ_ITEMS = [
  {
    q: "How are the top gainers and losers calculated?",
    a: "We compute the percentage change in adjusted closing price (split and bonus-adjusted) between the start of the chosen period and the most recent trading day. Using adjusted prices ensures that corporate actions like stock splits or bonus issues don't distort the return numbers.",
  },
  {
    q: "Which stocks are covered?",
    a: "All NIFTY 500 constituents and an extended universe of ~1,080 NSE/BSE-listed companies tracked by The Core India Earnings Tracker. Tickers are cross-referenced with our earnings universe so you can click through to each company's financial results.",
  },
  {
    q: "How often is price data updated?",
    a: "End-of-day prices are updated every weekday at 4:15 PM IST (30 minutes after NSE close). Intraday or real-time prices are not available on this page — all returns are based on official closing prices.",
  },
  {
    q: "What does 'YTD' mean here?",
    a: "Year-to-date (YTD) shows the return from January 1 of the current calendar year to the most recent trading day. It resets every January 1.",
  },
  {
    q: "Why does a stock sometimes disappear from the list when I switch periods?",
    a: "A stock only appears if we have a valid price for both the period's start date and the most recent trading day. Newly listed stocks, stocks that were suspended, or those with data gaps may not appear for longer periods.",
  },
];

export default function MarketMoversLayout({ children }: { children: React.ReactNode }) {
  const base = siteUrl();
  const url  = canonical(URL_PATH);

  const breadcrumbLd = buildBreadcrumbLd([
    { name: "Dashboard", url: `${base}/` },
    { name: "Market Movers", url },
  ]);

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    name: "Market Movers India — Top Gainers & Losers",
    description:
      "Top stock gainers and losers across NSE and BSE for 1W, 1M, 3M, 6M, YTD and 1Y periods.",
    url,
    isPartOf: { "@id": `${base}/#website` },
    inLanguage: "en-IN",
  };

  return (
    <>
      <JsonLd data={breadcrumbLd} />
      <JsonLd data={collectionLd} />
      {children}
      <div className="container-core pb-12">
        <FaqBlock
          title="Frequently asked about Market Movers"
          items={FAQ_ITEMS}
        />
      </div>
    </>
  );
}
