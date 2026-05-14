// POST /api/cache-purge
//
// Admin endpoint called by ingestion scripts after a filing lands, so the
// CDN edge cache drops its stale copy and the very next reader fetches the
// fresh numbers from origin.
//
// Auth model: shared-secret in a header. The ingestion scripts run on the
// same machine that holds the secret. No public access.
//
// Body shapes:
//   { ticker: "TCS.NS" }                 -> standard ticker-change purge
//   { urls:   ["https://.../api/foo"] }  -> explicit URL list
//   { ticker: "TCS.NS", urls: [...] }    -> both (URLs appended)
//
// Returns { ok: true, purged, skipped } on success (skipped means CF env
// vars weren't configured — useful before DNS migration).

import { NextRequest } from "next/server";
import { jsonOk, jsonError } from "@/lib/api";
import { purgeCdn, urlsForTickerChange } from "@/lib/cdn";
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

  let body: { ticker?: string; urls?: string[] };
  try {
    body = await req.json();
  } catch {
    return jsonError("body must be JSON", 400);
  }

  const origin = siteUrl();
  const collected: string[] = [];

  if (body.ticker && typeof body.ticker === "string") {
    // Pre-cleaned by the caller; we don't validate further here because
    // the URL builder URL-encodes the value anyway.
    collected.push(...urlsForTickerChange(origin, body.ticker));
  }
  if (Array.isArray(body.urls)) {
    for (const u of body.urls) if (typeof u === "string") collected.push(u);
  }

  if (collected.length === 0) {
    return jsonError("body must include either ticker or urls", 400);
  }

  const result = await purgeCdn(collected);
  if (!result.ok) return jsonError(result.error, 502);

  return jsonOk(
    {
      purged: result.purged,
      skipped: "skipped" in result ? result.skipped : false,
      reason: "reason" in result ? result.reason : null,
      total_requested: collected.length,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
