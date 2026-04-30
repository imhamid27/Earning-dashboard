/** @type {import('next').NextConfig} */

// ---------------------------------------------------------------------------
// Security headers — applied site-wide via Next's middleware config.
// Kept here (not in middleware.ts) so Edge/CDN can cache + serve them
// without waking an Edge function.
//
// CSP notes:
//   - `default-src 'self'`           everything same-origin unless listed
//   - Google Fonts CSS + font files  (stylesheet + font load)
//   - Google Analytics gtag.js       (script + collect endpoint + tracker pixel)
//   - thecore.in logo                (the brand wordmark in the header)
//   - Supabase PostgREST endpoint    (client-side fetches from the anon key)
//   - img-src 'self' data:           inline SVG / base64 allowed
//   - no script-src 'unsafe-eval'    Next 14 doesn't need it in prod
// ---------------------------------------------------------------------------
const SUPABASE_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

// Google Analytics hosts — split into three directives because gtag
// loads JS from one domain, POSTs analytics beacons to another, and
// can fire a 1×1 tracker pixel to a third. Without ALL of them whitelisted
// the browser silently blocks the request and GA records nothing.
const GA_SCRIPT_SRC  = "https://www.googletagmanager.com";
const GA_CONNECT_SRC = "https://www.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net";
const GA_IMG_SRC     = "https://www.google-analytics.com https://www.googletagmanager.com";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline' ${GA_SCRIPT_SRC}`,   // Next hydration + gtag.js
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  `img-src 'self' data: https://www.thecore.in ${GA_IMG_SRC}`,
  `connect-src 'self' ${SUPABASE_HOST} ${GA_CONNECT_SRC}`,
  "upgrade-insecure-requests"
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy",   value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "interest-cohort=()",        // opt out of FLoC / Topics
      "browsing-topics=()",
      "fullscreen=(self)"
    ].join(", ")
  },
  // Cross-origin isolation: conservative defaults for a data dashboard.
  { key: "Cross-Origin-Opener-Policy",   value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" }
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,    // drop the `X-Powered-By: Next.js` fingerprint
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.thecore.in" }
    ]
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      },
      {
        // Aggressively cache the static favicon + fonts + JS chunks.
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" }
        ]
      },
      {
        source: "/icon.png",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" }
        ]
      }
    ];
  }
};

module.exports = nextConfig;
