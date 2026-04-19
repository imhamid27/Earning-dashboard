"""
NSE quarterly-results fetcher.

For each company:
  1. GET /api/corporates-financial-results?symbol=<SYM>&period=Quarterly
     → list of all historical filings (each has an `xbrl` URL)
  2. For each unique quarter: download the XBRL file, parse the financial
     tags, and upsert into `quarterly_financials`.

XBRL tags we extract (namespace `in-bse-fin:`):
  - RevenueFromOperations
  - ProfitLossForPeriod / ProfitLossForPeriodFromContinuingOperations
  - ProfitBeforeTax (used as operating proxy if EBITDA not present)
  - BasicEarningsPerShare / DilutedEarningsPerShare

All XBRL values are already in raw rupees (not crores), unlike BSE's feed.
Matches our database schema directly.

Run:
    py scripts/nse_results.py                          # all pending-due today
    py scripts/nse_results.py --ticker RELIANCE.NS
    py scripts/nse_results.py --all                    # every tracked company
    py scripts/nse_results.py --quarters 8             # last N quarters per co
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import traceback
from datetime import date, datetime, timedelta
from typing import Any, Iterable

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

from supabase import create_client

from nse_common import nse_get, nse_get_text


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")


# XBRL tag aliases — Indian filings have used several over the years.
# Order matters: first hit wins.
# Banks and insurers file under a different Ind-AS schema (ind-bse-bank,
# ind-bse-life-ins) — we check their tag names too.
TAG_ALIASES: dict[str, list[str]] = {
    "revenue": [
        # Manufacturing/services
        "RevenueFromOperations",
        "IncomeFromOperations",
        "RevenueFromOperationsNet",
        # Banks — "Interest Earned" is the banking-industry equivalent
        "InterestEarned",
        # Insurers — "Net premium earned"
        "NetPremiumEarned",
        # Broad fallbacks
        "TotalRevenueFromOperations",
        "TotalIncomeFromOperations",
        "TotalIncome",
    ],
    "net_profit": [
        "ProfitLossForPeriod",
        "ProfitLossForPeriodFromContinuingOperations",
        "ProfitLossAfterTax",
        "NetProfitLossForPeriod",
        # Banks
        "NetProfitLossForThePeriod",
        "ProfitLoss",
    ],
    "operating_profit": [
        "ProfitBeforeInterestAndTax",
        "EBITDAEarningsBeforeInterestTaxDepreciationAndAmortization",
        "ProfitBeforeTax",
        "OperatingProfitLoss",
        # Banks
        "OperatingProfitBeforeProvisionsAndContingencies",
    ],
    "eps_basic": [
        "BasicEarningsLossPerShareFromContinuingOperations",
        "BasicEarningsLossPerShare",
        "BasicEarningsPerShare",
    ],
}


# Captures <ns:Tag ... contextRef="..." unitRef="INR" decimals="-7">value</...>
# `(?s)` lets `.` span newlines (XBRL attributes sometimes wrap).
TAG_RE_CACHE: dict[str, re.Pattern] = {}


def tag_regex(name: str) -> re.Pattern:
    if name not in TAG_RE_CACHE:
        # Match any namespace prefix (in-bse-fin, xbrli, etc.).
        pat = rf"<[^>]+:{re.escape(name)}\b([^>]*)>([^<]*)</[^>]+:{re.escape(name)}>"
        TAG_RE_CACHE[name] = re.compile(pat, re.DOTALL)
    return TAG_RE_CACHE[name]


def pick_tag(xbrl: str, aliases: list[str], prefer_context: str | None = None) -> float | None:
    """Find the first matching tag. If `prefer_context` is given, prefer a
    match with that contextRef — XBRL filings include 3 or 4 periods (current
    quarter, YoY, 9 months, full year) and the contextRef disambiguates."""
    hits: list[tuple[str, float]] = []
    for tag in aliases:
        for m in tag_regex(tag).finditer(xbrl):
            attrs, val = m.group(1), m.group(2).strip()
            if not val:
                continue
            try:
                n = float(val.replace(",", ""))
            except ValueError:
                continue
            ctx_match = re.search(r'contextRef="([^"]+)"', attrs)
            ctx = ctx_match.group(1) if ctx_match else ""
            hits.append((ctx, n))
        if hits:
            break
    if not hits:
        return None
    # Prefer a "current quarter, single period" context — NSE calls these
    # OneD, ThreeMonth, CurrentQuarter, etc. Skip cumulative contexts.
    preferred_markers = ("OneD", "ThreeMonth", "Current", "CurrQtr", "cur")
    cumulative_markers = ("NineM", "SixM", "YearToDate", "Annual", "Twelve")
    non_cumulative = [h for h in hits if not any(m in h[0] for m in cumulative_markers)]
    candidates = non_cumulative or hits
    for markers in (preferred_markers,):
        for ctx, v in candidates:
            if any(m in ctx for m in markers):
                return v
    # Fall back to the first non-cumulative hit.
    return candidates[0][1]


def parse_xbrl(xml: str) -> dict[str, float | None]:
    return {
        "revenue":          pick_tag(xml, TAG_ALIASES["revenue"]),
        "net_profit":       pick_tag(xml, TAG_ALIASES["net_profit"]),
        "operating_profit": pick_tag(xml, TAG_ALIASES["operating_profit"]),
        "eps":              pick_tag(xml, TAG_ALIASES["eps_basic"]),
    }


def parse_iso(raw: str | None) -> date | None:
    if not raw:
        return None
    s = raw.strip()
    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s[:len(fmt) + 4], fmt).date()
        except ValueError:
            continue
    return None


def to_fiscal(d: date) -> tuple[int, int, str]:
    m, y = d.month, d.year
    if 4 <= m <= 6:    fq, fy = 1, y + 1
    elif 7 <= m <= 9:  fq, fy = 2, y + 1
    elif 10 <= m <= 12:fq, fy = 3, y + 1
    else:              fq, fy = 4, y
    return fy, fq, f"Q{fq} FY{str(fy)[-2:]}"


def normalize_period_end(d: date) -> date:
    m, y = d.month, d.year
    if 4 <= m <= 6:   return date(y, 6, 30)
    if 7 <= m <= 9:   return date(y, 9, 30)
    if 10 <= m <= 12: return date(y, 12, 31)
    return date(y, 3, 31)


def rank_filing(row: dict) -> tuple[int, int, str]:
    """Lower is better: prefer Consolidated, then latest filingDate."""
    consolidated = (row.get("consolidated") or "").strip().upper() in ("C", "CONSOLIDATED", "YES", "Y", "TRUE")
    kind_score = 0 if consolidated else 1
    filing_raw = row.get("filingDate") or row.get("exchdisstime") or "2000-01-01"
    # Parse various filingDate formats — we only need a comparable string.
    return (kind_score, -len(filing_raw), filing_raw)


def pick_best_per_quarter(filings: list[dict]) -> list[dict]:
    """Collapse the filings list to one row per quarter, preferring
    consolidated + latest."""
    best: dict[str, dict] = {}
    for row in filings:
        to_d = parse_iso(row.get("toDate"))
        if not to_d:
            continue
        key = normalize_period_end(to_d).isoformat()
        if key not in best or rank_filing(row) < rank_filing(best[key]):
            best[key] = row
    return list(best.values())


def fetch_filings_index(symbol: str) -> list[dict]:
    """Historical quarterly filings index for one NSE symbol."""
    data = nse_get("/api/corporates-financial-results", params={
        "index": "equities",
        "period": "Quarterly",
        "symbol": symbol,
    })
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("data") or data.get("filings") or []
    return []


def write_quarter(sb, company: dict, filing: dict, parsed: dict[str, float | None]) -> str | None:
    to_d = parse_iso(filing.get("toDate"))
    if not to_d:
        return "no toDate"
    pe = normalize_period_end(to_d)
    fy, fq, label = to_fiscal(pe)

    missing = sum(v is None for v in (parsed["revenue"], parsed["net_profit"]))
    quality = "ok" if missing == 0 else ("partial" if missing == 1 else "missing")

    row = {
        "company_id": company["id"],
        "ticker": company["ticker"],
        "quarter_label": label,
        "quarter_end_date": pe.isoformat(),
        "fiscal_year": fy,
        "fiscal_quarter": fq,
        "revenue":          parsed["revenue"],
        "net_profit":       parsed["net_profit"],
        "operating_profit": parsed["operating_profit"],
        "eps":              parsed["eps"],
        "currency": "INR",
        "source": "nse",
        "raw_json": filing,
        "data_quality_status": quality,
        "fetched_at": datetime.utcnow().isoformat() + "Z",
    }
    sb.table("quarterly_financials").upsert(
        row, on_conflict="ticker,quarter_end_date"
    ).execute()
    return None


def log_fetch(sb, ticker: str, status: str, message: str) -> None:
    try:
        sb.table("fetch_logs").insert({
            "ticker": ticker, "source": "nse",
            "fetch_status": status, "message": message[:2000],
        }).execute()
    except Exception as e:
        print(f"[warn] fetch_logs insert failed: {e}", file=sys.stderr)


def mark_events(sb, ticker: str, status: str) -> None:
    try:
        sb.table("announcement_events") \
          .update({"status": status, "processed_at": datetime.utcnow().isoformat() + "Z"}) \
          .eq("ticker", ticker).eq("status", "pending") \
          .lte("announcement_date", date.today().isoformat()) \
          .execute()
    except Exception as e:
        print(f"[warn] status update for {ticker} failed: {e}", file=sys.stderr)


def resolve_companies(sb, args) -> list[dict]:
    if args.ticker:
        res = sb.table("companies").select("id,ticker,company_name") \
              .eq("ticker", args.ticker.upper()).execute()
        return res.data or []
    if args.all:
        res = sb.table("companies").select("id,ticker,company_name") \
              .eq("is_active", True).execute()
        return res.data or []

    # Default: process companies whose announcement_date was today or very
    # recently and which still have 'pending' events.
    today = date.today().isoformat()
    cutoff = (date.today() - timedelta(days=args.grace)).isoformat()
    events = sb.table("announcement_events") \
        .select("ticker") \
        .eq("status", "pending") \
        .gte("announcement_date", cutoff) \
        .lte("announcement_date", today) \
        .execute()
    tickers = sorted({e["ticker"] for e in events.data or []})
    if not tickers:
        return []
    res = sb.table("companies").select("id,ticker,company_name") \
          .in_("ticker", tickers).execute()
    return res.data or []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", help="single ticker (e.g. RELIANCE.NS)")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--grace", type=int, default=3, help="days back to keep retrying pending events")
    ap.add_argument("--quarters", type=int, default=8, help="max quarters per company (default 8)")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    targets = resolve_companies(sb, args)
    if not targets:
        print("No companies to process. (Run scripts/nse_calendar.py first, "
              "or pass --ticker / --all.)")
        return 0

    print(f"Processing {len(targets)} companies from NSE filings...")
    ok_count = 0
    fail_count = 0
    for i, c in enumerate(targets, 1):
        ticker = c["ticker"]
        symbol = ticker.replace(".NS", "")
        try:
            filings = fetch_filings_index(symbol)
            if not filings:
                log_fetch(sb, ticker, "failed", "no filings returned from NSE")
                fail_count += 1
                print(f"[{i:3d}/{len(targets)}] {ticker:<16} no filings")
                continue

            # Best one per quarter, newest first, limited to --quarters.
            best = pick_best_per_quarter(filings)
            best.sort(key=lambda r: parse_iso(r.get("toDate")) or date(1900,1,1), reverse=True)
            best = best[: args.quarters]

            written = 0
            errors: list[str] = []
            for row in best:
                xbrl_url = row.get("xbrl")
                if not xbrl_url:
                    errors.append("no xbrl link")
                    continue
                try:
                    xml = nse_get_text(xbrl_url)
                except Exception as e:
                    errors.append(f"xbrl fetch: {e}")
                    continue
                parsed = parse_xbrl(xml)
                if parsed["revenue"] is None and parsed["net_profit"] is None:
                    errors.append("no revenue/profit tags")
                    continue
                err = write_quarter(sb, c, row, parsed)
                if err:
                    errors.append(err)
                else:
                    written += 1

            mark_events(sb, ticker, "fetched" if written > 0 else "missed")
            if written > 0:
                ok_count += 1
                msg = f"wrote {written}"
                if errors: msg += f" (skipped {len(errors)})"
                log_fetch(sb, ticker, "success", msg)
                print(f"[{i:3d}/{len(targets)}] {ticker:<16} {msg}")
            else:
                fail_count += 1
                log_fetch(sb, ticker, "failed", "; ".join(errors[:3]) or "no writable rows")
                print(f"[{i:3d}/{len(targets)}] {ticker:<16} no writable rows — {errors[:2]}")
        except Exception as e:
            fail_count += 1
            log_fetch(sb, ticker, "failed", str(e))
            print(f"[{i:3d}/{len(targets)}] {ticker:<16} ERROR {e}", file=sys.stderr)

    print(f"\nDone. {ok_count} ok, {fail_count} failed.")
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
