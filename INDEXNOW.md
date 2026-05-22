# Active Search-Engine Indexing (IndexNow + Google)

Companies-pages-not-indexed is rarely a technical-SEO problem on a well-set-up site (we already pass every basic check: robots, canonical, sitemap, mobile-friendly, rich snippets). It's almost always a **discovery and crawl-budget problem**: search engines crawl at their own pace, and 1,000 newly-listed URLs can take weeks or months to reach all of them.

This doc covers the techniques we use to **actively nudge crawlers** instead of waiting.

---

## 1. IndexNow — instant push to Bing, Yandex, Seznam, Naver

[IndexNow](https://www.indexnow.org/) is a real-time submission protocol jointly supported by Microsoft Bing, Yandex, Seznam, Naver, and a broader IndexNow partner ecosystem. POST a list of URLs to one endpoint and partner crawlers re-fetch within minutes.

Google does **not** directly support IndexNow today. For Google we rely on the sitemap and Search Console (section 3 below). But IndexNow partners represent roughly half of global non-Google search traffic — fast indexing on Bing in particular materially helps discoverability.

### One-time setup

1. **Generate a key:**
   ```bash
   openssl rand -hex 32
   ```
2. **Set the env var** on the Next deployment (Coolify → app → Environment Variables):
   ```
   INDEXNOW_KEY=<the 64-char hex string from step 1>
   ```
3. **Redeploy** so the env var takes effect.
4. **Verify the key endpoint is reachable:**
   ```bash
   curl https://earnings.thecore.in/indexnow.txt
   ```
   Should return the exact key string with status 200. If it returns 404, the env var didn't propagate — re-check Coolify.

### How it fires

The existing `/api/cache-purge` endpoint now does **both** invalidation jobs in one call:

1. CloudFront edge invalidation (was already there)
2. IndexNow push (new)

So any ingestion script that already calls `/api/cache-purge` automatically nudges Bing/Yandex/etc. when fresh data lands. No changes needed in ingestion code.

### Smoke test

```bash
curl -X POST https://earnings.thecore.in/api/cache-purge \
     -H "X-Purge-Secret: $CACHE_PURGE_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"ticker": "TCS.NS"}'
```

Expected response (abbreviated):
```json
{
  "ok": true,
  "data": {
    "cdn":   { "purged": 12, "skipped": false, ... },
    "index": { "ok": true,  "submitted": 5, "skipped": false }
  }
}
```

If `index.skipped: true` with reason `INDEXNOW_KEY not configured`, the env var isn't loaded.

If `index.ok: false` with a 403 error, the key file at `/indexnow.txt` isn't returning the same key string — usually a redeploy fixes it.

### Verifying it worked

The submission is asynchronous on Bing's side; you won't see results in Bing Webmaster Tools immediately. But:

1. **Bing Webmaster Tools → URL inspection** on a submitted URL within ~24 h should show "Discovered" or "Indexed".
2. Bulk indexing throughput on bings should ramp up over the next week as IndexNow submissions accumulate.

---

## 2. Improved sitemap signals (already in code)

The sitemap at `https://earnings.thecore.in/sitemap.xml` now ships:

- **`lastmod` per company** based on actual `quarterly_financials.fetched_at` timestamp — so when TCS files Q4 results, the `lastmod` on `/company/TCS.NS` bumps to that moment, signalling Google to re-crawl.
- **`priority` by market cap**:
  - 0.9 for bellwethers (~15 hand-picked large-caps)
  - 0.85 for other LARGE bucket companies
  - 0.7 for MID-cap default
  - 0.5 for SMALL-cap long tail
- **`changefreq: daily`** for company pages, `hourly` for live trackers (`/`, `/q4`, `/upcoming`)

Why this matters: Google de-prioritises sitemaps that claim every URL was updated "right now" on every fetch (it reads as spam). Real `lastmod` values from your DB make the sitemap a reliable freshness signal.

---

## 3. Google — the things you have to do in the UI

Google does NOT offer a free push API for indexing arbitrary content. (Their Indexing API is restricted to JobPosting and LiveStream markup only.) For Google, the active-nudge toolkit is manual:

### Submit the sitemap

1. Go to [Google Search Console](https://search.google.com/search-console) → property `earnings.thecore.in`.
2. **Sitemaps** in the left nav.
3. Enter `sitemap.xml` and **Submit**.
4. Watch the table for "Success" status. Google starts crawling within hours.

### Request indexing on high-priority URLs

This forces a fresh re-crawl on a specific URL. Quota: ~10–15 URLs per day per property.

1. Search Console → **URL Inspection** (top search bar).
2. Paste a URL like `https://earnings.thecore.in/company/RELIANCE.NS`.
3. Click **Request indexing**. Wait ~10–60 s.
4. Repeat for: homepage, /q4, /sectors, /upcoming, and the top 10 bellwether company pages.

This is the single biggest thing you can do to get the dashboard initially crawled. After the first crawl batch lands, Google's own discovery follows internal links from the bellwethers to other companies.

### Bing Webmaster Tools (parallel setup)

[Bing Webmaster Tools](https://www.bing.com/webmasters) — same flow:
1. Add `earnings.thecore.in` as a site.
2. Verify via the same DNS TXT record method (Bing's UI walks you through it).
3. Submit the sitemap.
4. **Bing also accepts IndexNow submissions** through Webmaster Tools UI directly — but since the IndexNow API (section 1) already pushes there, this is belt-and-braces.

---

## 4. The non-technical accelerants

Beyond protocol-level signals, the things that actually drive Google to crawl deeper are:

- **External backlinks.** A single inbound link from thecore.in's main brand site (e.g. "Track quarterly results on our earnings tracker") materially speeds up discovery of the linked URLs.
- **Social shares.** Sharing a few company-page URLs on LinkedIn / Twitter (X) seeds Google's crawler queue via the public sharing graph.
- **Time.** A fresh domain with no prior crawl history is naturally crawled slowly at first; budget tightens once Google sees the site is healthy and high-quality. Expect 2–6 weeks for full coverage to settle in.

---

## 5. Diagnosing "X pages indexed" gaps

Open Google Search Console → **Pages** report. You'll see categories:

| Category | What it means | Fix |
|---|---|---|
| **Indexed** | Live in Google search | ✓ |
| **Crawled — currently not indexed** | Google saw the URL but decided not to keep it. Usually duplicate-content / thin-content. | Make pages more unique (more server-rendered numbers, distinct intros) |
| **Discovered — currently not indexed** | Google knows the URL exists but hasn't crawled it yet | Wait, or use URL Inspection to force a crawl |
| **Duplicate without user-selected canonical** | Google sees X and Y as duplicates and picked one | Add `<link rel="canonical">` (already done) |
| **Soft 404** | Page returns 200 but Google thinks it looks empty | Add more SSR content (see section 6) |

---

## 6. If many company pages are "Crawled — currently not indexed"

This means Google's spam/duplicate filter is rejecting them. The cause is almost always that 1,000 company pages share too much templated content (same FAQ shape, same glossary, same JSON-LD structure) relative to the unique per-ticker content.

Highest-impact fix: **server-render the latest quarter's actual numbers** on company pages. Right now the layout shows only FAQ + glossary; the actual revenue/profit/EPS values are fetched client-side. Moving the latest-quarter fetch into the server layout means each company page has unique, factual numeric content in the SSR HTML — strong de-duplication signal.

That's a ~20-line change in `app/company/[ticker]/layout.tsx`: fetch the latest `quarterly_financials` row alongside the existing company-metadata fetch, and inline the numbers into the layout's JSX.

This is the recommended next iteration if Search Console reports show widespread "crawled, not indexed" for company pages.
