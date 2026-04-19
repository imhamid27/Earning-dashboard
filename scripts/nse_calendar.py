"""
NSE event calendar → Supabase.

Hits NSE's public event-calendar API (same one news outlets consume) to find
upcoming board meetings whose purpose is "Financial Results". Writes into:
  - announcement_events (one row per scheduled meeting)
  - companies.next_result_date (nearest future date per tracked company)

Run:
    py scripts/nse_calendar.py
    py scripts/nse_calendar.py --include-untracked  # also store events for symbols not in companies
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

from supabase import create_client

from nse_common import nse_get


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")


def is_results(purpose: str | None, desc: str | None) -> bool:
    """The calendar mixes dividends, AGMs, etc. Keep only financial-result rows."""
    blob = f"{purpose or ''} {desc or ''}".lower()
    if "result" in blob or "financial result" in blob or "audited" in blob:
        return True
    return False


def parse_nse_date(raw: str | None) -> date | None:
    """NSE returns dates like '20-Apr-2026'."""
    if not raw:
        return None
    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw.strip(), fmt).date()
        except ValueError:
            continue
    return None


def symbol_to_ticker(symbol: str) -> str:
    """NSE uses 'RELIANCE'; we store 'RELIANCE.NS'."""
    return f"{symbol.strip().upper()}.NS"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-untracked", action="store_true",
                    help="Also store events for NSE symbols we don't currently track")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Companies we care about, keyed by ticker (with .NS).
    resp = sb.table("companies").select("id,ticker,company_name").eq("is_active", True).execute()
    tracked = {c["ticker"]: c for c in (resp.data or [])}
    print(f"Tracking {len(tracked)} companies.")

    # Fetch the calendar.
    print("Fetching NSE event calendar ...")
    events = nse_get("/api/event-calendar", params={"index": "equities"}) or []
    if isinstance(events, dict):
        # Some API versions wrap in an envelope.
        events = events.get("data") or events.get("events") or []
    print(f"NSE returned {len(events)} events.")

    detected = 0
    skipped_non_result = 0
    skipped_untracked = 0
    out_rows: list[dict[str, Any]] = []
    for raw in events:
        sym = raw.get("symbol")
        if not sym:
            continue
        d = parse_nse_date(raw.get("date"))
        if not d:
            continue
        purpose = raw.get("purpose")
        desc = raw.get("bm_desc") or raw.get("bmDesc")
        if not is_results(purpose, desc):
            skipped_non_result += 1
            continue

        ticker = symbol_to_ticker(sym)
        company = tracked.get(ticker)
        if not company:
            skipped_untracked += 1
            if not args.include_untracked:
                continue
            # Insert a shell company row so FK stays valid. Mark inactive so
            # the ingester doesn't try to fetch financials for it until the
            # user opts in.
            shell = sb.table("companies").upsert({
                "ticker": ticker,
                "company_name": raw.get("company") or sym,
                "exchange": "NSE",
                "is_active": False,
            }, on_conflict="ticker").execute()
            if shell.data:
                company = shell.data[0]
            else:
                continue

        # Keep purpose short enough to fit the unique key without collisions.
        purpose_short = (desc or purpose or "Financial Results")[:240]

        out_rows.append({
            "company_id": company["id"],
            "ticker": ticker,
            "announcement_date": d.isoformat(),
            "source": "nse",
            "purpose": purpose_short,
            "raw_json": raw,
            "status": "pending",
        })
        detected += 1

    # Dedupe by the unique constraint key — a company can legitimately have
    # two calendar rows for the same (date, purpose) if NSE returns both an
    # initial and a revised notice.
    seen_keys: set[tuple[str, str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for r in out_rows:
        key = (r["ticker"], r["announcement_date"], r["purpose"] or "")
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(r)

    if deduped:
        for i in range(0, len(deduped), 200):
            chunk = deduped[i:i+200]
            sb.table("announcement_events").upsert(
                chunk, on_conflict="ticker,announcement_date,purpose"
            ).execute()

    # Refresh companies.next_result_date to the nearest upcoming pending event.
    today_iso = date.today().isoformat()
    nearest = sb.table("announcement_events") \
        .select("ticker,announcement_date") \
        .gte("announcement_date", today_iso) \
        .eq("status", "pending") \
        .order("announcement_date", desc=False) \
        .execute()
    seen: dict[str, str] = {}
    for row in nearest.data or []:
        seen.setdefault(row["ticker"], row["announcement_date"])
    updated = 0
    for t, d_iso in seen.items():
        try:
            sb.table("companies").update({"next_result_date": d_iso}).eq("ticker", t).execute()
            updated += 1
        except Exception as e:
            print(f"[warn] next_result_date {t}: {e}", file=sys.stderr)

    print(f"Done: {detected} events written, {updated} next_result_dates set, "
          f"{skipped_non_result} non-result meetings skipped, "
          f"{skipped_untracked} untracked symbols {'ignored' if not args.include_untracked else 'stored'}.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
