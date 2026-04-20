"""
BSE results-filing poller.

For each NIFTY 500 company with a `bse_scrip` code, hits BSE's corporate
announcements API (strCat=Result) and records the filing PDF URL on the
matching `announcement_events` row so the dashboard can surface a
"View filing ↗" link.

We don't parse the PDF (that's a separate template-heavy pipeline). The
link alone is a meaningful UX win — readers get same-day, one-click
access to the official source even before our numbers pipeline catches
up from Screener. Moneycontrol/Screener already do this; now we do too.

Storage model:
  announcement_events.raw_json.filing_url  → the BSE PDF attachment URL
  announcement_events.raw_json.filing_headline  → BSE's headline text
  announcement_events.raw_json.filing_date  → when BSE stamped it

Run:
    py scripts/bse_results.py                      # all NIFTY 500
    py scripts/bse_results.py --ticker RELIANCE.NS # one company
    py scripts/bse_results.py --days 14            # window (default 14)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import traceback
from datetime import date, datetime, timedelta

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

from curl_cffi import requests as cffi_requests
from supabase import create_client


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

BSE_PAGE_ANN = "https://www.bseindia.com/corporates/ann.html"
BSE_API = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"
BSE_ATTACH = "https://www.bseindia.com/xml-data/corpfiling/AttachLive/"

# BSE blocks plain `requests`; curl_cffi with Chrome TLS fingerprint works.
def bse_session():
    s = cffi_requests.Session(impersonate="chrome")
    # Prime cookies on the announcements page before hitting the api subdomain.
    s.get(BSE_PAGE_ANN, timeout=25)
    return s


def fetch_result_filings(session, scripcode: str, days: int) -> list[dict]:
    """Returns Result-category announcements within `days` back from today.

    Each row includes ATTACHMENTNAME (filename) and NEWS_DT (filing timestamp).
    """
    frm = (date.today() - timedelta(days=days)).strftime("%Y%m%d")
    to = date.today().strftime("%Y%m%d")
    params = {
        "pageno": 1,
        "strCat": "Result",
        "strPrevDate": frm,
        "strScrip": scripcode,
        "strSearch": "P",
        "strToDate": to,
        "strType": "C",
    }
    r = session.get(BSE_API, params=params, headers={
        "Referer": "https://www.bseindia.com/",
        "Origin": "https://www.bseindia.com",
        "Accept": "application/json, text/plain, */*",
    }, timeout=25)
    if r.status_code != 200:
        return []
    try:
        data = r.json()
    except Exception:
        return []
    return data.get("Table") or []


def resolve_targets(sb, args) -> list[dict]:
    q = sb.table("companies").select("id,ticker,company_name,bse_scrip") \
          .eq("is_active", True)
    if args.ticker:
        q = q.eq("ticker", args.ticker.upper())
    rows = q.execute().data or []
    # Only usable with a bse_scrip.
    return [c for c in rows if c.get("bse_scrip")]


def parse_iso(dt: str | None) -> str | None:
    """BSE timestamps are '2026-04-09T16:00:30.623'. Return 'YYYY-MM-DD'."""
    if not dt:
        return None
    try:
        return dt[:10]
    except Exception:
        return None


def upsert_filing_on_event(sb, company: dict, filing: dict) -> str:
    """
    Attach the BSE filing URL to an announcement_events row, matching on
    (ticker, announcement_date). If no event exists for the filing's date,
    create one — the calendar may not have caught it (e.g. board meeting
    + filing both same day, scraper hadn't polled yet).

    Returns 'updated' | 'created' | 'skipped' for logging.
    """
    ticker = company["ticker"]
    fdate = parse_iso(filing.get("NEWS_DT") or filing.get("DT_TM"))
    attachment = filing.get("ATTACHMENTNAME") or ""
    if not fdate or not attachment:
        return "skipped"
    filing_url = BSE_ATTACH + attachment
    headline = filing.get("HEADLINE") or filing.get("NEWSSUB") or ""
    patch = {
        "filing_url": filing_url,
        "filing_headline": headline[:500],
        "filing_date": fdate,
        "filing_source": "bse",
    }

    # Look for an existing event that matches.
    existing = sb.table("announcement_events") \
        .select("id,raw_json,status") \
        .eq("ticker", ticker) \
        .eq("announcement_date", fdate) \
        .limit(1).execute().data or []

    if existing:
        row = existing[0]
        raw = row.get("raw_json") or {}
        if not isinstance(raw, dict):
            raw = {}
        # Don't clobber an existing filing_url — calendars may have
        # two sources for the same day, but the filing link is truth
        # from the filing itself. Keep first one wins.
        if raw.get("filing_url"):
            return "skipped"
        raw.update(patch)
        # If the event was still 'pending' but we've now seen the filing,
        # promote it to 'fetched' (the filing DID happen).
        updates: dict = {"raw_json": raw}
        if row.get("status") == "pending":
            updates["status"] = "fetched"
            updates["processed_at"] = datetime.utcnow().isoformat() + "Z"
        sb.table("announcement_events").update(updates).eq("id", row["id"]).execute()
        return "updated"

    # No event for this date — create one. Status is 'fetched' because
    # the filing is in hand; the calendar just hadn't caught up.
    sb.table("announcement_events").insert({
        "company_id": company["id"],
        "ticker": ticker,
        "bse_scrip": company.get("bse_scrip"),
        "announcement_date": fdate,
        "source": "bse",
        "purpose": headline[:500] or "Financial Results",
        "status": "fetched",
        "detected_at": datetime.utcnow().isoformat() + "Z",
        "processed_at": datetime.utcnow().isoformat() + "Z",
        "raw_json": patch,
    }).execute()
    return "created"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", help="single ticker (e.g. RELIANCE.NS)")
    ap.add_argument("--days", type=int, default=14,
                    help="how many days back to scan (default 14)")
    ap.add_argument("--throttle-ms", type=int, default=400,
                    help="politeness delay between scrips (default 400ms)")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    targets = resolve_targets(sb, args)
    print(f"Polling BSE for {len(targets)} companies (last {args.days} days)...")
    session = bse_session()

    updated = 0
    created = 0
    empty = 0
    err_count = 0
    for i, c in enumerate(targets, 1):
        scrip = str(c["bse_scrip"]).zfill(6)
        try:
            filings = fetch_result_filings(session, scrip, args.days)
        except Exception as e:
            err_count += 1
            print(f"[{i:3d}/{len(targets)}] {c['ticker']:<18} ERROR {e}", file=sys.stderr)
            time.sleep(args.throttle_ms / 1000)
            continue
        if not filings:
            empty += 1
        else:
            for f in filings:
                try:
                    outcome = upsert_filing_on_event(sb, c, f)
                    if outcome == "updated": updated += 1
                    elif outcome == "created": created += 1
                except Exception as e:
                    err_count += 1
                    print(f"[{i:3d}/{len(targets)}] {c['ticker']:<18} write err: {e}", file=sys.stderr)
            print(f"[{i:3d}/{len(targets)}] {c['ticker']:<18} found {len(filings)} filing(s)")
        time.sleep(args.throttle_ms / 1000)

    print(f"\nDone. {updated} events updated, {created} events created, "
          f"{empty} with no filings in window, {err_count} errors.")
    # Don't fail the pipeline for per-company errors — BSE's API is
    # flakey under load and a handful of 503s shouldn't abort cron.
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
