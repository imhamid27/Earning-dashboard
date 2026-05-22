// POST /api/cache-purge
//
// Admin endpoint called by ingestion scripts after a filing lands. Does
// TWO things in one call:
//
//   1. CloudFront invalidation — flushes the CDN edge cache so the next
//      reader fetches fresh numbers from origin.
//   2. IndexNow push — nudges Bing / Yandex / Seznam / Naver to re-crawl
//      the affected pages, so search results show updated content
//      within minutes instead of waiting days for organic re-crawl.
//
// Both are best-effort: if either is misconfigured (env vars not set),
// the endpoint succeeds with `skipped: true` for that channel. Ingestion
// scripts never fail because cache invalidation or search indexing was
// down.
//
// Auth model: shared-secret in a header (X-Purge-Secret).
//
// Body shapes:
//   { ticker: "TCS.NS" }                  → standard ticker-change set
//   { paths:  ["/api/foo", "/api/bar"] }  → explicit path list
//   { ticker: "TCS.NS", paths: [...] }    → both
//
// Wildcards supported in paths, e.g. "/api/*" or "/company/*". CloudFront
// invalidates by path; IndexNow ignores any path containing `*` (search
// engines can't crawl wildcards).

import { NextRequest } from "next/server";
import { jsonOk, jsonError } from "@/lib/api";
import { purgeCdn, pathsForTickerChange } from "@/lib/cdn";
import { submitToIndexNow, urlsForTickerIndex } from "@/lib/indexnow";
import { siteUrl } from "@/lib/site";

// Never cache the purge endpoint itself.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const expected = process.env.CACHE_PURGE_SECRET;
  if (!expected) {
    // Without a configured secret, refuse to act. Deliberately strict —
    // otherwise an attacker could DoS the origin by repeatedly purging.
    return jsonError("cache-purge secret not configured", 503);
  }

  const presented = req.headers.get("x-purge-secret") || "";
  // Constant-time-ish comparison via length check + per-char xor.
  if (presented.length !== expected.length) {
    return jsonError("forbidden", 403);
  }
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) return jsonError("forbidden", 403);

  let body: { ticker?: string; paths?: string[]; urls?: string[] };
  try {
    body = await req.json();
  } catch {
    return jsonError("body must be JSON", 400);
  }

  // ── Build CDN-invalidation path list (path-only; CloudFront is
  // path-based within a distribution) and IndexNow URL list (full absolute
  // URLs; same-host only).
  const cdnPaths: string[] = [];
  const indexUrls: string[] = [];
  const base = siteUrl();

  if (body.ticker && typeof body.ticker === "string") {
    cdnPaths.push(...pathsForTickerChange(body.ticker));
    indexUrls.push(...urlsForTickerIndex(body.ticker));
  }

  if (Array.isArray(body.paths)) {
    for (const p of body.paths) {
      if (typeof p !== "string") continue;
      cdnPaths.push(p);
      // Only push to IndexNow if it's a real crawlable HTML path (no
      // wildcards, no API endpoints — search engines don't index those).
      if (!p.includes("*") && !p.startsWith("/api/")) {
        indexUrls.push(`${base}${p.startsWith("/") ? p : "/" + p}`);
      }
    }
  }

  if (Array.isArray(body.urls)) {
    for (const u of body.urls) {
      if (typeof u !== "string") continue;
      cdnPaths.push(u);
      if (!u.includes("*") && !u.includes("/api/")) {
        indexUrls.push(u.startsWith("http") ? u : `${base}${u}`);
      }
    }
  }

  if (cdnPaths.length === 0) {
    return jsonError("body must include ticker, paths, or urls", 400);
  }

  // Run both pushes in parallel; either failing doesn't block the other.
  const [cdnResult, indexResult] = await Promise.all([
    purgeCdn(cdnPaths),
    submitToIndexNow(indexUrls),
  ]);

  // CDN failure is the more serious one (it means readers see stale
  // numbers). Surface it as the error if both happened.
  if (!cdnResult.ok) {
    return jsonError(cdnResult.error, 502);
  }

  return jsonOk(
    {
      // CloudFront result
      cdn: {
        purged: cdnResult.purged,
        skipped: "skipped" in cdnResult ? cdnResult.skipped : false,
        reason: "reason" in cdnResult ? cdnResult.reason : null,
        invalidation_id: "invalidationId" in cdnResult ? cdnResult.invalidationId : null,
      },
      // IndexNow result (Bing / Yandex / Seznam / Naver)
      index: {
        ok: indexResult.ok,
        submitted: indexResult.ok && "submitted" in indexResult ? indexResult.submitted : 0,
        skipped: indexResult.ok && "skipped" in indexResult ? indexResult.skipped : false,
        reason: indexResult.ok && "reason" in indexResult ? indexResult.reason : null,
        error: !indexResult.ok ? indexResult.error : null,
      },
      total_requested_paths: cdnPaths.length,
      total_index_urls: indexUrls.length,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
