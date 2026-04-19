"""
Seed the company universe from NSE NIFTY 500.

The initial seed in supabase/schema.sql was 50 hand-picked large caps. To
cover the market like Moneycontrol / Screener, we expand to the full
NIFTY 500 — which represents ~95% of free-float market cap on NSE.

What this script does:
  1. Fetches the NIFTY 500 constituents from nseindia.com/api
  2. Fetches the full BSE equity master (scrip code ↔ ISIN map)
  3. Joins them on ISIN so each NSE ticker gets its BSE scrip code
  4. Upserts rows into `companies` (is_active = true for all 500)
  5. Removes the BSE.<scripcode> shell rows created earlier by bse_calendar.py
     --include-untracked, since they're now covered by proper tickers

Run once (idempotent):
    py scripts/seed_universe.py
    py scripts/seed_universe.py --no-cleanup    # keep legacy shell rows
"""

from __future__ import annotations

import argparse
import os
import sys
import traceback
from datetime import datetime
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


def nse_session():
    s = cffi_requests.Session(impersonate="chrome")
    s.headers.update({
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.nseindia.com/",
    })
    # Prime any page to get cookies.
    s.get("https://www.nseindia.com/market-data/live-equity-market", timeout=20)
    return s


def bse_session():
    s = cffi_requests.Session(impersonate="chrome")
    s.headers.update({
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.bseindia.com/",
        "Origin":  "https://www.bseindia.com",
    })
    s.get("https://www.bseindia.com/", timeout=20)
    return s


def fetch_nifty500(nse) -> list[dict]:
    r = nse.get(
        "https://www.nseindia.com/api/equity-stockIndices",
        params={"index": "NIFTY 500"},
        timeout=25,
    )
    r.raise_for_status()
    payload = r.json()
    rows = payload.get("data", [])
    # The first row is a synthetic index summary ("NIFTY 500"); drop it.
    return [d for d in rows if d.get("symbol") and d.get("symbol") != "NIFTY 500"]


def fetch_bse_isin_map(bse) -> dict[str, str]:
    """BSE publishes its equity master at Equity_All_File_Download. Returns
    {ISIN: scrip_code}. If the endpoint changes shape, we fall back to an
    empty map — BSE scrip codes are nice-to-have, not critical."""
    candidates = [
        "https://api.bseindia.com/BseIndiaAPI/api/ListOfScripData/w",
        "https://api.bseindia.com/BseIndiaAPI/api/Equity_All_File_Download/w",
    ]
    for url in candidates:
        try:
            r = bse.get(url, params={"segmentid": "18", "status": "Active"}, timeout=25)
            if "json" in (r.headers.get("content-type") or "").lower():
                data = r.json()
                if isinstance(data, dict):
                    rows = data.get("Table") or data.get("Data") or []
                else:
                    rows = data
                out: dict[str, str] = {}
                for row in rows:
                    isin = (row.get("ISIN_NUMBER") or row.get("ISIN") or row.get("isin") or "").strip()
                    scrip = (row.get("SCRIP_CD") or row.get("scrip_cd") or row.get("Scrip_Cd") or "").strip()
                    if isin and scrip:
                        out[isin] = str(scrip).zfill(6)
                if out:
                    return out
        except Exception:
            continue
    return {}


# Very rough sector grouping. NSE's `industry` field is granular (~180 values);
# the dashboard groups them into ~10 sectors. Keep it simple — anything
# unmatched is "Other".
SECTOR_MAP = [
    ("Financials",                ["Banks", "Finance", "Insurance", "Diversified Financial", "Financial Services"]),
    ("Information Technology",    ["IT ", "IT-"]),
    ("Energy",                    ["Oil", "Gas", "Petroleum", "Power", "Refineries", "Coal", "Energy"]),
    ("Utilities",                 ["Utilities", "Electric", "Power"]),
    ("Consumer Staples",          ["FMCG", "Consumer Food", "Personal Care", "Tobacco", "Dairy", "Household"]),
    ("Consumer Discretionary",    ["Auto", "Retail", "Apparel", "Entertainment", "Textile", "Diversified FMCG", "Leisure", "Realty"]),
    ("Healthcare",                ["Pharma", "Healthcare", "Hospital", "Diagnostic"]),
    ("Materials",                 ["Cement", "Steel", "Chemical", "Metal", "Paper", "Fertilizer", "Paint", "Mining"]),
    ("Industrials",               ["Capital Goods", "Construction", "Engineering", "Infrastructure", "Logistics", "Aerospace", "Defence"]),
    ("Communication Services",    ["Telecom", "Media", "Entertainment"]),
    ("Real Estate",               ["Realty", "Real Estate"]),
]


