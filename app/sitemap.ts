import type { MetadataRoute } from "next";
import { supabaseServer } from "@/lib/supabase";
import { siteUrl } from "@/lib/site";

// Sitemap generated at request time (not cached at build) so newly added
// companies appear in the index within minutes. We cap company entries at
// 2,000 — well within Google's 50,000-URL/sitemap limit, and far above the
// current ticker count.
//
// Note on /earnings/* aliases: these are SEO-friendly URLs that redirect
// to the canonical /q4, /sectors, /company/[ticker] routes. We list them
// in the sitemap so search engines discover both forms; the alternates →
// canonical metadata tells them which version is authoritative.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();

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
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.85,
    },
    // SEO alias paths — kept in sitemap so external links to /earnings/*
    // are crawlable, but each redirects to its canonical sibling above.
    {
      url: `${base}/earnings/q4-fy26`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.5,
    },
    {
      url: `${base}/earnings/sectors`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.5,
    },
  ];

  try {
    const sb = supabaseServer();
    const { data, error } = await sb
      .from("companies")
      .select("ticker,updated_at")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(2000);

    if (error || !data) return staticRoutes;

    // Bellwether tickers get a higher priority than the long tail —
    // these are the pages most users land on directly from search.
    const BELLWETHERS = new Set([
      "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "INFY.NS", "ICICIBANK.NS",
      "ITC.NS", "HINDUNILVR.NS", "SBIN.NS", "BHARTIARTL.NS", "LT.NS",
      "BAJFINANCE.NS", "HCLTECH.NS", "KOTAKBANK.NS", "MARUTI.NS",
      "ASIANPAINT.NS",
    ]);

    const companyRoutes: MetadataRoute.Sitemap = data.map((company) => ({
      url: `${base}/company/${encodeURIComponent(company.ticker)}`,
      lastModified: company.updated_at ? new Date(company.updated_at) : now,
      changeFrequency: "daily",
      priority: BELLWETHERS.has(company.ticker) ? 0.9 : 0.7,
    }));

    return [...staticRoutes, ...companyRoutes];
  } catch {
    return staticRoutes;
  }
}
