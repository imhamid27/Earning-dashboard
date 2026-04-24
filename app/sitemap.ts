import type { MetadataRoute } from "next";
import { supabaseServer } from "@/lib/supabase";
import { siteUrl } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1
    },
    {
      url: `${base}/upcoming`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9
    },
    {
      url: `${base}/q4`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9
    },
    {
      url: `${base}/sectors`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8
    }
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

    const companyRoutes: MetadataRoute.Sitemap = data.map((company) => ({
      url: `${base}/company/${encodeURIComponent(company.ticker)}`,
      lastModified: company.updated_at ? new Date(company.updated_at) : now,
      changeFrequency: "daily",
      priority: 0.7
    }));

    return [...staticRoutes, ...companyRoutes];
  } catch {
    return staticRoutes;
  }
}
