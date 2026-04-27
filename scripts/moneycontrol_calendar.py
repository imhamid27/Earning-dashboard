"""
Moneycontrol results-calendar scraper.

Moneycontrol is the one Indian source that reflects Q4 filings faster than
NSE's public API — their pipeline pulls from BSE corporate announcements and
their own newsroom. We scrape their results-calendar page and:

  1. Add each entry to `announcement_events` (status='fetched' for past dates,
     'pending' for future ones), mapping company name → our NSE ticker.
  2. Collect a "freshly announced" list of tickers — companies with results
     filed within the last 14 days that we don't yet have numbers for — and
     fire off `screener_results.py` to fetch their financials.

Implementation detail: Moneycontrol's calendar page is a Next.js-rendered
page that embeds the full data payload in a `<script id="__NEXT_DATA__">`
tag. That's easier + more reliable than scraping the DOM.

Run:
    py scripts/moneycontrol_calendar.py                      # default ±14 days
    py scripts/moneycontrol_calendar.py --days 30
    py scripts/moneycontrol_calendar.py --no-trigger-screener
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import traceback
from datetime import date, datetime, timedelta, timezone

_IST = timezone(timedelta(hours=5, minutes=30))
def _today_ist() -> date:
    return datetime.now(_IST).date()
from pathlib import Path
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

MC_BASE = "https://www.moneycontrol.com"
CAL_URL_TMPL = MC_BASE + "/markets/earnings/results-calendar/?id=All&name=All&activeDate={date}"


def mc_session():
    s = cffi_requests.Session(impersonate="chrome")
    s.headers.update({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": MC_BASE + "/",
    })
    return s


def fetch_calendar(session, iso_date: str) -> list[dict]:
    """Fetch one day's results-calendar page; return the embedded `tableData.list`."""
    url = CAL_URL_TMPL.format(date=iso_date)
    r = session.get(url, timeout=25)
    r.raise_for_status()
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.+?)</script>', r.text, re.S)
    if not m:
        return []
    try:
        payload = json.loads(m.group(1))
    except json.JSONDecodeError:
        return []
    cal = (
        payload.get("props", {})
               .get("pageProps", {})
               .get("resultCalendarData", {})
    )
    return ((cal.get("tableData") or {}).get("list") or [])


