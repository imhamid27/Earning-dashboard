// IndexNow push helper — actively nudges search-engine crawlers when
// ingestion lands fresh data.
//
// IndexNow is a push protocol jointly supported by Microsoft Bing, Yandex,
// Seznam, Naver, and the broader IndexNow member ecosystem. POST a list of
// URLs and partner crawlers re-fetch within minutes — instead of waiting
// for them to discover changes via their next polling cycle (days to
// weeks for fresh URLs).
//
// Google does NOT directly support IndexNow today; for Google we lean on
// sitemap + Search Console URL Inspection + organic crawling. But IndexNow
// member traffic = roughly half of global search outside Google. Faster
// indexing on those engines is real, immediate value.
//
// Setup (one-time):
//   1. Generate a key:    `openssl rand -hex 32`
//   2. Set INDEXNOW_KEY env var on the deployment to that value.
//   3. The key is exposed at /api/indexnow-key (Next route) — IndexNow
//      partners fetch that URL to verify ownership before accepting the
//      submission.
//   4. Optionally hit the manual ping endpoint to seed the index, or just
//      wait for ingestion to push naturally as filings land.
//
// Gracefully degrades: if INDEXNOW_KEY isn't configured, submitToIndexNow()
// no-ops with skipped=true. Keeps local dev + pre-launch deploys quiet.
//
// Docs: https://www.indexnow.org/documentation

import { siteUrl } from "@/lib/site";

export type IndexNowResult =
  | { ok: true; submitted: number; skipped: false }
  | { ok: true; submitted: 0; skipped: true; reason: string }
  | { ok: false; error: string };

/**
 * Submit a batch of URLs to IndexNow. URLs must be absolute and on the
 * same host as this deployment (IndexNow rejects cross-host submissions).
 * IndexNow accepts up to 10,000 URLs per request — we're nowhere near
 * that, so no chunking needed.
 */
export async function submitToIndexNow(urls: string[]): Promise<IndexNowResult> {
  const key = process.env.INDEXNOW_KEY;
  const base = siteUrl();

  if (!key) {
    return {
      ok: true,
      submitted: 0,
      skipped: true,
      reason: "INDEXNOW_KEY not configured",
    };
  }
  if (!urls.length) {
    return { ok: true, submitted: 0, skipped: true, reason: "no URLs" };
  }

  // Drop relative paths, dedupe, require same host as deployment.
  let host: string;
  try {
    host = new URL(base).host;
  } catch {
    return { ok: false, error: `Invalid site URL: ${base}` };
  }

  const cleaned = Array.from(
    new Set(
      urls
        .filter((u) => /^https?:\/\//i.test(u))
        .filter((u) => {
          try {
            return new URL(u).host === host;
          } catch {
            return false;
          }
        })
    )
  );

  if (!cleaned.length) {
    return {
      ok: false,
      error: "no valid same-host absolute URLs to submit",
    };
  }

  // keyLocation MUST be at the host root (or a parent directory of every
  // submitted URL) — IndexNow rejects submissions for URLs outside the
  // key file's directory with HTTP 422. /indexnow.txt at the root
  // covers everything on the host.
  const keyLocation = `${base}/indexnow.txt`;

  try {
    const res = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        host,
        key,
        keyLocation,
        urlList: cleaned,
      }),
    });

    // IndexNow returns:
    //   200 OK          — accepted
    //   202 Accepted    — key not yet verified, queued
    //   400 Bad Request — bad URLs / wrong host
    //   403 Forbidden   — key file not findable at keyLocation
    //   422 Unprocess.  — URLs don't match host
    //   429 Too Many    — rate limited
    if (res.status === 200 || res.status === 202) {
      return { ok: true, submitted: cleaned.length, skipped: false };
    }

    const body = await res.text().catch(() => "");
    return {
      ok: false,
      error: `IndexNow ${res.status}: ${body.slice(0, 240) || "(empty body)"}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `IndexNow network error: ${err?.message ?? String(err)}`,
    };
  }
}

/**
 * Convenience: build the absolute URL list that should be re-indexed when
 * a single ticker's data changes. Mirrors lib/cdn.ts:pathsForTickerChange
 * but emits full URLs since IndexNow needs them.
 */
export function urlsForTickerIndex(ticker: string): string[] {
  const base = siteUrl();
  const enc = encodeURIComponent(ticker);
  return [
    `${base}/company/${enc}`,
    // Note: we don't submit API endpoints to IndexNow — they're not
    // indexable HTML pages. Only the user-facing HTML routes.
    `${base}/`,
    `${base}/q4`,
    `${base}/sectors`,
    `${base}/upcoming`,
  ];
}
