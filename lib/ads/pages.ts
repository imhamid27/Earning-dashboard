// Page groups a sponsored card can appear on. The key is what an offer stores.
export const AD_PAGES = [
  { key: "home", label: "Home", path: "/" },
  { key: "q4", label: "Q4 results", path: "/q4" },
  { key: "sectors", label: "Sectors", path: "/sectors" },
  { key: "upcoming", label: "Upcoming results", path: "/upcoming" },
  { key: "company", label: "Company pages", path: "/company/" },
  { key: "compare", label: "Compare", path: "/compare" },
  { key: "market-movers", label: "Market movers", path: "/market-movers" },
  { key: "results", label: "Quarter results", path: "/results/" },
  { key: "year-in-review", label: "Year in review", path: "/year-in-review/2026" },
] as const;

export const PAGE_KEYS: string[] = AD_PAGES.map((p) => p.key);

// Maps a URL path to its page key, or null where no card belongs (admin, api, unknown).
export function pageKeyForPath(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return "home";
  if (p.startsWith("/company/")) return "company";
  if (p.startsWith("/results/")) return "results";
  if (p.startsWith("/year-in-review")) return "year-in-review";
  const hit = AD_PAGES.find((x) => x.path === p);
  return hit ? hit.key : null;
}
