// Cloudflare cache-purge helper.
//
// Why: when ingestion lands a fresh quarterly result, the CDN's edge copy
// of /api/dashboard, /api/q4-announcements, /api/companies/[ticker] etc.
// is now stale. Without a purge, readers wait for the s-maxage TTL
// (60s–60min depending on tier) before seeing the new numbers — fine for
// passive browsing, bad when the user is actively refreshing because TCS
// just reported.
//
// How: the cron scripts (Python + this Next API route) hit CF's purge API
// with a list of URL prefixes. CF marks those edge entries as stale; the
// next request triggers a fresh origin fetch and re-caches.
//
// Auth: needs a Cloudflare API token scoped to the zone with
//   Zone → Cache Purge → Purge
// permission only. Create at
//   https://dash.cloudflare.com/profile/api-tokens
// Save to CLOUDFLARE_API_TOKEN. Save the zone ID (visible on the zone
// overview page) to CLOUDFLARE_ZONE_ID.
//
// Gracefully degrades: if the env vars aren't set, purgeCdn() logs a
// debug line and returns ok. This keeps local dev + non-CF deployments
// (e.g. before DNS migration) working unchanged.

const PURGE_URL = (zoneId: string) =>
  `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;

export type PurgeResult =
  | { ok: true; purged: number; skipped: false }
  | { ok: true; purged: 0; skipped: true; reason: string }
  | { ok: false; error: string };

/**
 * Purge a list of URLs from the Cloudflare edge cache.
 *
 * URLs must be absolute — CF rejects relative paths. Pass them in the
 * exact form the edge sees them (including scheme + host).
 *
 * Cloudflare's free plan allows up to 30 URLs per request; we batch in
 * chunks of 30 so callers can pass arbitrarily many without thinking.
 */
export async function purgeCdn(urls: string[]): Promise<PurgeResult> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const token  = process.env.CLOUDFLARE_API_TOKEN;

  if (!zoneId || !token) {
    return {
      ok: true,
      purged: 0,
      skipped: true,
      reason: "CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN not configured",
    };
  }
  if (!urls.length) {
    return { ok: true, purged: 0, skipped: true, reason: "no URLs" };
  }

  // De-duplicate + drop relative URLs; CF rejects them silently otherwise.
  const cleaned = Array.from(new Set(urls.filter((u) => /^https?:\/\//i.test(u))));
  if (!cleaned.length) {
    return { ok: false, error: "no absolute URLs passed; CF requires scheme+host" };
  }

  // Chunk for the 30-URL/request free-plan ceiling.
  const CHUNK = 30;
  let purged = 0;
  for (let i = 0; i < cleaned.length; i += CHUNK) {
    const batch = cleaned.slice(i, i + CHUNK);
    const res = await fetch(PURGE_URL(zoneId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files: batch }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `CF purge ${res.status}: ${body.slice(0, 240)}` };
    }
    purged += batch.length;
  }

  return { ok: true, purged, skipped: false };
}

/**
 * Convenience: purge the standard "something changed about ticker X" set.
 * Cron callers (Python / Next API) use this so each one doesn't have to
 * remember which routes are downstream of a filing landing.
 */
export function urlsForTickerChange(siteOrigin: string, ticker: string): string[] {
  const enc = encodeURIComponent(ticker);
  return [
    `${siteOrigin}/api/dashboard`,
    `${siteOrigin}/api/summary`,
    `${siteOrigin}/api/sectors`,
    `${siteOrigin}/api/q4-announcements`,
    `${siteOrigin}/api/upcoming`,
    `${siteOrigin}/api/trends`,
    `${siteOrigin}/api/companies/${enc}`,
    `${siteOrigin}/api/quarterly-results?ticker=${enc}`,
    `${siteOrigin}/company/${enc}`,
    `${siteOrigin}/`,
    `${siteOrigin}/q4`,
    `${siteOrigin}/sectors`,
  ];
}
