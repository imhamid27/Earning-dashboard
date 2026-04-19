"""
Screener.in fallback scraper.

Used when NSE has no usable filings for a company (e.g. TATAMOTORS post
demerger, LTIM post-merger, or life-insurance companies whose schema NSE
doesn't expose cleanly). Screener.in's per-company page is public HTML and
shows the last 13 quarters in a clean table:

    Sales, Expenses, Operating Profit, OPM%, Other Income, Interest,
    Depreciation, Profit before tax, Tax%, Net Profit, EPS in Rs

All values are already in ₹ crores — we multiply by 10,000,000 to store
raw rupees (matching our NSE + Yahoo paths).

Run:
    py scripts/screener_results.py --ticker TATAMOTORS.NS
    py scripts/screener_results.py --missing    # only companies with <2 quarters
    py scripts/screener_results.py --all
"""

from __future__ import annotations

import argparse
import os
import re
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
from curl_cffi import requests as cffi_requests


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

CRORE = 10_000_000
SCREENER_BASE = "https://www.screener.in"

MONTHS = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,
          "Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}


def screener_session():
    return cffi_requests.Session(impersonate="chrome")


def fetch_company_html(session, symbol: str) -> str | None:
    """Try consolidated first, standalone fallback. Returns HTML or None."""
    for variant in ("consolidated", ""):
        path = f"/company/{symbol}/"
        if variant:
            path += variant + "/"
        url = SCREENER_BASE + path
        r = session.get(url, timeout=25)
        if r.status_code == 200 and "quarters" in r.text:
            return r.text
    return None


def parse_quarter_label(header: str) -> date | None:
    """Header is 'Mar 2026' etc. Returns the canonical quarter-end date."""
    clean = re.sub(r"\s+", " ", header).strip()
    m = re.search(r"([A-Z][a-z]{2})\s*(\d{4})", clean)
    if not m:
        return None
    mon = MONTHS.get(m.group(1))
    yr  = int(m.group(2))
    if not mon:
        return None
    last_day = {1:31,2:28,3:31,4:30,5:31,6:30,7:31,8:31,9:30,10:31,11:30,12:31}[mon]
    # Screener only shows quarter-end months — trust the label.
    return date(yr, mon, last_day)


