// POST /api/cache-purge
//
// Admin endpoint called by ingestion scripts after a filing lands, so
// CloudFront's edge cache drops its stale copy and the very next reader
// fetches the fresh numbers from origin.
//
// Auth model: shared-secret in a header. The ingestion scripts run on
// the same machine that holds the secret. No public access.
//
// Body shapes (paths, not full URLs — CloudFront invalidations are
// path-based within a distribution):
//   { ticker: "TCS.NS" }                  → standard ticker-change purge
//   { paths:  ["/api/foo", "/api/bar"] }  → explicit path list
//   { ticker: "TCS.NS", paths: [...] }    → both (paths appended)
//
// Wildcards supported in paths, e.g. "/api/*" or "/company/*". Useful
// for broad invalidations after bulk ingestion runs.
//
// Returns { ok: true, purged, skipped, invalidationId } on success;
// skipped=true means AWS_CLOUDFRONT_DISTRIBUTION_ID wasn't configured
// (useful before/during the CloudFront cutover).

import { NextRequest } from "next/server";
import { jsonOk, jsonError } from "@/lib/api";
import { purgeCdn, pathsForTickerChange } from "@/lib/cdn";

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

  const collected: string[] = [];

  if (body.ticker && typeof body.ticker === "string") {
    collected.push(...pathsForTickerChange(body.ticker));
  }
  if (Array.isArray(body.paths)) {
    for (const p of body.paths) if (typeof p === "string") collected.push(p);
  }
  // Back-compat: older callers may pass `urls` (the Cloudflare-era shape).
  // purgeCdn() strips scheme+host so absolute URLs still work fine.
  if (Array.isArray(body.urls)) {
    for (const u of body.urls) if (typeof u === "string") collected.push(u);
  }

  if (collected.length === 0) {
    return jsonError("body must include ticker, paths, or urls", 400);
  }

  const result = await purgeCdn(collected);
  if (!result.ok) return jsonError(result.error, 502);

  return jsonOk(
    {
      purged: result.purged,
      skipped: "skipped" in result ? result.skipped : false,
      reason: "reason" in result ? result.reason : null,
      invalidation_id: "invalidationId" in result ? result.invalidationId : null,
      total_requested: collected.length,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
