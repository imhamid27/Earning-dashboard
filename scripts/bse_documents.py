"""
BSE documents fetcher — announcements + annual reports.

For each active company with a bse_scrip code, fetches:
  - 30 most-recent corporate announcements (all categories)
  - Annual report list

Both are upserted into Supabase (via direct PostgREST HTTP, no SDK):
  - company_announcements
  - company_annual_reports

BSE's API subdomain (api.bseindia.com) is behind Akamai bot protection.
We use curl_cffi with Chrome TLS impersonation and prime cookies by
visiting the announcements page first — same approach as bse_results.py.

Run:
    py scripts/bse_documents.py                      # all active companies
    py scripts/bse_documents.py --ticker RELIANCE.NS # single company
    py scripts/bse_documents.py --limit 50           # cap count
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import traceback
from datetime import date

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import requests as _requests
from curl_cffi import requests as cffi_requests

SUPABASE_URL = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    or ""
)

BSE_PAGE_ANN    = "https://www.bseindia.com/corporates/ann.html"
BSE_API_ANN     = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"
BSE_API_AR      = "https://api.bseindia.com/BseIndiaAPI/api/AnnualReport/w"
BSE_ATTACH_BASE = "https://www.bseindia.com/xml-data/corpfiling/AttachHis/"


# ---------------------------------------------------------------------------
# Supabase PostgREST helpers (no SDK — avoids pydantic_core DLL dependency)
# ---------------------------------------------------------------------------

def _sb_headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def sb_select(table: str, select: str, filters: dict) -> list[dict]:
    params = {"select": select}
    for k, v in filters.items():
        params[k] = f"eq.{v}"
    r = _requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_sb_headers(),
        params=params,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def sb_upsert(table: str, records: list[dict], on_conflict: str) -> None:
    r = _requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**_sb_headers(), "Prefer": f"resolution=merge-duplicates,return=minimal"},
        params={"on_conflict": on_conflict},
        json=records,
        timeout=30,
    )
    r.raise_for_status()


# ---------------------------------------------------------------------------
# BSE session
# ---------------------------------------------------------------------------

BSE_HEADERS = {
    "Referer": "https://www.bseindia.com/",
    "Origin":  "https://www.bseindia.com",
    "Accept":  "application/json, text/plain, */*",
}


def bse_session() -> cffi_requests.Session:
    s = cffi_requests.Session(impersonate="chrome")
    s.get(BSE_PAGE_ANN, timeout=25)
    return s


# ---------------------------------------------------------------------------
# BSE API helpers
# ---------------------------------------------------------------------------

def normalise_date(raw: str | None) -> str | None:
    """BSE timestamps: 'Nov 20 2026  1:31PM' or '2026-11-20T...' → 'YYYY-MM-DD'."""
    if not raw:
        return None
    raw = raw.strip()
    if raw[0:4].isdigit():
        return raw[:10]
    try:
        from datetime import datetime
        for fmt in ("%b %d %Y %I:%M%p", "%b %d %Y"):
            try:
                return datetime.strptime(raw[:17].strip(), fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
    except Exception:
        pass
    return None


def fetch_announcements(session: cffi_requests.Session, scrip: str) -> list[dict]:
    r = session.get(BSE_API_ANN, params={
        "strCat": "-1",
        "strPrevDate": "",
        "strScrip": scrip,
        "strSearch": "P",
        "strToDate": "",
        "strType": "C",
        "strSrt": "0",
        "strEnd": "30",
    }, headers=BSE_HEADERS, timeout=25)
    if r.status_code != 200:
        return []
    try:
        return r.json().get("Table") or []
    except Exception:
        return []


def fetch_annual_reports(session: cffi_requests.Session, scrip: str) -> list[dict]:
    r = session.get(BSE_API_AR, params={"scripcd": scrip},
                    headers=BSE_HEADERS, timeout=25)
    if r.status_code != 200:
        return []
    try:
        return r.json().get("Table") or []
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Upsert helpers
# ---------------------------------------------------------------------------

def upsert_announcements(ticker: str, rows: list[dict]) -> int:
    if not rows:
        return 0
    records = []
    for r in rows:
        bse_id = str(r.get("seqno") or r.get("Seq_Id") or "")
        if not bse_id:
            continue
        attach = r.get("ATTACHMENTNAME") or ""
        records.append({
            "ticker":      ticker,
            "bse_id":      bse_id,
            "date":        normalise_date(r.get("DissemDT") or r.get("NEWS_DT")),
            "subject":     (r.get("NEWSSUB") or "").strip(),
            "category":    (r.get("CATEGORYNAME") or "").strip(),
            "subcategory": (r.get("SUBCATNAME") or "").strip(),
            "pdf_url":     (BSE_ATTACH_BASE + attach) if attach else None,
            "fetched_at":  date.today().isoformat(),
        })
    if not records:
        return 0
    sb_upsert("company_announcements", records, "ticker,bse_id")
    return len(records)


def upsert_annual_reports(ticker: str, rows: list[dict]) -> int:
    if not rows:
        return 0
    records = []
    for r in rows:
        bse_id = str(r.get("seqno") or "")
        if not bse_id:
            continue
        attach = r.get("ATTACHMENTNAME") or ""
        records.append({
            "ticker":     ticker,
            "bse_id":     bse_id,
            "year":       (r.get("REPYEAR") or "").strip(),
            "title":      (r.get("HEADER") or r.get("REPYEAR") or "Annual Report").strip(),
            "pdf_url":    (BSE_ATTACH_BASE + attach) if attach else None,
            "fetched_at": date.today().isoformat(),
        })
    if not records:
        return 0
    sb_upsert("company_annual_reports", records, "ticker,bse_id")
    return len(records)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", help="Single ticker to process")
    ap.add_argument("--limit", type=int, default=0, help="Cap number of companies")
    ap.add_argument("--delay", type=float, default=1.5, help="Seconds between companies")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing SUPABASE env vars", file=sys.stderr)
        sys.exit(1)

    filters: dict = {"is_active": "true"}
    if args.ticker:
        filters["ticker"] = args.ticker.upper()

    companies = sb_select(
        "companies",
        "ticker,company_name,bse_scrip",
        filters,
    )
    companies = [c for c in companies if c.get("bse_scrip")]
    if args.limit:
        companies = companies[:args.limit]

    print(f"Processing {len(companies)} companies…")
    session = bse_session()

    ok = err = 0
    for co in companies:
        ticker = co["ticker"]
        scrip  = co["bse_scrip"]
        try:
            ann = fetch_announcements(session, scrip)
            ar  = fetch_annual_reports(session, scrip)
            n_ann = upsert_announcements(ticker, ann)
            n_ar  = upsert_annual_reports(ticker, ar)
            print(f"  {ticker:20s}  ann={n_ann:2d}  ar={n_ar:2d}")
            ok += 1
        except Exception:
            print(f"  {ticker} ERROR:")
            traceback.print_exc()
            err += 1
        time.sleep(args.delay)

    print(f"\nDone. ok={ok} err={err}")


if __name__ == "__main__":
    main()
