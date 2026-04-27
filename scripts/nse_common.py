"""
Shared NSE HTTP client.

NSE (National Stock Exchange of India) exposes unofficial JSON endpoints that
power nseindia.com itself — same ones news outlets hit. They require:

1. A realistic browser TLS fingerprint (Python's plain `requests` is blocked
   at the edge; we use `curl_cffi` which impersonates Chrome).
2. A warm session: you must visit a regular HTML page first so NSE issues
   cookies (`nsit`, `AKA_A2`, `_abck`, `ak_bmsc`, `bm_sz`), THEN you can
   hit the API with those cookies.
3. Appropriate Referer / Accept headers.

Keep calls under ~2 req/sec — NSE throttles aggressively and the cookie can
expire after a few minutes of inactivity.

Endpoints used in this project
------------------------------
- /api/event-calendar?index=equities
    Forthcoming board meetings (includes result announcement dates).

- /api/corporates-financial-results?index=equities&period=Quarterly&symbol=<SYM>
    Historical quarterly filings index per company. Each row includes a link
    to the raw XBRL filing (under the `xbrl` key).

- nsearchives.nseindia.com/corporate/xbrl/...xml
    The actual financial filing. We parse revenue / net profit / EPS from it.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone, timedelta
from typing import Any

# ---------------------------------------------------------------------------
# IST date helpers — GitHub Actions runners are UTC, but all Indian exchange
# calendars store dates in IST (UTC+5:30). Use these instead of date.today()
# so comparisons against announcement_date work correctly across the midnight
# IST boundary (18:30–19:00 UTC = 00:00–00:30 IST next day).
# ---------------------------------------------------------------------------

_IST = timezone(timedelta(hours=5, minutes=30))

def today_ist() -> str:
    """Return today's date in IST as a YYYY-MM-DD string."""
    return datetime.now(_IST).date().isoformat()

def days_ago_ist(days: int) -> str:
    """Return the date N days ago (IST) as YYYY-MM-DD."""
    return (datetime.now(_IST) - timedelta(days=days)).date().isoformat()

try:
    from curl_cffi import requests as cffi_requests
except ImportError as e:
    raise ImportError(
        "curl_cffi is required to talk to NSE (they block plain requests). "
        "Install with: pip install curl_cffi"
    ) from e


NSE_BASE = "https://www.nseindia.com"
NSE_ARCHIVES = "https://nsearchives.nseindia.com"

# Prime-visit URLs. NSE is pathological about cookies — each API endpoint
# often wants its "own" HTML page visited first. We keep a map of hints.
PRIMERS: dict[str, str] = {
    "/api/event-calendar":               "/companies-listing/corporate-filings-event-calendar",
    "/api/corporates-financial-results": "/companies-listing/corporate-filings-financial-results",
}

DEFAULT_TIMEOUT = 25
DEFAULT_RPS = float(os.environ.get("NSE_RPS", "2"))
_DELAY_S = 1.0 / max(DEFAULT_RPS, 0.1)

_session = None
_last_call = 0.0
_primed_paths: set[str] = set()


def _get_session():
    """Return a single curl_cffi session with Chrome impersonation."""
    global _session
    if _session is None:
        _session = cffi_requests.Session(impersonate="chrome")
        # Baseline headers — overridden per request where needed.
        _session.headers.update({
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": f"{NSE_BASE}/",
        })
    return _session


def _throttle() -> None:
    global _last_call
    elapsed = time.time() - _last_call
    if elapsed < _DELAY_S:
        time.sleep(_DELAY_S - elapsed)
    _last_call = time.time()


def _ensure_primed(api_path: str) -> None:
    """Hit a regular HTML page so NSE sets cookies. Only does this once per
    API path per process."""
    primer = PRIMERS.get(api_path)
    if not primer or primer in _primed_paths:
        return
    s = _get_session()
    _throttle()
    s.get(NSE_BASE + primer, timeout=DEFAULT_TIMEOUT)
    _primed_paths.add(primer)


def _is_transient(err: Exception) -> bool:
    """Transient network errors that are worth retrying (DNS blips, TCP
    resets, connection timeouts). We do NOT retry 4xx responses."""
    msg = str(err).lower()
    return any(s in msg for s in (
        "resolve host", "getaddrinfo", "timeout", "timed out",
        "connection reset", "connection aborted", "failed to perform",
        "curl: (6)", "curl: (7)", "curl: (28)", "curl: (35)", "curl: (52)", "curl: (56)",
    ))


def nse_get(api_path: str, params: dict[str, Any] | None = None) -> Any:
    """GET a NSE JSON endpoint. Handles priming, throttling, and up to 4
    retries with exponential backoff on transient network failures."""
    _ensure_primed(api_path)
    s = _get_session()

    url = api_path if api_path.startswith("http") else f"{NSE_BASE}{api_path}"
    last_err: Exception | None = None
    for attempt in range(4):
        _throttle()
        try:
            resp = s.get(url, params=params or {}, timeout=DEFAULT_TIMEOUT)
            if resp.status_code == 200 and "json" in (resp.headers.get("content-type") or "").lower():
                text = resp.text.strip()
                if not text:
                    return None
                return resp.json()
            # Likely cookie expired — re-prime and retry.
            _primed_paths.clear()
            _ensure_primed(api_path)
            last_err = RuntimeError(f"non-JSON response (status {resp.status_code})")
        except Exception as e:
            last_err = e
            if not _is_transient(e):
                raise
        # Exponential backoff: 2s, 4s, 8s, 16s.
        time.sleep((2 ** attempt) * 2)
    if last_err:
        raise last_err
    return None


def nse_get_text(url: str) -> str:
    """Fetch an archive URL (XBRL XML) as plain text, with retry."""
    s = _get_session()
    last_err: Exception | None = None
    for attempt in range(4):
        _throttle()
        try:
            resp = s.get(url, timeout=DEFAULT_TIMEOUT)
            resp.raise_for_status()
            return resp.text
        except Exception as e:
            last_err = e
            if not _is_transient(e):
                raise
            time.sleep((2 ** attempt) * 2)
    if last_err:
        raise last_err
    return ""
