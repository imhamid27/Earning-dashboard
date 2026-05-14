# AWS CloudFront Setup

Putting CloudFront in front of `earnings.thecore.in` is the single biggest perf win available:

1. **It lets `s-maxage` actually work.** The per-route directives in `lib/api.ts` (60s / 600s / 3600s) need a CDN edge that honours them. Without one, only browsers cache, and that only helps repeat visitors. With CloudFront, origin RPS drops 70–90% in steady state.
2. **It fixes the broken origin compression.** Direct curl against the production origin currently returns `Content-Length: 88421` on the homepage with no `Content-Encoding` header — Coolify's Traefik proxy is breaking the Accept-Encoding negotiation between client and Next. CloudFront's edge handles brotli/gzip negotiation with clients directly, regardless of what origin sends.

You already have an AWS account separate from whoever runs the existing CloudFront distribution for `thecore.in`. We'll create a **new** distribution in your account, just for `earnings.thecore.in`. The two distributions don't conflict — they front different hostnames.

Allow ~45 min of clicking, plus DNS propagation (5 min–24 h typically).

---

## Why CloudFront works on a subdomain without parent-zone access

CloudFront is per-distribution: you tell it "serve traffic for hostname X" and provide an ACM certificate covering that hostname. The DNS cutover is a single `CNAME` change in GoDaddy — flipping `earnings.thecore.in` from your VPS IP to the CloudFront distribution's `*.cloudfront.net` hostname.

No parent-zone migration. No NS-record delegation. Just one CNAME edit at the DNS provider, which you already have access to.

---

## Step 1 — Request an ACM certificate for `earnings.thecore.in`

CloudFront requires SSL certs in **us-east-1** (N. Virginia), even if you're nowhere near there.

1. AWS Console → Certificate Manager → **make sure region is N. Virginia (us-east-1)** in the top-right region picker.
2. **Request certificate** → Public certificate → Next.
3. Domain names: `earnings.thecore.in` (just this one — no wildcard needed).
4. Validation method: **DNS validation** (faster + auto-renews).
5. Key algorithm: RSA 2048 (default).
6. Request.
7. The cert shows up in "Pending validation". Click into it — under "Domains" you'll see a CNAME record AWS wants you to add to validate ownership. Looks like:
   ```
   Name:  _abc123def456.earnings.thecore.in
   Value: _xyz789.acm-validations.aws.
   ```
8. **In GoDaddy DNS for `thecore.in`**, add a CNAME record with:
   ```
   Type:  CNAME
   Name:  _abc123def456.earnings   ← drop the .thecore.in suffix; GoDaddy adds it
   Value: _xyz789.acm-validations.aws.
   TTL:   1 Hour
   ```
9. ACM polls DNS every few minutes. Within 5–30 min the cert flips to "Issued". Note its **ARN** for later (looks like `arn:aws:acm:us-east-1:123456789012:certificate/...`).

## Step 2 — Create the CloudFront distribution

Console → CloudFront → **Create distribution**.

### Origin

| Field | Value | Notes |
|---|---|---|
| Origin domain | `46.225.160.82` | Your Coolify VPS IP. Type it manually — AWS may not autocomplete a bare IP. |
| Protocol | HTTP only, port 80 | See note below on origin SSL |
| Name | `earnings-coolify-origin` | Anything readable |
| Add custom header | Name `Host`, Value `earnings.thecore.in` | So Coolify's Traefik routes the request to the right virtual host |

**About HTTP origin**: ideally we'd use HTTPS between CloudFront and Coolify, but that needs the Coolify cert to match the Origin Domain (IP address). Since the cert is for `earnings.thecore.in` only, an HTTPS origin would fail TLS verification. Two cleaner options if HTTP origin makes you uneasy:

