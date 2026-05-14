// Small helpers shared by every /api route. These are the input-validation
// chokepoints — every `?param=` the client sends must pass through one of
// these before it touches Supabase or the filesystem.
import { NextResponse } from "next/server";

// Cache tiers — chosen against expected churn for each endpoint type.
// Each tier has BOTH `max-age` (browser cache) and `s-maxage` (CDN cache).
// We deliberately make the browser tier short so a user pressing refresh
// rarely sees stale data; the CDN tier is longer because a CDN purges
// edge data on a global revalidate cycle. `stale-while-revalidate` keeps
// the response served instantly while the next request triggers a refresh
// in the background — critical for keeping perceived latency low.
//
// Setting `Vary: Accept-Encoding` is mandatory once we encourage caching:
// without it a cache that's seen a gzipped response could replay it to a
// client that didn't ask for gzip, and vice versa.
const CACHE_TIERS = {
  // Live-ish: prices, market context — refresh every minute at the edge,
  // every 10 s in the browser.
  live:   "public, max-age=10, s-maxage=60, stale-while-revalidate=120",
  // Default: typical API reads that turn over every few minutes (sectors,
  // dashboard, summary). Browser caches briefly; CDN caches a minute.
  short:  "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
  // Slow-changing: filings land a handful of times per hour at most.
  long:   "public, max-age=120, s-maxage=600, stale-while-revalidate=1800",
  // Effectively static: quarter list, glossary, bellwether index.
  // Hour-long edge cache, day-long stale window.
  static: "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
} as const;

export type CacheTier = keyof typeof CACHE_TIERS;

export function jsonOk<T>(data: T, init?: ResponseInit & { cache?: CacheTier }) {
  const { cache, ...rest } = init ?? {};
  // Serialize manually + set Content-Length explicitly. Background: Next 16's
  // App Router `NextResponse.json()` uses Web Streams under the hood and
  // emits responses with `Transfer-Encoding: chunked` instead of a
  // Content-Length header. CloudFront's auto-compression then refuses to
  // gzip/brotli the response because it can't verify the body falls in the
  // required 1 KB – 10 MB range. The dashboard's stress test on 2026-05-13
  // showed http_req_receiving p95 at 4.4 s, dominated by uncompressed JSON
  // — fixing this is the single biggest remaining wire-byte win.
  //
  // By converting the JSON to a Uint8Array up front, we get a known-length
  // body that CloudFront treats as a static byte buffer; auto-compression
  // kicks in and JSON drops ~80% on the wire.
  const body = JSON.stringify({ ok: true, data });
  const bodyBuf = new TextEncoder().encode(body);
  return new NextResponse(bodyBuf, {
    ...rest,
    status: rest.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(bodyBuf.byteLength),
      "Cache-Control": CACHE_TIERS[cache ?? "short"],
      // Critical pair with Cache-Control: lets intermediate caches store
      // gzip+brotli+identity variants separately. Without Vary, a CDN
      // can replay a gzipped response to a client that didn't ask for it.
      "Vary": "Accept-Encoding",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      ...(rest.headers ?? {})
    }
  });
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

// ---------------------------------------------------------------------------
// IST date helpers — all date comparisons in API routes must use IST so that
// "today" on the server matches "today" in India (UTC+5:30). Without this,
// from 00:00–05:29 IST the server thinks it's still the previous day, and
// filings that landed after midnight IST won't appear in the Today band.
// ---------------------------------------------------------------------------

/** Current date in IST as a YYYY-MM-DD string. */
export function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** A date N calendar days before today (IST) as YYYY-MM-DD. */
export function daysAgoIST(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// Validate a ticker string. Accepts letters, digits, dot, dash, ampersand.
// Rejects anything else — prevents path-traversal into Supabase filter
// expressions + shell metacharacters into spawned Python scripts.
export function cleanTicker(input: string | null): string | null {
  if (!input) return null;
  const t = input.trim().toUpperCase();
  return /^[A-Z0-9.&-]{1,20}$/.test(t) ? t : null;
}

export function cleanQuarterLabel(input: string | null): string | null {
  if (!input) return null;
  const t = input.trim().toUpperCase().replace(/\s+/g, " ");
  return /^Q[1-4]\s*FY\d{2,4}$/.test(t) ? t.replace(/\s+/g, " ") : null;
}

// Escape PostgREST wildcard metacharacters so a search term like "100%" or
// "Reliance_Industries" doesn't trigger a wildcard match. PostgREST treats
// `%` and `_` specially inside ilike(); we backslash-escape both.
export function escapeIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/[%_]/g, (m) => "\\" + m);
}

// Search term sanitiser — length cap + ilike escape.
export function cleanSearch(input: string | null): string | null {
  if (!input) return null;
  const t = input.trim().slice(0, 60);
  if (t.length === 0) return null;
  // Allow letters, digits, spaces, dots, dashes, ampersands, apostrophes.
  if (!/^[A-Za-z0-9 .&'\-]+$/.test(t)) return null;
  return escapeIlike(t);
}

// Sector values are chosen from a known controlled vocabulary, but since
// they come in via querystring we still constrain to the expected shape.
export function cleanSector(input: string | null): string | null {
  if (!input) return null;
  const t = input.trim().slice(0, 40);
  if (!/^[A-Za-z ]+$/.test(t)) return null;
  return t;
}

// Market-cap bucket — fixed enum.
export function cleanBucket(input: string | null): "LARGE" | "MID" | "SMALL" | null {
  if (!input) return null;
  const t = input.trim().toUpperCase();
  return t === "LARGE" || t === "MID" || t === "SMALL" ? t : null;
}