# Company name in Moneycontrol is often cleaner than "Long_Name" on BSE.
# Normalise by stripping common suffixes / punctuation.
def normalise_name(n: str) -> str:
    s = (n or "").upper()
    for suffix in [" LIMITED", " LTD", " LTD.", " LIMITED.", " & CO", " CORP", " CORPORATION",
                   " INDUSTRIES", "(INDIA)", "INDIA"]:
        s = s.replace(suffix, "")
    s = re.sub(r"[^A-Z0-9 ]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_mc_date(raw: str, default_year: int) -> date | None:
    """Moneycontrol dates look like '18 Apr'. Year comes from URL context."""
    if not raw:
        return None
    s = raw.strip()
    for fmt in ("%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(f"{s} {default_year}", fmt).date()
        except ValueError:
            pass
    for fmt in ("%d %b", "%d %B"):
        try:
            parsed = datetime.strptime(s, fmt).replace(year=default_year)
            return parsed.date()
        except ValueError:
            pass
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14,
                    help="Days ahead to include in a single page fetch (Moneycontrol fills ±7–14 day window)")
    ap.add_argument("--back", type=int, default=14,
                    help="Days back to also scan (each date is its own page fetch)")
    ap.add_argument("--no-trigger-screener", action="store_true",
                    help="Skip the automatic Screener fetch for newly-discovered reporters")
    ap.add_argument("--include-untracked", action="store_true",
                    help="Auto-create shell company rows for Moneycontrol entries not already in the DB")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Build company lookup: name → row. Use multiple keys for robustness.
    rows = sb.table("companies").select("id,ticker,company_name").execute().data or []
    by_name: dict[str, dict] = {normalise_name(c["company_name"]): c for c in rows}
    by_sym:  dict[str, dict] = {
        c["ticker"].split(".")[0].upper(): c for c in rows if c.get("ticker")
    }
    print(f"Indexed {len(rows)} companies ({len(by_name)} by name, {len(by_sym)} by symbol).")

    # Moneycontrol's `activeDate` param returns entries for *that specific
    # day only* — the fromDate/toDate in the JSON response is just the UI's
    # filter window. So we iterate every calendar day in our range.
    session = mc_session()
    today = _today_ist()
    anchor_dates = [
        (today - timedelta(days=i)).isoformat()
        for i in range(args.back, -args.days - 1, -1)
    ]

    all_entries: list[dict] = []
    for iso in anchor_dates:
        try:
            entries = fetch_calendar(session, iso)
            if entries:
                print(f"  {iso}: {len(entries)} entries")
            all_entries.extend(entries)
        except Exception as e:
            print(f"  {iso}: ERR {e}", file=sys.stderr)

    # Dedupe on (stockName, date)
    seen: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for e in all_entries:
        key = (e.get("stockName", ""), e.get("date", ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(e)
    print(f"Total unique entries: {len(deduped)}")

    # Map to our companies.
    matched: list[dict] = []
    unmatched: list[str] = []
    created_shells = 0
    for e in deduped:
        name = e.get("stockName") or e.get("stockShortName") or ""
        norm = normalise_name(name)
        company = by_name.get(norm)
        if not company:
            # Try a loose contains match against our canonical names.
            for k, v in by_name.items():
                if norm and (norm in k or k in norm) and len(norm) > 4:
                    company = v
                    break
        if not company and args.include_untracked:
            # Create a shell company so the event can be stored. MC's scId
            # isn't a standard ticker (e.g., "HDF01"), so we synthesise one
            # from the stockShortName in Yahoo .BO form (Moneycontrol is
            # primarily a BSE-indexed service).
            short = (e.get("stockShortName") or name).strip().upper()
            safe = "".join(ch for ch in short if ch.isalnum() or ch == "&")
            if safe:
                shell_ticker = f"{safe}.BO"
                shell = sb.table("companies").upsert({
                    "ticker": shell_ticker,
                    "company_name": name or short or shell_ticker,
                    "exchange": "BSE",
                    "is_active": False,   # don't fetch financials until opted in
                }, on_conflict="ticker").execute()
                if shell.data:
                    company = shell.data[0]
                    by_name[normalise_name(name)] = company
                    created_shells += 1
        if company:
            matched.append({"company": company, "mc": e})
        else:
            unmatched.append(name)

    print(f"Matched {len(matched)} companies; {len(unmatched)} unmatched "
          f"(not in our NIFTY-500 universe); {created_shells} shell rows created.")

    # Build announcement_events rows.
    today = _today_ist()
    upserts: list[dict[str, Any]] = []
    fresh_tickers: set[str] = set()
    for m in matched:
        mc = m["mc"]
        c = m["company"]
        ann_date = parse_mc_date(mc.get("date", ""), default_year=today.year)
        if not ann_date:
            continue
        # Moneycontrol shows past reporters + upcoming. We mark past ones
        # 'fetched' so the ingester doesn't try to re-query NSE for them; we
        # mark future ones 'pending' so the hourly ingester picks them up.
        if ann_date < today:
            status = "fetched"
            # Past announcement — worth fetching via Screener if we don't have data.
            fresh_tickers.add(c["ticker"])
        elif ann_date == today:
            status = "fetched"
            fresh_tickers.add(c["ticker"])
        else:
            status = "pending"

        purpose = (mc.get("resultType") or "Financial Results").strip()[:240]
        upserts.append({
            "company_id": c["id"],
            "ticker": c["ticker"],
            "announcement_date": ann_date.isoformat(),
            "source": "moneycontrol",
            "purpose": purpose,
            "raw_json": mc,
            "status": status,
        })

    # Dedup within the batch.
    seen_keys: set[tuple[str, str, str]] = set()
    final_rows: list[dict[str, Any]] = []
    for r in upserts:
        key = (r["ticker"], r["announcement_date"], r["purpose"])
        if key in seen_keys:
            continue
        seen_keys.add(key)
        final_rows.append(r)

    if final_rows:
        for i in range(0, len(final_rows), 200):
            sb.table("announcement_events").upsert(
                final_rows[i:i+200], on_conflict="ticker,announcement_date,purpose"
            ).execute()
        print(f"Upserted {len(final_rows)} Moneycontrol-sourced events.")

    # Trigger Screener fetch for tickers that just reported but we don't
    # have their corresponding quarter in the DB.
    if args.no_trigger_screener or not fresh_tickers:
        print(f"Fresh tickers (announced in last {args.back} days): {sorted(fresh_tickers)}")
        return 0

    print(f"\n{len(fresh_tickers)} companies have recently announced — "
          f"fetching their financials from Screener...")
    screener_script = Path(__file__).resolve().parent / "screener_results.py"
    for t in sorted(fresh_tickers):
        try:
            subprocess.run(
                [sys.executable, str(screener_script), "--ticker", t],
                check=False, timeout=60, cwd=str(screener_script.parent.parent)
            )
        except Exception as e:
            print(f"  [warn] screener fetch for {t}: {e}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
