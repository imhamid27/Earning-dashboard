"""
BSE forthcoming-results calendar → Supabase.

By default only upserts events for companies already in `companies`. Pass
--include-untracked to ALSO create shell rows for small/mid caps from BSE's
feed (marked is_active=false so the ingester doesn't waste requests trying
to fetch their filings until you opt in by flipping the flag).

Uses the real endpoint that bseindia.com's Forth_Results.html page calls:
  GET https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w
  → returns ~250 rows, shape:
      [{
         "scrip_Code":    "500325",
         "short_name":    "RELIANCE",
         "Long_Name":     "Reliance Industries Ltd",
         "meeting_date":  "24 Apr 2026",
         "URL":           "https://www.bseindia.com/..."
      }, ...]

Requires a primed browser session (curl_cffi + Chrome TLS fingerprint) because
BSE blocks plain `requests` at the edge. Run alongside `nse_calendar.py` — the
announcement_events unique key dedupes cleanly across both sources.

Run:
    py scripts/bse_calendar.py
"""

from __future__ import annotations

import argparse
import os
import sys
import traceback
from datetime import date, datetime
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

from curl_cffi import requests as cffi_requests
from supabase import create_client


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

BSE_PAGE = "https://www.bseindia.com/corporates/Forth_Results.html"
BSE_API  = "https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w"


def fetch_bse_calendar() -> list[dict]:
    s = cffi_requests.Session(impersonate="chrome")
    # Prime cookies from the forth_results page itself. Without this, BSE's
    # edge layer redirects the api call to /error_Bse.html.
    s.get(BSE_PAGE, timeout=25)
    r = s.get(
        BSE_API,
        headers={
            "Referer": "https://www.bseindia.com/",
            "Origin":  "https://www.bseindia.com",
            "Accept":  "application/json, text/plain, */*",
        },
        timeout=25,
    )
    r.raise_for_status()
    # Endpoint returns a bare JSON array.
    data = r.json()
    return data if isinstance(data, list) else (data.get("Table") or [])


def parse_bse_date(raw: str) -> date | None:
    """Input format is '20 Apr 2026'."""
    if not raw:
        return None
    for fmt in ("%d %b %Y", "%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw.strip(), fmt).date()
        except ValueError:
            continue
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-untracked", action="store_true",
                    help="Auto-create shell company rows for BSE scrips not already in the DB")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Load every company we already have. Index two ways:
    #   - by bse_scrip   (most reliable when populated)
    #   - by NSE symbol  (BSE `short_name` equals the NSE symbol in ~90% of cases)
    rows = sb.table("companies").select("id,ticker,company_name,bse_scrip") \
           .execute().data or []
    by_scrip: dict[str, dict] = {str(c["bse_scrip"]).zfill(6): c for c in rows if c.get("bse_scrip")}
    by_symbol: dict[str, dict] = {}
    for c in rows:
        sym = (c.get("ticker") or "").split(".")[0].strip().upper()
        if sym:
            by_symbol[sym] = c
    print(f"Indexed {len(by_scrip)} by BSE scrip, {len(by_symbol)} by NSE symbol.")

    print("Fetching BSE forthcoming-results calendar...")
    payload = fetch_bse_calendar()
    print(f"BSE returned {len(payload)} rows.")

    out: list[dict[str, Any]] = []
    skipped_untracked = 0
    created_shells = 0
    matched_by_scrip = 0
    matched_by_symbol = 0
    for raw in payload:
        scrip = str(raw.get("scrip_Code") or "").strip().zfill(6)
        short_name = (raw.get("short_name") or "").strip().upper()
        company = by_scrip.get(scrip)
        if company:
            matched_by_scrip += 1
        else:
            # Fallback: match on the BSE short_name = NSE symbol.
            company = by_symbol.get(short_name) if short_name else None
            if company:
                matched_by_symbol += 1
                # Backfill the bse_scrip on the matched company so future
                # runs use the O(1) scrip lookup.
                try:
                    sb.table("companies").update({"bse_scrip": scrip}).eq("id", company["id"]).execute()
                    company["bse_scrip"] = scrip
                    by_scrip[scrip] = company
                except Exception as e:
                    print(f"[warn] scrip backfill for {short_name}: {e}", file=sys.stderr)
        if not company:
            if not args.include_untracked:
                skipped_untracked += 1
                continue
            # Auto-create a shell company for display in the "Upcoming"
            # list. Ticker follows the Yahoo convention `<SYMBOL>.BO` for
            # BSE-only listings (looks cleaner than `BSE.514215`). If the
            # user later wants to actively track this name, flip
            # is_active=true and optionally switch to the `.NS` form.
            short_name = (raw.get("short_name") or "").strip().upper()
            # Sanitise: allow only letters/digits/& so the URL stays clean.
            safe_sym = "".join(ch for ch in short_name if ch.isalnum() or ch == "&")
            shell_ticker = (safe_sym + ".BO") if safe_sym else f"BSE.{scrip}"
            shell = sb.table("companies").upsert({
                "ticker": shell_ticker,
                "company_name": raw.get("Long_Name") or short_name or shell_ticker,
                "exchange": "BSE",
                "bse_scrip": scrip,
                "is_active": False,   # don't fetch financials until opted in
            }, on_conflict="ticker").execute()
            if not shell.data:
                continue
            company = shell.data[0]
            by_scrip[scrip] = company
            created_shells += 1

        meet = parse_bse_date(raw.get("meeting_date"))
        if not meet:
            continue
        # BSE's feed doesn't distinguish between result / dividend meetings;
        # the Forth_Results page itself is already pre-filtered to results.
        # We trust that filter and store everything from this endpoint.
        out.append({
            "company_id": company["id"],
            "ticker": company["ticker"],
            "bse_scrip": scrip,
            "announcement_date": meet.isoformat(),
            "source": "bse",
            "purpose": "Financial Results (per BSE calendar)",
            "raw_json": raw,
            "status": "pending",
        })

    # Dedupe (ticker, announcement_date, purpose) within the batch — BSE
    # occasionally lists the same meeting twice (e.g. tentative + confirmed).
    seen: set[tuple[str, str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for r in out:
        key = (r["ticker"], r["announcement_date"], r["purpose"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)

    if deduped:
        for i in range(0, len(deduped), 200):
            sb.table("announcement_events").upsert(
                deduped[i:i+200], on_conflict="ticker,announcement_date,purpose"
            ).execute()

    # Refresh companies.next_result_date using the nearest pending event from
    # ANY source (BSE + NSE). Keeps the two scrapers cooperating cleanly.
    today = date.today().isoformat()
    future = sb.table("announcement_events") \
        .select("ticker,announcement_date") \
        .gte("announcement_date", today) \
        .eq("status", "pending") \
        .order("announcement_date", desc=False) \
        .execute()
    nearest: dict[str, str] = {}
    for row in future.data or []:
        nearest.setdefault(row["ticker"], row["announcement_date"])
    for t, d_iso in nearest.items():
        try:
            sb.table("companies").update({"next_result_date": d_iso}).eq("ticker", t).execute()
        except Exception as e:
            print(f"[warn] next_result_date {t}: {e}", file=sys.stderr)

    print(f"Done: {len(deduped)} BSE events written "
          f"({matched_by_scrip} by scrip, {matched_by_symbol} by symbol). "
          f"{skipped_untracked} untracked scrips {'skipped' if not args.include_untracked else 'handled'}, "
          f"{created_shells} shell companies created.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
