// Small helpers shared by every /api route. These are the input-validation
// chokepoints — every `?param=` the client sends must pass through one of
// these before it touches Supabase or the filesystem.
import { NextResponse } from "next/server";

const SHORT_CACHE = "public, s-maxage=60, stale-while-revalidate=300";
const LONG_CACHE  = "public, s-maxage=600, stale-while-revalidate=1800";

export function jsonOk<T>(data: T, init?: ResponseInit & { cache?: "short" | "long" }) {
  const { cache, ...rest } = init ?? {};
  return NextResponse.json({ ok: true, data }, {
    ...rest,
    headers: {
      "Cache-Control": cache === "long" ? LONG_CACHE : SHORT_CACHE,
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
