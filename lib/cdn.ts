// AWS CloudFront cache-invalidation helper.
//
// Why: when ingestion lands a fresh quarterly result, the CloudFront edge
// copy of /api/dashboard, /api/q4-announcements, /api/companies/[ticker],
// etc. is now stale. Without an invalidation, readers wait for the
// s-maxage TTL (60s–60min depending on tier) before seeing the new
// numbers — fine for passive browsing, bad when the user is actively
// refreshing because TCS just reported.
//
// How: cron scripts (Python via boto3 + this Next API route) call
// CloudFront's CreateInvalidation API with a list of path patterns.
// CloudFront marks those edge entries as stale globally; the next request
// triggers a fresh origin fetch and re-caches.
//
// CloudFront invalidation paths are PATH-only (no scheme/host), and
// support wildcards. e.g. "/api/dashboard" or "/api/*" or "/company/*".
// Free tier: 1,000 paths/month included, then $0.005/path. Wildcards
// count as one path each, so "/api/*" is a cheap way to nuke the whole
// API tree.
//
// Auth: needs IAM permissions on cloudfront:CreateInvalidation for the
// distribution. The simplest IAM policy:
//   {
//     "Effect": "Allow",
//     "Action": "cloudfront:CreateInvalidation",
//     "Resource": "arn:aws:cloudfront::<account-id>:distribution/<dist-id>"
//   }
// Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY in the Next deployment
// env. Or if Coolify runs on EC2 with an instance-attached role, no
// keys needed — the SDK picks up the role automatically.
//
// Gracefully degrades: if AWS_CLOUDFRONT_DISTRIBUTION_ID isn't set,
// purgeCdn() returns ok with skipped=true. Keeps local dev + non-CDN
// deployments working unchanged.

import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";

export type PurgeResult =
  | { ok: true; purged: number; skipped: false; invalidationId?: string }
  | { ok: true; purged: 0; skipped: true; reason: string }
  | { ok: false; error: string };

// Singleton client. The AWS SDK auto-discovers credentials from env vars
// (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) or an EC2 instance role,
// in that order. Region is fixed to us-east-1 because CloudFront's
// control plane only lives there — invalidations target any
// distribution from us-east-1 regardless of where the edges are.
let _cf: CloudFrontClient | null = null;
function client(): CloudFrontClient {
  if (_cf) return _cf;
  _cf = new CloudFrontClient({ region: "us-east-1" });
  return _cf;
}

/**
 * Invalidate a list of path patterns at the CloudFront edge.
 *
 * Paths must start with `/` and may use `*` as a wildcard. Examples:
 *   "/api/dashboard"   → exact path
 *   "/api/*"           → entire API tree (cheaper, broader)
 *   "/company/TCS.NS"  → one company page
 *
 * Querystring is NOT part of the invalidation path — CloudFront
 * invalidates all variants of a path regardless of querystring.
 *
 * One CloudFront invalidation request can target up to 3,000 paths;
 * we batch in chunks of 1,000 to stay well within that.
 */
export async function purgeCdn(paths: string[]): Promise<PurgeResult> {
  const distId = process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID;

  if (!distId) {
    return {
      ok: true,
      purged: 0,
      skipped: true,
      reason: "AWS_CLOUDFRONT_DISTRIBUTION_ID not configured",
    };
  }
  if (!paths.length) {
    return { ok: true, purged: 0, skipped: true, reason: "no paths" };
  }

  // Normalise: strip scheme+host if a caller passed a full URL, dedupe,
  // and ensure each entry starts with "/". CloudFront rejects relative
  // paths or full URLs.
  const cleaned = Array.from(
    new Set(
      paths
        .map((p) => p.replace(/^https?:\/\/[^/]+/i, ""))
        .map((p) => (p.startsWith("/") ? p : "/" + p))
        .filter((p) => p.length > 0)
    )
  );
  if (!cleaned.length) {
    return { ok: false, error: "no valid path patterns after normalisation" };
  }

  const CHUNK = 1000;
  let purged = 0;
  let firstId: string | undefined;
  for (let i = 0; i < cleaned.length; i += CHUNK) {
    const batch = cleaned.slice(i, i + CHUNK);
    try {
      // CallerReference must be unique per request — using a timestamp+
      // batch-index combination so retries of the same logical purge get
      // distinct IDs from AWS's perspective.
      const callerReference = `purge-${Date.now()}-${i}`;
      const out = await client().send(
        new CreateInvalidationCommand({
          DistributionId: distId,
          InvalidationBatch: {
            CallerReference: callerReference,
            Paths: { Quantity: batch.length, Items: batch },
          },
        })
      );
      purged += batch.length;
      if (!firstId) firstId = out.Invalidation?.Id ?? undefined;
    } catch (err: any) {
      return {
        ok: false,
        error: `CloudFront invalidation failed: ${err?.name ?? "Error"}: ${err?.message ?? String(err)}`,
      };
    }
  }

  return { ok: true, purged, skipped: false, invalidationId: firstId };
}

/**
 * Convenience: the standard "something changed about ticker X" path set.
 * Cron callers (Python / Next API) use this so each one doesn't have to
 * remember which routes are downstream of a filing landing.
 *
 * Note: unlike the Cloudflare version, these are PATHS (no host), since
 * CloudFront invalidations are path-based within a distribution.
 */
export function pathsForTickerChange(ticker: string): string[] {
  const enc = encodeURIComponent(ticker);
  return [
    "/api/dashboard",
    "/api/summary",
    "/api/sectors",
    "/api/q4-announcements",
    "/api/upcoming",
    "/api/trends",
    `/api/companies/${enc}`,
    `/api/quarterly-results*`, // matches both ?ticker= variants
    `/company/${enc}`,
    "/",
    "/q4",
    "/sectors",
  ];
}

// Back-compat alias: older callers (and the Python helper) may still
// reference `urlsForTickerChange(origin, ticker)`. Keep a thin shim that
// ignores the origin arg and returns the new path-based shape.
export function urlsForTickerChange(_origin: string, ticker: string): string[] {
  return pathsForTickerChange(ticker);
}
