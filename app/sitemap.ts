import type { MetadataRoute } from "next";
import { supabaseServer } from "@/lib/supabase";
import { siteUrl } from "@/lib/site";

// Sitemap generated at request time (not cached at build) so newly added
// companies appear in the index within minutes. Capped at 2,000 company
// entries — well within Google's 50,000-URL/sitemap limit, and far above
// the current ticker count.
//
// Two key signals beyond just listing URLs:
//
// 1. lastmod accuracy. Google de-prioritises sitemaps that claim every
//    URL was updated "right now" on every fetch — it reads as spam.
//    We use the actual freshest signal available per page:
//      - homepage / live trackers: ~now (legitimately updates often)
//      - sector / calendar pages: current day (their content snapshot
//        rolls forward daily)
//      - per-company pages: latest fetched_at from quarterly_financials
//        for that ticker, falling back to companies.updated_at, falling
//        back to a fixed sentinel timestamp. This way "TCS just filed
//        Q4 FY26" naturally bumps its lastmod and triggers Google's
//        re-crawler.
//
// 2. priority weighting. CloudFront / Bing / Yandex use this hint to
//    decide crawl budget allocation. Bellwethers (~15 large-caps that
//    drive most search traffic) get 0.9; broader Nifty 500-ish names
//    get 0.7; smaller long-tail tickers get 0.5.
//
// Note on /earnings/* aliases: these are SEO-friendly URLs that redirect
// to /q4, /sectors, /company/[ticker]. We list them in the sitemap so
// search engines discover both forms; alternates → canonical metadata
// tells them which version is authoritative.

const BELLWETHERS = new Set([
  "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "INFY.NS", "ICICIBANK.NS",
  "ITC.NS", "HINDUNILVR.NS", "SBIN.NS", "BHARTIARTL.NS", "LT.NS",
  "BAJFINANCE.NS", "HCLTECH.NS", "KOTAKBANK.NS", "MARUTI.NS",
  "ASIANPAINT.NS",
]);

// Conservative fallback for missing lastmod data: today's date at 00:00
// UTC. Better than `new Date()` (which leaks request time) and better
// than a fixed epoch (which would scream "abandoned" to crawlers).
function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();
  const today = todayUtc();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1.0,
    },
    {
      url: `${base}/q4`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.95,
    },
    {
      url: `${base}/upcoming`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${base}/sectors`,
      lastModified: today,
      changeFrequency: "daily",
      priority: 0.85,
    },
    // SEO alias paths (/earnings/q4-fy26, /earnings/sectors, etc.) used
    // to be listed here for crawler discoverability. They've been
    // removed because next.config.js now emits proper 308 redirects for
    // those paths to their canonical destinations — listing them here
    // would just give crawlers redirect-only URLs to follow, polluting
    // the sitemap's freshness signal. The canonical URLs (above) are
    // the only entries that should be in the sitemap.
  ];

  try {
    const sb = supabaseServer();

    // Pull the active company universe + the latest fetched_at per ticker
    // in one round-trip-per-table. Doing this as two queries keeps the
    // SQL simple; the join is done in JS below.
    const [companiesQ, latestQ] = await Promise.all([
      sb
        .from("companies")
        .select("ticker,updated_at,market_cap_bucket")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(2000),
      sb
        .from("quarterly_financials")
        .select("ticker,fetched_at")
        .order("fetched_at", { ascending: false })
        .limit(8000),
    ]);

    if (companiesQ.error || !companiesQ.data) return staticRoutes;

    // Latest fetched_at per ticker. quarterly_financials may have up to
    // ~8 rows per ticker (one per quarter); we only want the most-recent
    // fetched_at, which the DESC ordering above guarantees is the first
    // row we see per ticker.
    const latestByTicker = new Map<string, string>();
    for (const r of (latestQ.data ?? []) as Array<{ ticker: string; fetched_at: string }>) {
      if (!latestByTicker.has(r.ticker)) {
        latestByTicker.set(r.ticker, r.fetched_at);
      }
    }

    const companyRoutes: MetadataRoute.Sitemap = companiesQ.data.map((company) => {
      // Lastmod priority order:
      //   1. quarterly_financials.fetched_at (the row that actually
      //      changes when fresh data lands — strongest signal)
      //   2. companies.updated_at (catches universe/metadata changes)
      //   3. todayUtc() fallback (never claim "right now" if we have no
      //      real signal — that's the spam pattern crawlers downweight).
      const lastmodRaw =
        latestByTicker.get(company.ticker) ??
        company.updated_at ??
        null;
      const lastModified = lastmodRaw ? new Date(lastmodRaw) : today;

      // Priority by market-cap bucket. LARGE-cap names see the most
      // search traffic; SMALL-cap long tail can sit lower without
      // hurting discoverability (they're still in the sitemap, just
      // lower in crawl-budget priority).
      let priority = 0.7; // default for mid-cap / unknown
      if (BELLWETHERS.has(company.ticker)) {
        priority = 0.9;
      } else if (company.market_cap_bucket === "LARGE") {
        priority = 0.85;
      } else if (company.market_cap_bucket === "SMALL") {
        priority = 0.5;
      }

      return {
        url: `${base}/company/${encodeURIComponent(company.ticker)}`,
        lastModified,
        changeFrequency: "daily",
        priority,
      };
    });

    return [...staticRoutes, ...companyRoutes];
  } catch {
    return staticRoutes;
  }
}