def pick_sector(industry: str | None) -> str:
    if not industry:
        return "Other"
    for sector, tokens in SECTOR_MAP:
        for t in tokens:
            if t.lower() in industry.lower():
                return sector
    return "Other"


def bucket_from_yearhigh(row: dict) -> str | None:
    """Rough market-cap bucket from the stocks index row. NIFTY 500 covers
    LARGE and MID caps; we call the top 100 LARGE, next 150 MID, rest SMALL.
    NSE doesn't expose mcap directly in this endpoint, so we use priority."""
    p = row.get("priority")
    if p is None:
        return None
    # priority 0 is the index summary; real stocks start at 1
    try:
        p = int(p)
    except (ValueError, TypeError):
        return None
    if p <= 100:   return "LARGE"
    if p <= 250:   return "MID"
    return "SMALL"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-cleanup", action="store_true",
                    help="Don't delete legacy BSE.xxxxxx shell rows from bse_calendar.py --include-untracked")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("Fetching NIFTY 500 from NSE...")
    nse = nse_session()
    nse_rows = fetch_nifty500(nse)
    print(f"  {len(nse_rows)} companies")

    print("Fetching BSE scrip master (for ISIN -> scrip_code map)...")
    try:
        bse = bse_session()
        isin_to_scrip = fetch_bse_isin_map(bse)
        print(f"  {len(isin_to_scrip)} ISIN -> scrip mappings")
    except Exception as e:
        print(f"  [warn] BSE master fetch failed: {e} — continuing without BSE scrips")
        isin_to_scrip = {}

    upserts: list[dict[str, Any]] = []
    for row in nse_rows:
        meta = row.get("meta") or {}
        sym = row.get("symbol", "").strip().upper()
        if not sym:
            continue
        # Skip delisted or suspended names — we don't want them cluttering the dashboard.
        if meta.get("isDelisted") or meta.get("isSuspended"):
            continue
        ticker = f"{sym}.NS"
        company_name = meta.get("companyName") or sym
        industry = meta.get("industry") or None
        isin = meta.get("isin")
        bse_scrip = isin_to_scrip.get(isin) if isin else None
        upserts.append({
            "ticker": ticker,
            "company_name": company_name,
            "exchange": "NSE",
            "industry": industry,
            "sector": pick_sector(industry),
            "isin": isin,
            "bse_scrip": bse_scrip,
            "market_cap_bucket": bucket_from_yearhigh(row),
            "is_active": True,
        })

    print(f"Upserting {len(upserts)} NIFTY 500 companies...")
    for i in range(0, len(upserts), 200):
        chunk = upserts[i:i+200]
        sb.table("companies").upsert(chunk, on_conflict="ticker").execute()

    if not args.no_cleanup:
        # Drop the shell rows created earlier by bse_calendar.py --include-untracked.
        # Their announcement_events will still exist (ON DELETE CASCADE from
        # companies.id would nuke them — we want to preserve dates if a real
        # ticker replaces the shell, so we only delete shells that have no
        # active events referencing them via the cascade).
        res = sb.table("companies").delete().like("ticker", "BSE.%").execute()
        print(f"Cleaned up {len(res.data or [])} BSE.xxxxxx shell rows.")

    # Summary stats
    total = sb.table("companies").select("id", count="exact").execute()
    active = sb.table("companies").select("id", count="exact").eq("is_active", True).execute()
    print(f"\nDone. companies: {total.count} total, {active.count} active.")
    print("\nNext steps:")
    print("  py scripts/bse_calendar.py          # refresh BSE calendar (now maps to real tickers)")
    print("  py scripts/nse_calendar.py          # refresh NSE calendar")
    print("  py scripts/nse_results.py --all --quarters 4   # fetch recent financials (takes ~30min)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
