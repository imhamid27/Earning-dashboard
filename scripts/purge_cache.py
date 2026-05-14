"""
CloudFront cache-invalidation helper for ingestion scripts.

After fetch_results.py, nse_results.py, bse_results.py etc. land a fresh
quarter row, call purge_for_ticker(ticker) so the CDN edge drops its
stale /api/dashboard, /api/company/[ticker], etc. The very next reader
gets the new numbers instead of waiting for the s-maxage TTL.

Two transport options:

  1. PREFERRED — hit the dashboard's /api/cache-purge admin endpoint.
     Keeps AWS credentials in one place (the Next deployment), and the
     ingestion script only needs CACHE_PURGE_SECRET, not AWS keys.

  2. FALLBACK — talk to CloudFront's CreateInvalidation API directly via
     boto3. Used when the dashboard isn't reachable from the ingestion
     box (e.g. local dev). Requires boto3 + AWS credentials in the
     ingestion env.

Both functions return (ok: bool, message: str). They never raise —
ingestion shouldn't fail because the CDN didn't accept an invalidation.

Env vars consumed:
  NEXT_PUBLIC_SITE_URL              = https://earnings.thecore.in (for mode 1)
  CACHE_PURGE_SECRET                = shared secret matching the Next route (mode 1)
  AWS_CLOUDFRONT_DISTRIBUTION_ID    = e.g. E1A2B3C4D5E6F7 (mode 2 only)
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  (mode 2 only)
  AWS_DEFAULT_REGION                = us-east-1 (CloudFront control plane)
"""

from __future__ import annotations

import os
import time
from typing import Iterable

import requests


# ---- Mode 1: hit the dashboard's admin endpoint ----------------------------

def purge_for_ticker(ticker: str, timeout: float = 8.0) -> tuple[bool, str]:
    """Tell the Next /api/cache-purge endpoint to invalidate edges for
    this ticker. Safe to call from any ingestion script — env-var-driven,
    no AWS creds required on the ingestion side."""
    base = (os.environ.get("NEXT_PUBLIC_SITE_URL") or "").rstrip("/")
    secret = os.environ.get("CACHE_PURGE_SECRET")
    if not base or not secret:
        return False, "NEXT_PUBLIC_SITE_URL / CACHE_PURGE_SECRET not set"

    url = f"{base}/api/cache-purge"
    try:
        r = requests.post(
            url,
            headers={
                "X-Purge-Secret": secret,
                "Content-Type": "application/json",
            },
            json={"ticker": ticker},
            timeout=timeout,
        )
    except requests.RequestException as e:
        return False, f"network: {e}"

    if r.status_code == 200:
        try:
            body = r.json()
            data = body.get("data", {})
            return True, (
                f"purged {data.get('purged', 0)} paths"
                + (f" (invalidation {data.get('invalidation_id')})"
                   if data.get('invalidation_id') else "")
                + (" [CDN skipped: env not configured]"
                   if data.get('skipped') else "")
            )
        except Exception:
            return True, "ok"
    return False, f"http {r.status_code}: {r.text[:200]}"


def purge_paths(paths: Iterable[str], timeout: float = 8.0) -> tuple[bool, str]:
    """Same as purge_for_ticker but for an explicit path list. Each entry
    must start with '/' (e.g. '/api/dashboard'). Wildcards OK: '/api/*'."""
    base = (os.environ.get("NEXT_PUBLIC_SITE_URL") or "").rstrip("/")
    secret = os.environ.get("CACHE_PURGE_SECRET")
    if not base or not secret:
        return False, "NEXT_PUBLIC_SITE_URL / CACHE_PURGE_SECRET not set"

    payload = {"paths": list(paths)}
    if not payload["paths"]:
        return True, "no-op (empty path list)"

    try:
        r = requests.post(
            f"{base}/api/cache-purge",
            headers={"X-Purge-Secret": secret, "Content-Type": "application/json"},
            json=payload,
            timeout=timeout,
        )
    except requests.RequestException as e:
        return False, f"network: {e}"

    if r.status_code == 200:
        return True, "ok"
    return False, f"http {r.status_code}: {r.text[:200]}"


# Back-compat alias for existing call sites that still say `purge_urls`.
purge_urls = purge_paths


# ---- Mode 2: direct CloudFront CreateInvalidation (fallback) ---------------

def purge_direct(paths: Iterable[str]) -> tuple[bool, str]:
    """Bypass the Next API and talk to CloudFront directly via boto3.
    Useful for local dev where the dashboard isn't reachable, or for
    ops-side mass invalidations.

    Requires AWS credentials in env (AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY
    or an attached IAM role) and AWS_CLOUDFRONT_DISTRIBUTION_ID."""
    dist_id = os.environ.get("AWS_CLOUDFRONT_DISTRIBUTION_ID")
    if not dist_id:
        return False, "AWS_CLOUDFRONT_DISTRIBUTION_ID not set"

    try:
        import boto3  # noqa: WPS433  (lazy import; not all deploys need this)
    except ImportError:
        return False, "boto3 not installed (pip install boto3)"

    cleaned = sorted({
        p if p.startswith("/") else "/" + p
        for p in paths
        if p
    })
    if not cleaned:
        return False, "no valid paths"

    # CloudFront control plane lives in us-east-1; the distribution ID is
    # global but the API endpoint is regional.
    client = boto3.client("cloudfront", region_name="us-east-1")
    try:
        resp = client.create_invalidation(
            DistributionId=dist_id,
            InvalidationBatch={
                "Paths": {"Quantity": len(cleaned), "Items": cleaned},
                "CallerReference": f"purge-direct-{int(time.time()*1000)}",
            },
        )
    except Exception as e:
        return False, f"boto3 error: {type(e).__name__}: {e}"

    inv_id = resp.get("Invalidation", {}).get("Id", "?")
    return True, f"invalidated {len(cleaned)} paths (id={inv_id})"


# ---- Convenience: ingestion drivers call this at the end -------------------

def purge_for_tickers(tickers: Iterable[str], pause: float = 0.25) -> None:
    """Invalidate edge cache for a batch of tickers, with a small pause
    between calls so we don't spam the API. Logs but never raises —
    purge failures must NOT crash an ingestion run."""
    seen = sorted(set(tickers))
    for t in seen:
        ok, msg = purge_for_ticker(t)
        marker = "✓" if ok else "·"
        print(f"  cache-purge {marker} {t}: {msg}")
        time.sleep(pause)


if __name__ == "__main__":
    # CLI form: python scripts/purge_cache.py TCS.NS RELIANCE.NS
    import sys
    args = sys.argv[1:]
    if not args:
        print("usage: purge_cache.py <ticker> [<ticker> ...]")
        sys.exit(2)
    purge_for_tickers(args)