def parse_value(raw: str) -> float | None:
    """Turn '1,234' or '-358' into a float. '' / '-' → None."""
    if raw is None:
        return None
    s = raw.strip().replace("&nbsp;", "").replace(",", "")
    if s in ("", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def extract_quarters_table(html: str) -> tuple[list[date], dict[str, list[float | None]]]:
    """Pull the quarter columns + each metric row out of the #quarters section."""
    m = re.search(r'<section[^>]*id="quarters"[\s\S]*?</section>', html)
    if not m:
        return [], {}
    section = m.group(0)

    # Column headers → dates. Keep only the ones that parse to quarter-end dates.
    raw_ths = re.findall(r"<th[^>]*>([^<]+)</th>", section)
    quarters: list[date] = []
    for th in raw_ths:
        q = parse_quarter_label(th)
        if q is not None:
            quarters.append(q)

    # Row labels we care about → metric keys in our schema.
    wanted_labels = {
        "sales":            "revenue",
        "revenue":          "revenue",           # some pages use "Revenue"
        "operating profit": "operating_profit",
        "net profit":       "net_profit",
        "eps in rs":        "eps",
    }

    # Find each <tr>, its label, and the cell values.
    out: dict[str, list[float | None]] = {}
    for row in re.findall(r"<tr[^>]*>([\s\S]*?)</tr>", section):
        label_m = re.search(
            r'<td[^>]*class="text"[^>]*>\s*(?:<button[^>]*>)?\s*([^<]+)',
            row
        )
        if not label_m:
            continue
        label = label_m.group(1).replace("&nbsp;", "").strip().lower()
        if label not in wanted_labels:
            continue
        raw_cells = re.findall(r"<td[^>]*>([^<]*)</td>", row)
        # Sometimes the label also appears as a cell; skip it.
        cells = [parse_value(c) for c in raw_cells if not re.search(r"[A-Za-z]{3}", c or "")]
        # Trim to the quarter count (Screener sometimes includes an "expand" cell).
        cells = cells[: len(quarters)]
        out[wanted_labels[label]] = cells
    return quarters, out


def to_fiscal(d: date) -> tuple[int, int, str]:
    m, y = d.month, d.year
    if 4 <= m <= 6:    fq, fy = 1, y + 1
    elif 7 <= m <= 9:  fq, fy = 2, y + 1
    elif 10 <= m <= 12:fq, fy = 3, y + 1
    else:              fq, fy = 4, y
    return fy, fq, f"Q{fq} FY{str(fy)[-2:]}"


def upsert_company(sb, company: dict, quarters: list[date], metrics: dict[str, list[float | None]]) -> int:
    if not quarters:
        return 0
    written = 0
    for i, q in enumerate(quarters):
        rev_cr  = (metrics.get("revenue")          or [None]*len(quarters))[i]
        np_cr   = (metrics.get("net_profit")       or [None]*len(quarters))[i]
        op_cr   = (metrics.get("operating_profit") or [None]*len(quarters))[i]
        eps     = (metrics.get("eps")              or [None]*len(quarters))[i]
        if rev_cr is None and np_cr is None:
            continue
        missing = sum(v is None for v in (rev_cr, np_cr))
        quality = "ok" if missing == 0 else ("partial" if missing == 1 else "missing")

        fy, fq, label = to_fiscal(q)
        row = {
            "company_id": company["id"],
            "ticker": company["ticker"],
            "quarter_label": label,
            "quarter_end_date": q.isoformat(),
            "fiscal_year": fy,
            "fiscal_quarter": fq,
            "revenue":          rev_cr * CRORE if rev_cr is not None else None,
            "net_profit":       np_cr  * CRORE if np_cr  is not None else None,
            "operating_profit": op_cr  * CRORE if op_cr  is not None else None,
            "eps": eps,
            "currency": "INR",
            "source": "screener",
            "raw_json": {
                "source_url": f"{SCREENER_BASE}/company/{company['ticker'].replace('.NS','')}/consolidated/",
                "quarter_header": q.isoformat(),
                "sales_cr": rev_cr, "np_cr": np_cr, "op_cr": op_cr, "eps": eps,
            },
            "data_quality_status": quality,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }
        sb.table("quarterly_financials").upsert(
            row, on_conflict="ticker,quarter_end_date"
        ).execute()
        written += 1
    return written


def resolve_targets(sb, args) -> list[dict]:
    if args.ticker:
        res = sb.table("companies").select("id,ticker,company_name") \
              .eq("ticker", args.ticker.upper()).execute()
        return res.data or []
    if args.all:
        res = sb.table("companies").select("id,ticker,company_name") \
              .eq("is_active", True).execute()
        return res.data or []
    if args.missing:
        # Tickers with fewer than 2 quarters in the DB — our "gap".
        base = sb.table("companies").select("id,ticker,company_name") \
               .eq("is_active", True).execute()
        counts = sb.table("quarterly_financials") \
                 .select("ticker", count="exact") \
                 .execute()  # this counts total rows; we filter per-ticker below
        # Per-ticker count requires a separate query — cheapest is to pull
        # the distinct tickers we have data for and subtract.
        have = sb.table("quarterly_financials").select("ticker").execute()
        have_counts: dict[str, int] = {}
        for r in (have.data or []):
            have_counts[r["ticker"]] = have_counts.get(r["ticker"], 0) + 1
        return [c for c in (base.data or []) if have_counts.get(c["ticker"], 0) < 2]
    # Default: companies missing any data at all.
    base = sb.table("companies").select("id,ticker,company_name").eq("is_active", True).execute()
    have = sb.table("quarterly_financials").select("ticker").execute()
    have_tickers = {r["ticker"] for r in (have.data or [])}
    return [c for c in (base.data or []) if c["ticker"] not in have_tickers]


def log_fetch(sb, ticker: str, status: str, message: str) -> None:
    try:
        sb.table("fetch_logs").insert({
            "ticker": ticker, "source": "screener",
            "fetch_status": status, "message": message[:2000],
        }).execute()
    except Exception as e:
        print(f"[warn] fetch_logs insert failed: {e}", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", help="single ticker (e.g. TATAMOTORS.NS)")
    ap.add_argument("--all",     action="store_true")
    ap.add_argument("--missing", action="store_true",
                    help="companies with <2 quarters already in DB")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    session = screener_session()

    targets = resolve_targets(sb, args)
    if not targets:
        print("No targets — pass --ticker or --all or --missing.")
        return 0

    print(f"Scraping Screener.in for {len(targets)} companies...")
    ok_count = 0
    fail_count = 0
    for i, c in enumerate(targets, 1):
        symbol = c["ticker"].replace(".NS", "")
        try:
            html = fetch_company_html(session, symbol)
            if not html:
                log_fetch(sb, c["ticker"], "failed", "page not found on Screener (404)")
                fail_count += 1
                print(f"[{i:3d}/{len(targets)}] {c['ticker']:<16} not on Screener")
                continue
            quarters, metrics = extract_quarters_table(html)
            if not quarters:
                log_fetch(sb, c["ticker"], "failed", "no quarters section")
                fail_count += 1
                print(f"[{i:3d}/{len(targets)}] {c['ticker']:<16} no #quarters section")
                continue
            written = upsert_company(sb, c, quarters, metrics)
            if written > 0:
                ok_count += 1
                log_fetch(sb, c["ticker"], "success", f"wrote {written} quarters from screener")
                print(f"[{i:3d}/{len(targets)}] {c['ticker']:<16} wrote {written} (screener)")
            else:
                fail_count += 1
                log_fetch(sb, c["ticker"], "failed", "no writable rows")
                print(f"[{i:3d}/{len(targets)}] {c['ticker']:<16} no writable rows")
        except Exception as e:
            fail_count += 1
            log_fetch(sb, c["ticker"], "failed", str(e))
            print(f"[{i:3d}/{len(targets)}] {c['ticker']:<16} ERROR {e}", file=sys.stderr)

    print(f"\nDone. {ok_count} ok, {fail_count} failed.")
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
