// Google Analytics — loaded via next/script for optimal performance.
//
// Why next/script (not a raw <script> tag):
//   - `afterInteractive` strategy defers loading until the page is
//     interactive, so Analytics never blocks the first paint or
//     slows a reader who lands on the dashboard during market hours.
//   - Next.js handles client-side route changes correctly; a plain
//     <script> in the document would only fire once on initial load
//     and miss all SPA navigations.
//   - Deduped automatically if a page tries to include it twice.
//
// Privacy / compliance notes for an Indian retail audience:
//   - We only send the default page_view event (no PII, no custom
//     dimensions that could identify individuals).
//   - If we later need consent (GDPR for EU visitors, DPDP Act in
//     India), wrap the <Script> tags in a consent-gated check —
//     the component's structure is a clean seam to add that.
//
// The GA measurement ID is read from NEXT_PUBLIC_GA_ID so staging
// and production can have separate streams, but falls back to the
// production ID when unset (typical for a single-environment deploy).

import Script from "next/script";

const DEFAULT_GA_ID = "G-RBFXGWE6YW";

export default function GoogleAnalytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_ID || DEFAULT_GA_ID;

  // No-op when explicitly disabled (useful in E2E tests or local dev
  // via NEXT_PUBLIC_GA_ID=off). An empty string still enables the
  // default ID, matching production behaviour.
  if (gaId.toLowerCase() === "off") return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}');
        `}
      </Script>
    </>
  );
}
