"""
Announcement-triggered results fetcher.

Closes the gap between "we know company X announced" and "we have X's
numbers". Calendar scrapers (nse_calendar / bse_calendar / moneycontrol)
mark an `announcement_events` row as status='fetched' the moment the
filing is detected, but the numbers can lag — NSE XBRL might not be
indexed yet, Screener might not have scraped, etc. This worker walks
those gaps and tries each viable source in priority order until one
yields numbers.

Source chain per ticker:
  1. NSE XBRL              (authoritative for .NS listings)
  2. Screener.in           (broad NIFTY-500 coverage; accurate, slight lag)
  3. (future) BSE PDF      (required for BSE-only small caps)

Rules:
  - Never overwrite an existing quarterly_financials row with numbers.
  - Only write when revenue OR net_profit is present (partial is OK).
  - If no source returns numbers, log 'missed' and move on — the cron
    will retry on the next pass.

Run:
    py scripts/fetch_results.py                    # default: current quarter
    py scripts/fetch_results.py --quarter Q4 FY26
    py scripts/fetch_results.py --ticker RELIANCE.NS
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

from supabase import create_client

# Reuse the proven logic from the source-specific scripts — importing
# keeps the fallback chain in one place and avoids spawning subprocesses.
from nse_results import (
    fetch_filings_index,
    pick_best_per_quarter,
    parse_iso,
    parse_xbrl,
    write_quarter as nse_write_quarter,
    log_fetch as nse_log_fetch,
)
from nse_common import nse_get_text, today_ist
from screener_results import (
    screener_session,
    fetch_company_html,
    extract_quarters_table,
    upsert_company as screener_upsert,
    log_fetch as screener_log_fetch,
)


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")


def quarter_end_for(label: str) -> date | None:
    """'Q4 FY26' → date(2026, 3, 31)."""
    import re
    m = re.match(r"^Q([1-4])\s*FY(\d{2})$", label.strip())
    if not m:
        return None
    fq = int(m.group(1))
    fy = 2000 + int(m.group(2))
    # FY ends in March — Q1=Jun(fy-1), Q2=Sep(fy-1), Q3=Dec(fy-1), Q4=Mar(fy)
    endings = {1: (6, 30, fy - 1), 2: (9, 30, fy - 1), 3: (12, 31, fy - 1), 4: (3, 31, fy)}
    m_, d_, y_ = endings[fq]
    return date(y_, m_, d_)


# Sources considered authoritative — NSE/BSE official filings.
# Rows from these sources are treated as final and won't be re-fetched.
# Screener/yahoo rows are treated as provisional and remain eligible
# for an NSE XBRL upgrade whenever XBRL becomes available.
AUTHORITATIVE_SOURCES = {"nse", "bse", "bse_pdf"}


def find_gap_tickers(sb, quarter_label: str, window_days: int = 90) -> list[dict]:
    """
    Returns companies that announced within the window and either:
      (a) have no quarterly_financials row at all, OR
      (b) have data only from a non-authoritative source (screener / yahoo).

    Case (b) keeps NSE/BSE tickers eligible for an official XBRL upgrade
    even after Screener has already written provisional numbers.  If XBRL
    is still unavailable the Screener row is left untouched.
    """
    qe = quarter_end_for(quarter_label)
    if not qe:
        return []

    today_str = today_ist()
    since = (date.fromisoformat(today_str) - timedelta(days=window_days)).isoformat()

    # 1. Every ticker whose announcement has been CONFIRMED in the window.
    # Include both 'fetched' and 'missed' — nse_results.py marks an event
    # 'missed' when XBRL is unavailable, but Screener may still have the
    # numbers (common for same-day filings where XBRL lags by hours).
    events = sb.table("announcement_events") \
        .select("ticker,announcement_date") \
        .in_("status", ["fetched", "missed"]) \
        .gte("announcement_date", since) \
        .lte("announcement_date", today_str) \
        .execute()
    announced = {e["ticker"] for e in (events.data or [])}
    if not announced:
        return []

    # 2. Tickers that already have numbers from an AUTHORITATIVE source.
    #    - nse / bse / bse_pdf  → final, skip entirely.
    #    - screener / yahoo     → provisional, keep in the gap list so NSE
    #      XBRL can overwrite when it becomes available.
    have = sb.table("quarterly_financials") \
        .select("ticker,revenue,net_profit,source") \
        .eq("quarter_end_date", qe.isoformat()) \
        .in_("ticker", list(announced)) \
        .execute()
    already_authoritative = {
        r["ticker"] for r in (have.data or [])
        if (r.get("revenue") is not None
            and r.get("net_profit") is not None
            and r.get("source", "") in AUTHORITATIVE_SOURCES)
    }

    gap = sorted(announced - already_authoritative)
    if not gap:
        return []

    companies = sb.table("companies") \
        .select("id,ticker,company_name") \
        .in_("ticker", gap) \
        .execute()
    return companies.data or []


def try_nse(sb, company: dict, target_qe: date, max_quarters: int = 4) -> tuple[int, str]:
    """Returns (written, message). Writes 0 for non-NSE tickers."""
    ticker = company["ticker"]
    if not ticker.endswith(".NS"):
        return 0, "not NSE"

    symbol = ticker.replace(".NS", "")
    try:
        filings = fetch_filings_index(symbol)
    except Exception as e:
        return 0, f"nse index: {e}"
    if not filings:
        return 0, "nse: no filings returned"

    best = pick_best_per_quarter(filings)
    best.sort(key=lambda r: parse_iso(r.get("toDate")) or date(1900, 1, 1), reverse=True)
    best = best[:max_quarters]

    written = 0
    errors: list[str] = []
    for row in best:
        xbrl_url = row.get("xbrl")
        if not xbrl_url:
            continue
        try:
            xml = nse_get_text(xbrl_url)
        except Exception as e:
            errors.append(f"xbrl fetch: {e}")
            continue
        parsed = parse_xbrl(xml)
        if parsed["revenue"] is None and parsed["net_profit"] is None:
            continue
        err = nse_write_quarter(sb, company, row, parsed)
        if err:
            errors.append(err)
        else:
            written += 1
    msg = f"wrote {written}" if written else ("; ".join(errors[:2]) or "no writable rows")
    return written, msg


def try_screener(sb, company: dict, session) -> tuple[int, str]:
    """Returns (written, message)."""
    symbol = company["ticker"].replace(".NS", "").replace(".BO", "")
    try:
        html = fetch_company_html(session, symbol)
    except Exception as e:
        return 0, f"screener fetch: {e}"
    if not html:
        return 0, "not on Screener"
    quarters, metrics = extract_quarters_table(html)
    if not quarters:
        return 0, "no quarters section"
    written = screener_upsert(sb, company, quarters, metrics)
    return written, (f"wrote {written}" if written else "no writable rows")


def mark_fetched(sb, ticker: str) -> None:
    """Re-stamp the most recent fetched event so dashboards see activity."""
    try:
        sb.table("announcement_events") \
          .update({"processed_at": datetime.utcnow().isoformat() + "Z"}) \
          .eq("ticker", ticker) \
          .eq("status", "fetched") \
          .execute()
    except Exception:
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quarter", default=os.environ.get("FETCH_QUARTER", "Q4 FY26"))
    ap.add_argument("--ticker", help="process a single ticker (bypasses gap query)")
    ap.add_argument("--window-days", type=int, default=90,
                    help="how far back to look for unresolved announcements")
    ap.add_argument("--max", type=int, default=500, help="cap tickers this run")
    ap.add_argument("--throttle-ms", type=int, default=400,
                    help="sleep between per-ticker passes to be polite")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    qe = quarter_end_for(args.quarter)
    if not qe:
        print(f"Bad quarter label: {args.quarter}", file=sys.stderr)
        return 2

    if args.ticker:
        res = sb.table("companies").select("id,ticker,company_name") \
              .eq("ticker", args.ticker.upper()).execute()
        targets = res.data or []
    else:
        targets = find_gap_tickers(sb, args.quarter, args.window_days)

    if not targets:
        print(f"No gap tickers for {args.quarter}. Everything announced has numbers.")
        return 0

    targets = targets[: args.max]
    print(f"Filling gap for {args.quarter} — {len(targets)} tickers to try.\n")
    session = screener_session()

    ok, partial, missed = 0, 0, 0
    for i, c in enumerate(targets, 1):
        ticker = c["ticker"]
        written = 0
        path = []
        try:
            # Source 1: NSE XBRL (skipped for BSE-only tickers).
            w, msg = try_nse(sb, c, qe)
            written += w
            path.append(f"nse={msg}")
            if w > 0:
                nse_log_fetch(sb, ticker, "success", msg)
            elif ticker.endswith(".NS"):
                nse_log_fetch(sb, ticker, "failed", msg)

            # Source 2: Screener fallback (covers both NS and many BO).
            # Skip if NSE already wrote this run, or if the row in DB is
            # already from an authoritative source (defensive guard — the
            # gap query should have excluded such tickers, but belt+braces).
            if written == 0:
                existing = sb.table("quarterly_financials") \
                    .select("source") \
                    .eq("ticker", ticker) \
                    .eq("quarter_end_date", qe.isoformat()) \
                    .maybe_single() \
                    .execute()
                # .maybe_single().execute() returns None (not an object) when
                # no row exists in some Supabase client versions — guard it.
                existing_src = (existing.data or {}).get("source", "") if existing else ""
                if existing_src in AUTHORITATIVE_SOURCES:
                    path.append(f"screener=skipped (authoritative {existing_src} already present)")
                else:
                    w, msg = try_screener(sb, c, session)
                    written += w
                    path.append(f"screener={msg}")
                    if w > 0:
                        screener_log_fetch(sb, ticker, "success", msg)
                    else:
                        screener_log_fetch(sb, ticker, "failed", msg)

            if written > 0:
                mark_fetched(sb, ticker)
                ok += 1
                print(f"[{i:3d}/{len(targets)}] {ticker:<18} OK     — {' | '.join(path)}")
            else:
                # Not a hard error — filings often land hours after the
                # calendar confirms. Next cron will retry.
                missed += 1
                print(f"[{i:3d}/{len(targets)}] {ticker:<18} miss   — {' | '.join(path)}")
        except Exception as e:
            missed += 1
            print(f"[{i:3d}/{len(targets)}] {ticker:<18} ERROR  — {e}", file=sys.stderr)

        if args.throttle_ms > 0:
            time.sleep(args.throttle_ms / 1000)

    print(f"\nDone. {ok} filled, {missed} still pending (will retry next pass).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
