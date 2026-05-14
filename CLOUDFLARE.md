# Cloudflare CDN Setup

Putting Cloudflare's free CDN in front of `earnings.thecore.in` is the single biggest perf win available — it lets the `s-maxage` directives we already ship (set per route in `lib/api.ts`) actually take effect, dropping origin RPS by 70–90% in steady state.

The dashboard is already prepped for this. What's left is the DNS + dashboard config + env vars. Allow ~30 min of clicking, plus DNS propagation (typically 5 min to 24 h).

---

## Important: this requires migrating `thecore.in` to Cloudflare's nameservers

Cloudflare's free plan operates at the **zone level**, not the subdomain level. To proxy `earnings.thecore.in`, you point the entire `thecore.in` zone at Cloudflare's nameservers. Cloudflare reads your existing DNS records, mirrors them, and only proxies the records you explicitly toggle to "Proxied" (the orange cloud icon). The main `thecore.in` site continues to resolve exactly as today via the same A/CNAME/MX records, untouched.

If you can't migrate the zone (e.g. some other team owns `thecore.in` DNS), Cloudflare's **CNAME-setup plan ($20+/mo on Pro)** or **Cloudflare for SaaS** is the workaround. Or use Bunny CDN / Fastly which support per-hostname CNAME without zone control.

The rest of this doc assumes the zone migration path.

---

## Step 1 — Sign up + add the zone

1. Create a Cloudflare account at <https://dash.cloudflare.com/sign-up>. Free plan is fine.
2. Click **Add a site** → enter `thecore.in` → select **Free**.
3. Cloudflare scans your existing DNS records. Review the list — every record currently active should appear. **Verify the row for `earnings` (subdomain) is present and points at your Coolify VPS.** Adjust if missing.
4. Cloudflare shows you the two nameservers to set at your registrar. Note them down.

## Step 2 — Update nameservers at your domain registrar

1. Log into wherever `thecore.in` was originally bought (GoDaddy, Namecheap, BigRock, Hostinger, etc.).
2. Find the DNS / nameservers section. Replace the existing nameservers with the two Cloudflare gave you.
3. Save. Propagation starts immediately but can take 5 min to 24 h. Cloudflare emails when it detects the change.

While propagation is happening, the main `thecore.in` continues working through the old DNS path; nothing breaks.

## Step 3 — Set proxy mode for `earnings`

Once Cloudflare confirms the zone is active:

1. Open the `thecore.in` zone in Cloudflare dashboard.
2. Go to **DNS → Records**.
3. Find the `earnings` row. Click the cloud icon in the **Proxy status** column so it turns **orange (Proxied)**. This is what makes Cloudflare actually intercept traffic — without it, requests bypass the edge cache.
4. For the apex `thecore.in` and any other subdomains you DON'T want CDN-ified, leave them grey-cloud (DNS only). MX records for email must always be DNS-only.

## Step 4 — Configure caching rules for `earnings.thecore.in`

Cloudflare's default Free plan only caches static assets (images, CSS, JS). It deliberately does NOT cache HTML or `/api/*` JSON by default. We need to override that, but only for the subdomain.

### Caching Rules (free plan path)

1. Go to **Caching → Cache Rules → Create rule**.
2. Rule 1: **Cache `/api/*` responses**
   - **If incoming requests match…**
     - Hostname `equals` `earnings.thecore.in`
     - AND URI Path `starts with` `/api/`
   - **Then…**
     - Eligible for cache: **Yes**
     - Edge TTL: **Use cache-control header from origin**
     - Browser TTL: **Respect origin TTL**
   - Save and deploy.

