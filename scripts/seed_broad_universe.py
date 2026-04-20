"""
Seed the `companies` table to the broader NIFTY Total Market + S&P
BSE AllCap universe.

Sources (both public, machine-readable):
  1. NIFTY Total Market — NSE's CSV with ~750 companies (ISIN, NSE symbol,
     industry, series). These are all the NSE large+mid+small caps that
     meet the index's liquidity bar.
  2. BSE BhavCopy         — the daily equity price CSV with ISIN, BSE
     scrip code, and ticker for every BSE-traded equity (~5,000 rows).
     We use this for two things:
       - Backfill bse_scrip on NSE-listed companies (ISIN join)
       - Add BSE-only liquid tail as .BO tickers (above a turnover cut)

Dedupe key is ISIN — it's unique per company regardless of exchange.
Existing companies keep their id and any data we've already fetched.

Ships a universe of ~900–1,100 active companies (up from 500).

Run:
    py scripts/seed_broad_universe.py --dry-run   # preview counts
    py scripts/seed_broad_universe.py --apply
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import sys
import traceback
from datetime import date, timedelta
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

NSE_TOTAL_MARKET_CSV = "https://archives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv"


def nse_session():
    s = cffi_requests.Session(impersonate="chrome")
    s.get("https://www.nseindia.com/", timeout=25)
    s.get("https://www.nseindia.com/market-data/live-equity-market", timeout=25)
    return s


def fetch_nifty_total_market(session) -> list[dict]:
    """Returns [{company_name, sector, symbol, series, isin}, ...]."""
    r = session.get(NSE_TOTAL_MARKET_CSV, headers={
        "Referer": "https://www.nseindia.com/",
        "Accept": "text/csv,*/*",
    }, timeout=30)
    r.raise_for_status()
    # CSV headers: Company Name, Industry, Symbol, Series, ISIN Code
    out = []
    reader = csv.DictReader(io.StringIO(r.text))
    for row in reader:
        sym = (row.get("Symbol") or "").strip().upper()
        if not sym:
            continue
        series = (row.get("Series") or "").strip().upper()
        if series and series != "EQ":
            # Skip non-equity series (W = warrants, etc.)
            continue
        out.append({
            "company_name": (row.get("Company Name") or "").strip(),
            "sector":       (row.get("Industry") or "").strip() or None,
            "symbol":       sym,
            "isin":         (row.get("ISIN Code") or "").strip().upper() or None,
            "exchange":     "NSE",
        })
    return out


def fetch_bse_bhavcopy(session, when: date | None = None) -> list[dict]:
    """BSE daily equity bhavcopy — all equity-segment traded securities.

    Schema: TradDt, BizDt, Sgmt, Src, FinInstrmTp, FinInstrmId (scrip),
    ISIN, TckrSymb (BSE short name), SctySrs (EQ=equity),
    FinInstrmNm (long name), OpnPric, HghPric, LwPric, ClsPric,
    TtlTradgVol, TtlTrfVal (rupees), ...
    """
    day = when or date.today()
    for d in (day, day - timedelta(days=1), day - timedelta(days=2),
              day - timedelta(days=3), day - timedelta(days=4)):
        stamp = d.strftime("%Y%m%d")
        url = f"https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_{stamp}_F_0000.CSV"
        r = session.get(url, headers={"Referer":"https://www.bseindia.com/"}, timeout=30)
        if r.status_code != 200 or len(r.text) < 1000:
            continue
        print(f"  Using BhavCopy for {stamp} ({len(r.text)//1024}kB)")
        out = []
        reader = csv.DictReader(io.StringIO(r.text))
        # BSE uses group codes (A/B/T/Z/X/...) not NSE's "EQ". A and B
        # are mainstream cash trading; T is trade-for-trade but still
        # standard equities. Everything else (Z, XT, MS, ...) is either
        # surveillance, suspended, or non-equity — drop.
        KEEP_GROUPS = {"A", "B", "T"}
        for row in reader:
            series = (row.get("SctySrs") or "").strip().upper()
            if series not in KEEP_GROUPS:
                continue
            scrip = (row.get("FinInstrmId") or "").strip()
            isin  = (row.get("ISIN") or "").strip().upper()
            symb  = (row.get("TckrSymb") or "").strip().upper()
            name  = (row.get("FinInstrmNm") or "").strip()
            try:
                trf_val = float(row.get("TtlTrfVal") or 0)
            except Exception:
                trf_val = 0
            if not scrip or not scrip.isdigit():
                continue
            out.append({
                "scrip": scrip.zfill(6),
                "isin":  isin or None,
                "symbol": symb,
                "company_name": name,
                "turnover": trf_val,
            })
        return out
    return []


def bse_session():
    s = cffi_requests.Session(impersonate="chrome")
    s.get("https://www.bseindia.com/", timeout=25)
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Actually write to DB")
    ap.add_argument("--bse-turnover-cut", type=float, default=5_000_000,
                    help="Minimum BSE day-turnover in rupees to include a BSE-only ticker (default Rs50L — filters out micro-caps)")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing Supabase env", file=sys.stderr)
        return 2

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("Fetching NIFTY Total Market...")
    nse_list = fetch_nifty_total_market(nse_session())
    print(f"  -> {len(nse_list)} NSE equities")

    print("Fetching BSE BhavCopy...")
    bhav = fetch_bse_bhavcopy(bse_session())
    print(f"  -> {len(bhav)} BSE equities (all)")

    # Index BSE by ISIN for fast cross-ref.
    bse_by_isin = {b["isin"]: b for b in bhav if b["isin"]}

    # Build master list. Start with NSE companies (authoritative for
    # name + sector); attach bse_scrip where ISIN matches.
    master: list[dict] = []
    covered_isins: set[str] = set()
    for n in nse_list:
        isin = n["isin"]
        bse = bse_by_isin.get(isin) if isin else None
        master.append({
            "ticker":       n["symbol"] + ".NS",
            "company_name": n["company_name"],
            "sector":       n["sector"],
            "exchange":     "NSE",
            "bse_scrip":    bse["scrip"] if bse else None,
            "isin":         isin,
            "is_active":    True,
        })
        if isin:
            covered_isins.add(isin)

    # BSE-only tail: equities with ISIN not in NSE list AND turnover >= cut.
    bse_only = [b for b in bhav if b["isin"] and b["isin"] not in covered_isins and b["turnover"] >= args.bse_turnover_cut]
    bse_only.sort(key=lambda b: -b["turnover"])
    print(f"  -> {len(bse_only)} BSE-only equities above Rs{args.bse_turnover_cut/1e5:.0f}L turnover")

    for b in bse_only:
        master.append({
            "ticker":       (b["symbol"] or f"BSE{b['scrip']}") + ".BO",
            "company_name": b["company_name"],
            "sector":       None,
            "exchange":     "BSE",
            "bse_scrip":    b["scrip"],
            "isin":         b["isin"],
            "is_active":    True,
        })

    print(f"\nMaster list: {len(master)} companies "
          f"({sum(1 for m in master if m['exchange']=='NSE')} NSE · "
          f"{sum(1 for m in master if m['exchange']=='BSE')} BSE-only)")

    if not args.apply:
        print("\n(Dry run. Add --apply to write.)")
        print("Sample BSE-only names (top 10 by turnover):")
        for m in [m for m in master if m['exchange']=='BSE'][:10]:
            print(f"  {m['ticker']:<24} scrip={m['bse_scrip']}  {m['company_name'][:40]}")
        return 0

    # Existing active companies — we keep their id and any data. Match
    # preferentially on ISIN, fall back to ticker.
    existing = sb.table("companies").select("id,ticker,isin,bse_scrip").execute().data or []
    by_isin = {c["isin"]: c for c in existing if c.get("isin")}
    by_ticker = {c["ticker"]: c for c in existing}

    to_insert: list[dict] = []
    to_update: list[dict] = []
    for m in master:
        existing_row = (by_isin.get(m["isin"]) if m["isin"] else None) or by_ticker.get(m["ticker"])
        if existing_row:
            # Update any missing fields (especially bse_scrip / isin) but
            # don't overwrite user-set values. Keep original id + ticker.
            patch: dict[str, Any] = {"is_active": True}
            if not existing_row.get("bse_scrip") and m["bse_scrip"]:
                patch["bse_scrip"] = m["bse_scrip"]
            if not existing_row.get("isin") and m["isin"]:
                patch["isin"] = m["isin"]
            if len(patch) > 1:
                patch["id"] = existing_row["id"]
                to_update.append(patch)
        else:
            to_insert.append(m)

    print(f"\nPlanning: {len(to_insert)} inserts, {len(to_update)} updates.")

    # Apply in batches.
    for i in range(0, len(to_insert), 200):
        chunk = to_insert[i:i+200]
        sb.table("companies").insert(chunk).execute()
    for u in to_update:
        uid = u.pop("id")
        sb.table("companies").update(u).eq("id", uid).execute()
    # Also, reactivate any existing company that should now be tracked.
    master_tickers = {m["ticker"] for m in master}
    existing_active = {c["ticker"] for c in existing if c["ticker"] in master_tickers}
    # Deactivate anything outside the master set that's currently active.
    deactivate = [c["id"] for c in existing if c["ticker"] not in master_tickers]
    if deactivate:
        for i in range(0, len(deactivate), 200):
            chunk_ids = deactivate[i:i+200]
            sb.table("companies").update({"is_active": False}).in_("id", chunk_ids).execute()
        print(f"Deactivated {len(deactivate)} companies outside new universe.")

    print("Done.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
