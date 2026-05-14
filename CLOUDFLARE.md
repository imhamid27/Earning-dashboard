# Cloudflare CDN Setup

Putting Cloudflare's free CDN in front of `earnings.thecore.in` is the single biggest perf win available, for two reasons:

1. **It lets `s-maxage` actually work.** The per-route directives in `lib/api.ts` (60s / 600s / 3600s) need an edge that honours them — without one, only browsers cache, and that only helps repeat visitors. With Cloudflare, origin RPS drops 70–90% in steady state.
2. **It fixes a broken origin compression path.** Direct curl against the production origin currently returns `Content-Length: 88421` on the homepage with no `Content-Encoding` — Coolify's Traefik proxy is blocking the Accept-Encoding negotiation between client and Next. Local testing confirms Next 16 standalone DOES compress HTML at the Node layer (88KB → 14KB), so the breakage is in Traefik, not Next. Rather than chase that down at Traefik level, Cloudflare's edge brotli/gzip negotiates with the client directly and serves compressed payloads end-to-end. The origin-to-CF leg stays uncompressed, but that's a fat datacenter link where bandwidth is cheap.

The dashboard code is already prepped for this. What's left is the DNS + dashboard config + env vars. Allow ~30 min of clicking, plus DNS propagation (typically 5 min to 24 h).

---

## Setup path: subdomain delegation (no parent-zone migration)

The main `thecore.in` site currently runs through CloudFront (managed by someone else) and the DNS is on GoDaddy (`ns11.domaincontrol.com` / `ns12.domaincontrol.com`). We don't migrate the whole zone — we delegate only the `earnings` subdomain to Cloudflare, leaving everything else in GoDaddy/CloudFront untouched.

The trick: Cloudflare lets you add a subdomain as its own zone, and GoDaddy lets you add NS records that point that subdomain at Cloudflare's nameservers. Two small DNS edits in GoDaddy, no impact on `thecore.in` or `www`.

---

## Step 1 — Add `earnings.thecore.in` as a Cloudflare zone

1. Create a Cloudflare account at <https://dash.cloudflare.com/sign-up>. Free plan is fine.
2. Click **Add a site** → enter `earnings.thecore.in` (the subdomain, NOT just `thecore.in`) → select **Free**.
3. Cloudflare assigns two nameservers to this zone. They'll look like `aria.ns.cloudflare.com` and `jay.ns.cloudflare.com`. Note both values exactly.
4. The zone will sit in **"Pending Nameserver Update"** until Step 2 is done.

## Step 2 — Delegate the subdomain in GoDaddy

1. Sign in to GoDaddy → My Products → DNS for `thecore.in`.
2. **Find any existing `A` or `CNAME` record for `earnings`** (currently points to `46.225.160.82`, your Coolify VPS). **Delete it.** This is mandatory — otherwise GoDaddy keeps answering for `earnings.thecore.in` and Cloudflare's delegation gets ignored.
3. **Add two `NS` records:**
   ```
   Type: NS    Name: earnings    Value: <cf-nameserver-1>.ns.cloudflare.com    TTL: 1 Hour
   Type: NS    Name: earnings    Value: <cf-nameserver-2>.ns.cloudflare.com    TTL: 1 Hour
   ```
   (Use the exact values Cloudflare gave you in Step 1.)
4. Save.

Propagation usually takes 5–30 min. Cloudflare emails when it confirms the delegation is live and the zone activates.

While propagation is running, the dashboard at `earnings.thecore.in` may briefly serve from the Coolify VPS directly (old cached DNS) before flipping to Cloudflare — there's no downtime, just a transition.

## Step 3 — Recreate the A record inside Cloudflare

Once Cloudflare confirms the zone is active:

1. Open the `earnings.thecore.in` zone in Cloudflare.
2. Go to **DNS → Records → Add record**:
   ```
   Type:  A
   Name:  @                        (this represents earnings.thecore.in itself)
   IPv4:  46.225.160.82            (your Coolify VPS IP)
   Proxy status: Proxied (orange cloud)   ← critical
   TTL:   Auto
   ```
3. Save.

The orange cloud is what makes Cloudflare actually intercept traffic — without it the request bypasses the edge.

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

On the Cloudflare overview page for the **`earnings.thecore.in`** zone (not the parent `thecore.in` — we don't have that zone), scroll down. **Zone ID** is in the right sidebar. Copy it.

### `CLOUDFLARE_API_TOKEN`

1. Top right → **My Profile → API Tokens → Create Token**.
2. **Custom token**:
   - Name: `earnings-dashboard-cache-purge`
   - Permissions: **Zone → Cache Purge → Purge** (this one only — least privilege).
   - Zone Resources: **Include → Specific zone → earnings.thecore.in**.
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