3. Rule 2: **Cache HTML pages**
   - **If incoming requests match…**
     - Hostname `equals` `earnings.thecore.in`
     - AND URI Path `does not start with` `/api/`
     - AND URI Path `does not start with` `/_next/data/` (Next's per-request RSC payloads)
   - **Then…**
     - Eligible for cache: **Yes**
     - Edge TTL: **Use cache-control header from origin** (we set `s-maxage` per route)
   - Save and deploy.

Cloudflare's "Use cache-control header from origin" tells the edge to honor our `s-maxage` value — that's why the four tiers in `lib/api.ts` (`live` 60s, `short` 60s, `long` 600s, `static` 3600s) start mattering only after this step.

### Speed → Optimization (verify)

1. **Auto Minify**: **Off** for all three (HTML/CSS/JS). We already minify in the Next build; double-minifying can corrupt edge cases.
2. **Brotli**: **On** (default). This is where the biggest single byte saving happens — JSON shrinks 80%+ with brotli vs. raw.
3. **Early Hints**: **On** (default).

## Step 5 — Set up cache-purge env vars

Two values to grab:

### `CLOUDFLARE_ZONE_ID`

On the Cloudflare overview page for `thecore.in`, scroll down. **Zone ID** is in the right sidebar. Copy it.

### `CLOUDFLARE_API_TOKEN`

1. Top right → **My Profile → API Tokens → Create Token**.
2. **Custom token**:
   - Name: `earnings-dashboard-cache-purge`
   - Permissions: **Zone → Cache Purge → Purge** (this one only — least privilege).
   - Zone Resources: **Include → Specific zone → thecore.in**.
3. **Create Token**. Copy the value (shown once).

### Generate `CACHE_PURGE_SECRET`

This is the shared secret between ingestion scripts and `/api/cache-purge`.

```bash
openssl rand -hex 32
```

### Set the env vars

In Coolify (or whatever runs the Next dashboard):

```
CLOUDFLARE_ZONE_ID=<zone id from above>
CLOUDFLARE_API_TOKEN=<token from above>
CACHE_PURGE_SECRET=<openssl output from above>
```

In the ingestion environment (the GitHub Actions secrets if you run scripts there, or `.env` on the host):

```
NEXT_PUBLIC_SITE_URL=https://earnings.thecore.in
CACHE_PURGE_SECRET=<same value as above>
```

(The ingestion scripts hit `/api/cache-purge` rather than Cloudflare directly, so they don't need the CF token — only the dashboard does. Single source of truth.)

## Step 6 — Verify the cache is working

After Coolify redeploys with the new env vars:

### Basic edge-cache hit

```bash
curl -sI https://earnings.thecore.in/api/quarters | grep -iE "cf-cache|cache-control|age"
```

Expected after two consecutive calls (first call: `MISS`, second within the TTL: `HIT`):

```
cache-control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400
cf-cache-status: HIT
age: 12
```

If `cf-cache-status` stays `MISS` indefinitely, the caching rule didn't match — re-check Step 4 rule conditions.

### Compression in flight

```bash
curl -sI -H "Accept-Encoding: br,gzip" https://earnings.thecore.in/api/dashboard | grep -iE "content-encoding|content-length"
```

Expected: `content-encoding: br` (Cloudflare prefers brotli when client accepts it).

### Manual purge sanity check

```bash
curl -X POST https://earnings.thecore.in/api/cache-purge \
     -H "X-Purge-Secret: $CACHE_PURGE_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"ticker": "TCS.NS"}'
```

Expected: `{"ok":true,"data":{"purged":12,"skipped":false,...}}`.

If you see `"skipped":true`, the Next deployment doesn't have `CLOUDFLARE_ZONE_ID`/`CLOUDFLARE_API_TOKEN` set yet.

### Repeat the k6 stress test

The whole reason we did this. After CF is live:

```
k6 run scripts/earnings-stress.js
```

Expected deltas vs the May 13 run:

- `http_req_receiving` p95: 4,428 ms → **~300 ms** (gzip + brotli + edge serving)
- `http_req_duration` p95: 5,374 ms → **~800 ms**
- Failure rate: stays at 0.011%
- Origin RPS at Coolify (in your VPS metrics): drops from ~208/s to **~20–40/s** once the cache warms

---

## Optional: wire ingestion to auto-purge

Once env vars are set, the standard hooks:

```python
# In scripts/fetch_results.py, after a ticker's row is successfully upserted:
from scripts.purge_cache import purge_for_ticker
ok, msg = purge_for_ticker(ticker)
print(f"  cache-purge: {ok} — {msg}")
```

Or for a batch:

```python
from scripts.purge_cache import purge_for_tickers
purge_for_tickers([t for t in successful_tickers])
```

If `CLOUDFLARE_*` env vars are not set, the helper returns `ok, "...not configured"` and ingestion proceeds normally — fail-safe.

---

## Common gotchas

- **CORS-preflight rejection on the purge endpoint**: doesn't happen for server-to-server calls (no `Origin` header). If you ever want to call it from a browser, add the relevant CORS allowance. Don't.
- **Stale data after a purge**: Cloudflare's purge propagates globally in ~30 s. If you see stale numbers for >1 min, check Cloudflare's "Configuration → Cache → Tiered Cache" — disable tiered cache or use the "Purge Everything" button as the nuclear option.
- **Coolify health check at `/api/quarters`**: the Dockerfile's `HEALTHCHECK CMD` hits `/api/quarters`. With CDN caching this is now served from the edge, not Coolify — change the healthcheck to `http://127.0.0.1:3000/api/quarters` (loopback bypasses Cloudflare). Already correct in the existing Dockerfile.
- **CSP `connect-src`**: if you ever add the CF Web Analytics beacon (free, no cookies), append `https://static.cloudflareinsights.com` to the script-src and connect-src directives in `next.config.js`.

---

## Cost

Cloudflare free plan: $0/month for the traffic levels we're operating at (the free plan has soft caps in the hundreds of millions of requests/month). The cache-purge API is unmetered on free.
