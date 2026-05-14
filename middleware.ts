// Next.js edge middleware.
//
// Currently does one job: rewrite the Cache-Control header for dynamic
// app-router routes that Next would otherwise stamp with
// `private, no-cache, no-store, max-age=0, must-revalidate`.
//
// Why this matters: routes whose layout/page calls Supabase from
// generateMetadata are auto-marked "fully dynamic" by Next. Once a route
// is dynamic, Next emits aggressive no-cache headers — and any CDN
// (CloudFront, Cloudflare, Vercel Edge) sees those and refuses to cache
// the response. The result: every page view round-trips to origin even
// when the page is editorial-shell content that barely changes.
//
// `export const revalidate = N` in the layout is the documented fix, but
// it only works when the dynamic data comes through Next's own fetch()
// API. supabase-js uses raw fetch + custom transport, so Next can't
// memoize it, and the route stays dynamic regardless of revalidate.
//
// Middleware runs AFTER the route handler in the response pipeline (when
// using `NextResponse.next()` to passthrough), so the headers we set here
// override Next's emitted defaults. CloudFront then sees the s-maxage we
// asked for and caches at the edge as intended.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Cache-Control values mirror the tiers in lib/api.ts so origin pages
// and their downstream API calls share a coherent freshness policy.
const TIER_SHORT  = "public, max-age=30, s-maxage=60, stale-while-revalidate=300";
const TIER_LONG   = "public, max-age=120, s-maxage=600, stale-while-revalidate=1800";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;

  // /company/[ticker] — editorial HTML shell (heading, breadcrumbs,
  // FAQ, glossary). Real-time data (latest quarter, live price) is
  // fetched by client-side JS from /api/* which has its own caching,
  // so a 5-min HTML shell cache doesn't affect data freshness for users.
  if (path.startsWith("/company/")) {
    res.headers.set("Cache-Control", TIER_LONG);
    res.headers.set("Vary", "Accept-Encoding");
  }

  // Static-quarter alias redirects — small HTML responses, mostly cacheable.
  if (path.startsWith("/earnings/")) {
    res.headers.set("Cache-Control", TIER_LONG);
  }

  return res;
}

// Apply only to the paths above (and skip API routes which set their own
// headers via lib/api.ts, and Next internals).
export const config = {
  matcher: [
    "/company/:path*",
    "/earnings/:path*",
  ],
};