- (a) Use HTTPS origin with Origin Domain = `earnings.thecore.in` and an "Origin Request Policy" that strips the `Host` header — but this is circular once DNS cuts over (CloudFront would resolve via the very record it's serving). Workaround: add `coolify.earnings.thecore.in` as a separate DNS record pointing directly at `46.225.160.82` (managed in Cloudflare or GoDaddy outside the CloudFront path), get a Coolify cert for that hostname, use it as the origin.
- (b) Just use HTTP at origin. The data is public earnings info — there's no auth, no PII, nothing sensitive between CloudFront's edge and your Coolify VPS. CloudFront-to-client over HTTPS is what matters for users. Most production CloudFront setups in front of public sites do this.

For simplicity, go with **HTTP origin** unless your security model rules it out.

### Default cache behavior

| Field | Value |
|---|---|
| Viewer protocol policy | Redirect HTTP to HTTPS |
| Allowed HTTP methods | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE (need POST for `/api/cache-purge` and `/api/refresh-company`) |
| Cache policy | **CachingOptimized** — honours origin Cache-Control |
| Origin request policy | **AllViewer** — forwards all headers + cookies to origin |
| Response headers policy | (leave unset) |
| Compress objects automatically | **Yes** ← critical, this is the gzip/brotli win |

### Settings

| Field | Value |
|---|---|
| Price class | **Use only North America, Europe, Asia, Middle East, and Africa** (or whatever covers your audience — India is in this tier) |
| Alternate domain name (CNAME) | `earnings.thecore.in` |
| Custom SSL certificate | Pick the ACM cert from Step 1 |
| Security policy | TLSv1.2_2021 (default) |
| Supported HTTP versions | HTTP/2 and HTTP/3 (default) |
| Standard logging | Off (can enable later for analysis) |
| IPv6 | On (default) |

Click **Create distribution**. AWS shows you the distribution ID (`E1A2B3C4D5E6F7`) and the distribution domain (`d1234abcdef.cloudfront.net`). Note both. Distribution takes 5–10 min to fully deploy globally.

## Step 3 — Cut DNS over in GoDaddy

Once the distribution shows **Deployed** in the CloudFront console:

1. GoDaddy → DNS for `thecore.in`.
2. **Delete** the existing `A` record where Name = `earnings` and Value = `46.225.160.82`.
3. **Add a CNAME record:**
   ```
   Type:  CNAME
   Name:  earnings
   Value: d1234abcdef.cloudfront.net.
   TTL:   1 Hour
   ```
4. Save.

DNS propagation typically 5–30 min. During the cutover, some requests may still hit the VPS directly (old DNS cached) and some hit CloudFront — both serve the same content, no downtime.

After cutover, verify with:

```bash
dig earnings.thecore.in
# should show CNAME → d1234abcdef.cloudfront.net → CloudFront IPs

curl -sI https://earnings.thecore.in/ | grep -iE "server|via|x-amz|x-cache"
# expect:
#   via: ... CloudFront
#   x-cache: Miss from cloudfront    (first hit) or Hit from cloudfront
```

## Step 4 — Create an IAM user for cache invalidations

The dashboard's `/api/cache-purge` endpoint needs AWS credentials with permission to invalidate the CloudFront distribution after ingestion lands new data.

1. AWS Console → IAM → **Users** → **Create user**.
2. Name: `earnings-dashboard-purge`.
3. **Skip** "Provide user access to the AWS Management Console" (programmatic only).
4. Next → **Attach policies directly** → **Create policy** in a new tab.

In the policy editor (JSON tab), paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvalidateEarningsDashboardDistribution",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::<YOUR_AWS_ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
    }
  ]
}
```

Replace `<YOUR_AWS_ACCOUNT_ID>` and `<DISTRIBUTION_ID>` (the value from Step 2). Name the policy `EarningsDashboardCachePurge`. Create.

Back in the user creation flow, attach this new policy. Create user.

5. Open the new user → **Security credentials** → **Create access key** → "Application running outside AWS" → confirm.
6. Copy the **Access key ID** and **Secret access key** — secret is shown once only.

## Step 5 — Set env vars in Coolify

In the Coolify app config for the dashboard:

```
AWS_CLOUDFRONT_DISTRIBUTION_ID=E1A2B3C4D5E6F7
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-east-1
CACHE_PURGE_SECRET=<openssl rand -hex 32 — generate fresh>
```

In the ingestion environment (GitHub Actions secrets, or the host running cron):

```
NEXT_PUBLIC_SITE_URL=https://earnings.thecore.in
CACHE_PURGE_SECRET=<same value as above>
```

(The ingestion scripts don't need AWS keys — they call `/api/cache-purge` which has them. Single source of truth.)

Trigger a Coolify redeploy after setting env vars.

## Step 6 — Verify

### Cache MISS then HIT

```bash
# First call — fills the edge cache
curl -sI https://earnings.thecore.in/api/quarters | grep -iE "x-cache|x-amz-cf"

