"""
Cloudflare cache-purge helper for ingestion scripts.

After fetch_results.py, nse_results.py, bse_results.py etc. land a fresh
quarter row, call purge_for_ticker(ticker) so the CDN edge drops its
stale /api/dashboard, /api/company/[ticker], etc. The very next reader
gets the new numbers instead of waiting for the s-maxage TTL.

Two transport options:
  1. Hit the dashboard's /api/cache-purge admin endpoint (PREFERRED —
     keeps Cloudflare credentials in one place, the Next deployment).
  2. Hit Cloudflare's API directly (fallback for scripts that can't
     reach the dashboard, e.g. local dev).

Env vars consumed:
  NEXT_PUBLIC_SITE_URL   = https://earnings.thecore.in
  CACHE_PURGE_SECRET     = shared secret matching the Next API route
  CLOUDFLARE_ZONE_ID     = (only for direct mode)
  CLOUDFLARE_API_TOKEN   = (only for direct mode)

Both functions return (ok: bool, message: str). They never raise —
ingestion shouldn't fail because the CDN didn't accept a purge.
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
    no Cloudflare creds required client-side."""
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
            return True, (
                f"purged {body['data'].get('purged', 0)} URLs"
                f"{' (CF skipped: env not configured)' if body['data'].get('skipped') else ''}"
            )
        except Exception:
            return True, "ok"
    return False, f"http {r.status_code}: {r.text[:200]}"


def purge_urls(urls: Iterable[str], timeout: float = 8.0) -> tuple[bool, str]:
    """Same as purge_for_ticker but for an explicit URL list."""
    base = (os.environ.get("NEXT_PUBLIC_SITE_URL") or "").rstrip("/")
    secret = os.environ.get("CACHE_PURGE_SECRET")
    if not base or not secret:
        return False, "NEXT_PUBLIC_SITE_URL / CACHE_PURGE_SECRET not set"

    payload = {"urls": list(urls)}
    if not payload["urls"]:
        return True, "no-op (empty url list)"

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


# ---- Mode 2: direct Cloudflare API call (fallback) -------------------------

def purge_direct(urls: Iterable[str]) -> tuple[bool, str]:
    """Bypass the Next API and talk to Cloudflare directly. Useful for
    one-off local invocations or for scripts that can't reach the
    deployed dashboard."""
    zone = os.environ.get("CLOUDFLARE_ZONE_ID")
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not zone or not token:
        return False, "CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN not set"

    cleaned = sorted({u for u in urls if u.startswith(("http://", "https://"))})
    if not cleaned:
        return False, "no absolute URLs to purge"

    # CF free plan: max 30 URLs per request — batch.
    purged = 0
    for i in range(0, len(cleaned), 30):
        batch = cleaned[i : i + 30]
        try:
            r = requests.post(
                f"https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"files": batch},
                timeout=10,
            )
        except requests.RequestException as e:
            return False, f"network: {e}"

        if r.status_code != 200:
            return False, f"http {r.status_code}: {r.text[:200]}"
        purged += len(batch)

    return True, f"purged {purged} URLs"


# ---- Convenience: ingestion drivers call this at the end -------------------

def purge_for_tickers(tickers: Iterable[str], pause: float = 0.25) -> None:
    """Purge edge cache for a batch of tickers, with a small pause between
    calls so we don't spam CF (and so the receiving Next instance doesn't
    queue too many concurrent purges). Logs but never raises — purge
    failures must not crash an ingestion run."""
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
