import "./globals.css";
import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { siteUrl } from "@/lib/site";

// The Core's web CSS uses Mona Sans (body + UI) + Arvo (serif accent). We
// load both via a direct Google Fonts stylesheet link — next/font's Google
// provider in 14.x doesn't yet ship Mona Sans in its manifest.

// Favicon is picked up automatically from `app/icon.png` — sourced from
// the official brand kit (Core_Icon_Black.png). No `icons` override needed.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "India Earnings Tracker | Quarterly Results, Q4 Earnings, Upcoming Filings",
    template: "%s | India Earnings Tracker"
  },
  description:
    "Track quarterly results for listed Indian companies with revenue, profit, sector trends, upcoming earnings dates, and company-level filing detail.",
  keywords: [
    "India earnings tracker",
    "Indian company results",
    "quarterly results India",
    "Q4 FY26 results",
    "NSE earnings",
    "BSE earnings",
    "upcoming results calendar India",
    "company quarterly earnings India"
  ],
  // No global canonical override — Next.js resolves canonical per-page
  // from metadataBase + the current route. Overriding to "/" here would
  // make every route (including /company/TCS.NS) claim its canonical is
  // the homepage, which is wrong.
  verification: {
    google: "elEikoaT79XYIePNYMSacPcU6RL4w4QCBtQeHU3rhcQ"
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1
    }
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "India Earnings Tracker",
    title: "India Earnings Tracker",
    description:
      "Track quarterly earnings, upcoming result dates, sector growth, and company filing detail for listed Indian companies."
  },
  twitter: {
    card: "summary_large_image",
    title: "India Earnings Tracker",
    description:
      "Track quarterly earnings, upcoming result dates, sector growth, and company filing detail for listed Indian companies."
  },
  category: "finance"
};

// Google Analytics measurement ID. Hardcoded here (not read from env) so
// the tag fires identically across every environment — matches the exact
// snippet Google provides in the GA4 dashboard.
const GA_MEASUREMENT_ID = "G-RBFXGWE6YW";

// Computed once at module load — same value used by metadataBase above.
const SITE_URL = siteUrl();

// JSON-LD graph injected in <head> for every page.
// Organization + WebSite give AI answer engines (Google AI Overviews,
// Perplexity, ChatGPT Browse) reliable facts about who publishes this
// data and what the site covers. The @id URIs are reused by page-level
// schemas as typed references.
const SITE_SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      "name": "The Core",
      "url": "https://thecore.in",
      "logo": {
        "@type": "ImageObject",
        "url": `${SITE_URL}/icon.png`,
        "width": 512,
        "height": 512
      },
      "sameAs": ["https://thecore.in"]
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      "url": `${SITE_URL}/`,
      "name": "India Earnings Tracker",
      "description": "Track quarterly results for listed Indian companies — revenue, profit, sector trends, upcoming earnings dates, and company-level filing detail.",
      "publisher": { "@id": `${SITE_URL}/#organization` },
      "inLanguage": "en-IN",
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": `${SITE_URL}/company/{ticker}`
        },
        "query-input": "required name=ticker"
      }
    },
    {
      "@type": "DataCatalog",
      "@id": `${SITE_URL}/#datacatalog`,
      "name": "India Listed Company Earnings",
      "description": "Quarterly revenue, net profit, operating profit, and EPS for NSE/BSE-listed Indian companies, sourced from exchange filings.",
      "url": `${SITE_URL}/`,
      "provider": { "@id": `${SITE_URL}/#organization` },
      "license": "https://thecore.in",
      "dataset": {
        "@type": "Dataset",
        "name": "Indian Company Quarterly Financials",
        "description": "Revenue, net profit, operating profit, and EPS per quarter for 1,000+ listed Indian companies.",
        "temporalCoverage": "2020/..",
        "spatialCoverage": {
          "@type": "Place",
          "name": "India",
          "geo": { "@type": "GeoShape", "addressCountry": "IN" }
        },
        "creator": { "@id": `${SITE_URL}/#organization` },
        "distribution": {
          "@type": "DataDownload",
          "contentUrl": `${SITE_URL}/`,
          "encodingFormat": "text/html"
        }
      }
    }
  ]
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* AEO: Organisation + WebSite + DataCatalog — tells AI answer
            engines (Google AI Overviews, Perplexity, ChatGPT Browse) who
            publishes this data and what the site covers. Must be in <head>
            so it's present in the very first byte of HTML served to crawlers
            that don't wait for React to hydrate. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: SITE_SCHEMA }}
        />

        {/* Preconnect speeds up the first font byte noticeably. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Mona+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=Arvo:wght@400;700&display=swap"
        />

        {/* Google Analytics — the exact snippet GA4 provides.
            Raw <script> tags in <head> so gtag fires on the first byte of
            HTML, before React hydrates. That's the most compatible
            rendering path: browsers with strict tracking settings, slow
            connections that never hydrate, and search-engine crawlers that
            don't execute React all still see the same tag. */}
        <script
          async
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_MEASUREMENT_ID}');
            `,
          }}
        />
      </head>
      <body>
        <Header />
        <main className="min-h-[calc(100vh-140px)]">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
