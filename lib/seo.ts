// Shared SEO/AEO helpers — title templates, descriptions, JSON-LD builders.
// Centralised so every page produces consistent metadata for crawlers and
// answer engines (Google, Bing, Perplexity, ChatGPT Browse, AI Overviews).

import { siteUrl } from "@/lib/site";

// Active reporting quarter — duplicated from page-level constants so this
// module has no React imports and can be used from server components.
export const ACTIVE_QUARTER = process.env.NEXT_PUBLIC_DEFAULT_QUARTER || "Q4 FY26";

/** Convert a fiscal label like "Q4 FY26" into the human/calendar form. */
export function quarterToCalendar(q: string): string {
  const m = /^Q([1-4])\s*FY(\d{2})$/.exec(q.trim());
  if (!m) return q;
  const fq = Number(m[1]);
  const fyEnd = 2000 + Number(m[2]);
  const map: Record<number, [string, number]> = {
    1: ["Apr–Jun", fyEnd - 1],
    2: ["Jul–Sep", fyEnd - 1],
    3: ["Oct–Dec", fyEnd - 1],
    4: ["Jan–Mar", fyEnd],
  };
  const [label, year] = map[fq];
  return `${label} ${year}`;
}

/** Strip ALL-CAPS shouting and corporate suffixes for cleaner display. */
export function cleanCompanyName(raw: string): string {
  if (!raw) return "";
  let s = raw
    .trim()
    .replace(/\s+(Limited|Ltd\.?|Inc\.?|Corp\.?|Corporation|PLC|LLP)\b.*$/i, "")
    .trim();
  if (/^[A-Z0-9 &\.\-\/]+$/.test(s) && s.length > 3) {
    s = s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
  }
  return s;
}

/** Canonical URL builder — always normalises through siteUrl(). */
export function canonical(path: string): string {
  const base = siteUrl();
  if (!path.startsWith("/")) path = "/" + path;
  return `${base}${path}`;
}

/**
 * FAQPage JSON-LD builder. Pass an array of {q, a} pairs and we wrap them
 * in the schema.org/FAQPage envelope. AEO-critical: AI engines lift these
 * Q&A blocks verbatim into answers when they match user queries.
 */
export function buildFaqLd(items: Array<{ q: string; a: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

/** Standard breadcrumb builder. Trailing item gets the canonical URL. */
export function buildBreadcrumbLd(
  trail: Array<{ name: string; url: string }>
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: t.url,
    })),
  };
}

/**
 * ItemList JSON-LD — for upcoming earnings list, top tickers, etc.
 * Each item has a name + url; AI engines surface ItemList as
 * "list-style" answers (e.g. "Top 10 IT companies reporting this week").
 */
export function buildItemListLd(
  name: string,
  description: string,
  items: Array<{ name: string; url: string }>
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    description,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      url: it.url,
    })),
  };
}

/**
 * Default OG / Twitter card defaults. Re-used by every per-page
 * generateMetadata so social previews look identical across routes
 * unless the page overrides specific fields.
 */
export const SOCIAL_CARD_DEFAULTS = {
  type: "website" as const,
  siteName: "India Earnings Tracker",
  locale: "en_IN",
};
