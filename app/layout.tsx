import "./globals.css";
import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

// The Core's web CSS uses Mona Sans (body + UI) + Arvo (serif accent). We
// load both via a direct Google Fonts stylesheet link — next/font's Google
// provider in 14.x doesn't yet ship Mona Sans in its manifest.

// Favicon is picked up automatically from `app/icon.png` — sourced from
// the official brand kit (Core_Icon_Black.png). No `icons` override needed.
export const metadata: Metadata = {
  title: "India Earnings Tracker — The Core",
  description:
    "Quarterly earnings tracker for listed Indian companies. Revenue and profit trends, sector comparison, and company-level detail pages."
};

// Google Analytics measurement ID. Hardcoded here (not read from env) so
// the tag fires identically across every environment — matches the exact
// snippet Google provides in the GA4 dashboard.
const GA_MEASUREMENT_ID = "G-RBFXGWE6YW";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
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
