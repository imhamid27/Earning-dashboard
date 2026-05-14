// Next.js edge middleware.
//
// Job: cap the Cache-Control header on server-rendered pages so the CDN
// caches them sensibly.
//
// Two distinct problems we're correcting:
//
// 1. Dynamic routes (e.g. /company/[ticker]) — when a route's
//    generateMetadata uses supabase-js (raw transport, not Next's
//    memoized fetch), Next marks it as fully dynamic and emits
//    `Cache-Control: private, no-cache, no-store, max-age=0,
//    must-revalidate`. CloudFront then refuses to cache and every page
//    view round-trips to origin.
//
// 2. Statically-generated routes (e.g. /, /q4, /sectors, /upcoming) —
//    Next's static optimization stamps them with
//    `Cache-Control: s-maxage=31536000` (ONE YEAR at the edge). That's
//    nonsense for an earnings dashboard: every code change requires a
//    manual CloudFront invalidation to ship.
//
// Middleware solves both by rewriting Cache-Control on the way out.
// Setting the value after the route handler runs means our value wins
// over whatever Next emitted by default.
//
// Why both problems land here:
//   - `export const revalidate = N` in the page would fix #2 in theory,
//     but on Free CloudFront + Coolify we want a single source of truth
//     for CDN cache policy, and middleware is the easiest place to put
//     it. Tweaking TTLs becomes one file edit.
//   - For #1 nothing in Next config helps because the dynamic data
//     comes through a non-memoizable transport.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Cache-Control values mirror the tiers in lib/api.ts so origin pages
// and their downstream API calls share a coherent freshness policy.
//
// LONG = 2 min browser / 10 min edge cache / 30 min stale-while-revalidate.
// Suitable for page HTML shells whose content rhythm is "updates a few
// times per hour at most" (filings landing every 2 h, market refreshes
// every ~minute via /api/* which has its own tighter tier).
const TIER_LONG = "public, max-age=120, s-maxage=600, stale-while-revalidate=1800";

// Page paths whose Cache-Control we override. Exact-match set for the
// top-level routes; the dynamic / alias families are caught by
// startsWith() below.
const EXACT_PATHS = new Set<string>(["/", "/q4", "/sectors", "/upcoming"]);

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;

  const shouldRewrite =
    EXACT_PATHS.has(path) ||
    path.startsWith("/company/") ||
    path.startsWith("/earnings/");

  if (shouldRewrite) {
    res.headers.set("Cache-Control", TIER_LONG);
    // Vary: Accept-Encoding lets the CDN store gzip/brotli/identity
    // variants separately. Without it, a CDN that's seen a compressed
    // response could replay it to a client that didn't ask for one.
    res.headers.set("Vary", "Accept-Encoding");
  }

  return res;
}

// Matcher determines which paths trigger middleware at all. Listing them
// explicitly is cheaper than running middleware on every request just to
// fall through. /_next/static/* and /api/* are deliberately excluded —
// _next/static has its own immutable cache headers from next.config.js,
// and /api/* sets its own Cache-Control via lib/api.ts.
export const config = {
  matcher: [
    "/",
    "/q4",
    "/sectors",
    "/upcoming",
    "/company/:path*",
    "/earnings/:path*",
  ],
};