# Second call within the TTL — should be a HIT
curl -sI https://earnings.thecore.in/api/quarters | grep -iE "x-cache|x-amz-cf"
```

Expected on the second call:
```
x-cache: Hit from cloudfront
x-amz-cf-pop: BLR50-C1   (or similar — your nearest CloudFront edge)
age: 12                  (seconds since first cached)
```

### Compression flowing end-to-end

```bash
curl -sI -H "Accept-Encoding: br,gzip" https://earnings.thecore.in/ | grep -iE "content-encoding|content-length"
```

Expected: `content-encoding: br` (or `gzip`) and no full-size `content-length` for the HTML — confirming the edge compressed the response.

### Manual purge sanity check

```bash
curl -X POST https://earnings.thecore.in/api/cache-purge \
     -H "X-Purge-Secret: $CACHE_PURGE_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"ticker": "TCS.NS"}'
```

Expected:
```json
{"ok":true,"data":{"purged":12,"skipped":false,"invalidation_id":"I1A2B3...","total_requested":12}}
```

If you see `"skipped":true`, the Coolify env doesn't have `AWS_CLOUDFRONT_DISTRIBUTION_ID` set yet.

### Re-run the k6 stress test

```
k6 run scripts/earnings-stress.js
```

Expected deltas vs the May 13 run:

| Metric | Before | After |
|---|---|---|
| `http_req_receiving` p95 | 4,428 ms | ~150–300 ms |
| `http_req_duration` p95 | 5,374 ms | ~500–900 ms |
| `http_req_failed` rate | 0.011% | <0.05% |
| Origin RPS at Coolify | 208/s | 20–40/s |

CloudFront's edge handles 80%+ of requests from cache once it warms; only purges + cache-miss requests reach origin.

---

## Optional — wire ingestion to auto-purge

Once env vars are set, add this to the bottom of `scripts/fetch_results.py`, `scripts/nse_results.py`, and `scripts/bse_results.py`, after a successful upsert:

```python
from scripts.purge_cache import purge_for_ticker
ok, msg = purge_for_ticker(ticker)
print(f"  cache-purge: {ok} — {msg}")
```

If env vars aren't set the helper silently no-ops and ingestion proceeds — fail-safe.

---

## Cost

CloudFront free tier (perpetual): 1 TB of data transfer out + 10,000,000 HTTP/HTTPS requests + 2,000,000 CloudFront Function invocations + **1,000 invalidation paths per month**, free.

Beyond free tier (India region):
- Data transfer out: $0.120/GB
- HTTPS requests: $0.0120 per 10,000
- Invalidations: $0.005/path beyond 1,000/mo

For our traffic post-cache (90% edge-served, ~20 RPS origin), monthly cost is typically $5–20 depending on volume. The free tier covers most non-viral use.

---

## Common gotchas

- **Cert region**: ACM cert MUST be in us-east-1 for CloudFront. Cert in another region won't be selectable on the distribution.
- **TTL ceilings**: CachingOptimized policy honours origin `Cache-Control` up to a maximum of 1 year. Our `s-maxage=3600` etc. is well within that.
- **Querystring keys**: CachingOptimized caches per-querystring by default — `/api/quarterly-results?ticker=TCS.NS` and `?ticker=RELIANCE.NS` cache separately. Correct behaviour.
- **POST passes through**: AWS doesn't cache POSTs even with CachingOptimized, so `/api/cache-purge` and `/api/refresh-company` always reach origin — correct.
- **Healthcheck**: the Dockerfile's `HEALTHCHECK CMD` hits `http://127.0.0.1:3000/api/quarters` (loopback inside the container) — bypasses CloudFront, so cache state has no effect on health detection. Already correct in the existing Dockerfile.
- **CSP `connect-src`**: no CloudFront-specific allowance needed; clients connect to `earnings.thecore.in` which is already self-origin.
- **Origin host header**: must be the public hostname (`earnings.thecore.in`), not the IP — otherwise Coolify's Traefik can't route to the right service. Set as a Custom Header in the origin config (Step 2).
