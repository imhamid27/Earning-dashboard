"""
generate_commentary.py — Part 5 of the Corporate Earnings Dashboard upgrade.

Auto-generates factual one-sentence commentary for each newly filed
quarterly result and upserts it into the `live_commentary` table.

Rules (from spec):
  - Factual only — no speculation, no adjectives not backed by a number.
  - Max 25 words per entry.
  - Trigger on new results (only processes rows updated in the last 4 hours
    by default, so the cron doesn't rewrite already-good entries).
  - Prioritise large companies (LARGE cap first) and outliers (big movers).
  - Limit: top 20 entries per run (keeps the live block snappy).

Sentence templates (in priority order):
  1. Sign-flip: "Reliance turned profitable in Q4 FY26, reporting net profit
     of ₹1,234 Cr after a loss in the prior year."
  2. Strong double beat: "Infosys posted 18.2% revenue growth and 22.5% profit
     growth YoY in Q4 FY26."
  3. Margin expansion: "TCS grew revenue 12% YoY in Q4 FY26 with profit
     outpacing top-line growth at +18.4%."
  4. Margin pressure: "HDFC Bank revenue rose 9.1% YoY in Q4 FY26, but profit
     fell 5.3%."
  5. Both declining: "Wipro Q4 FY26: revenue down 4.2% and profit fell 8.1%
     YoY."
  6. Single metric: "Asian Paints reported net profit of ₹890 Cr in Q4 FY26,
     up 24.3% YoY."

Run:
    py scripts/generate_commentary.py              # last 4h of new data
    py scripts/generate_commentary.py --all        # all rows in current quarter
    py scripts/generate_commentary.py --quarter "Q4 FY26"
    py scripts/generate_commentary.py --ticker RELIANCE.NS
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

CRORE = 1_00_00_000  # 10^7

# -----------------------------------------------------------------------
# Sentinel values (must match lib/growth.ts)
# -----------------------------------------------------------------------
TURNED_PROFITABLE  =  9999
TURNED_LOSS_MAKING = -9999


def sb_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# -----------------------------------------------------------------------
# Format helpers
# -----------------------------------------------------------------------

def fmt_pct(v: float, digits: int = 1) -> str:
    """'+12.3%' / '-8.9%' — always explicit sign."""
    sign = "+" if v >= 0 else ""
    return f"{sign}{v * 100:.{digits}f}%"


def fmt_inr(rupees: float) -> str:
    """'₹1,234 Cr' — always Crores, never Lakhs."""
    cr = rupees / CRORE
    if abs(cr) >= 1000:
        return f"₹{cr:,.0f} Cr"
    if abs(cr) >= 10:
        return f"₹{cr:,.1f} Cr"
    return f"₹{cr:,.2f} Cr"


def short_name(name: str) -> str:
    """Drop corporate suffixes for natural press-reference form."""
    import re
    s = re.sub(
        r"\s+(Limited|Ltd\.?|Inc\.?|Corp\.?|Industries|Company)\b.*$",
        "", name, flags=re.IGNORECASE
    ).strip()
    return s or name


# -----------------------------------------------------------------------
# Core logic: build a factual sentence for one row
# -----------------------------------------------------------------------

def build_sentence(
    company: str,
    quarter: str,
    revenue: Optional[float],
    net_profit: Optional[float],
    revenue_yoy: Optional[float],
    profit_yoy: Optional[float],
    industry: Optional[str],
) -> Optional[str]:
    """Return a factual ≤25-word sentence, or None if there's not enough data."""
    name = short_name(company)

    # Revenue label for banks / NBFCs
    rev_label = "revenue"
    if industry:
        lo = industry.lower()
        if "bank" in lo or "nbfc" in lo or ("finance" in lo and "insurance" not in lo):
            rev_label = "total income"
        elif "insurance" in lo:
            rev_label = "premium income"

    # --- Priority 1: sign-flip events ---
    if profit_yoy == TURNED_PROFITABLE and net_profit is not None:
        np_str = fmt_inr(net_profit)
        s = f"{name} turned profitable in {quarter}, reporting net profit of {np_str} after a loss last year."
        return _cap(s)

    if profit_yoy == TURNED_LOSS_MAKING:
        if net_profit is not None:
            np_str = fmt_inr(net_profit)
            s = f"{name} reported a net loss of {np_str} in {quarter}, slipping from profit a year ago."
        else:
            s = f"{name} reported a loss in {quarter} after a profitable prior year."
        return _cap(s)

    # Ignore extreme non-sentinel YoY values (>999%) — not meaningful
    def valid_yoy(v: Optional[float]) -> Optional[float]:
        if v is None:
            return None
        if abs(v) > 9.99:
            return None
        return v

    rv = valid_yoy(revenue_yoy)
    pv = valid_yoy(profit_yoy)
    has_rev    = rv is not None
    has_profit = pv is not None

    # --- Priority 2: strong double beat ---
    if has_rev and has_profit and rv > 0.10 and pv > 0.15:  # type: ignore[operator]
        s = (
            f"{name} posted {fmt_pct(rv)} {rev_label} growth and "
            f"{fmt_pct(pv)} profit growth YoY in {quarter}."
        )
        return _cap(s)

    # --- Priority 3: margin expansion (profit outpaced revenue) ---
    if has_rev and has_profit and rv > 0 and pv > rv + 0.08:  # type: ignore[operator]
        s = (
            f"{name} grew {rev_label} {fmt_pct(rv)} YoY in {quarter} "
            f"with profit outpacing top-line growth at {fmt_pct(pv)}."
        )
        return _cap(s)

    # --- Priority 4: margin pressure ---
    if has_rev and has_profit and rv > 0.04 and pv < -0.04:  # type: ignore[operator]
        s = (
            f"{name} {rev_label} rose {fmt_pct(rv)} YoY in {quarter}, "
            f"but profit fell {fmt_pct(abs(pv))}."
        )
        return _cap(s)

    # --- Priority 5: both declining ---
    if has_rev and has_profit and rv < -0.04 and pv < -0.04:  # type: ignore[operator]
        s = (
            f"{name} {quarter}: {rev_label} down {fmt_pct(abs(rv))} "
            f"and profit fell {fmt_pct(abs(pv))} YoY."
        )
        return _cap(s)

    # --- Priority 6: single metric with actual numbers ---
    if has_profit and net_profit is not None:
        direction = "up" if pv > 0 else "down"  # type: ignore[operator]
        s = (
            f"{name} reported net profit of {fmt_inr(net_profit)} "
            f"in {quarter}, {direction} {fmt_pct(abs(pv))} YoY."
        )
        return _cap(s)

    if has_rev and revenue is not None:
        direction = "up" if rv > 0 else "down"  # type: ignore[operator]
        s = (
            f"{name} reported {rev_label} of {fmt_inr(revenue)} "
            f"in {quarter}, {direction} {fmt_pct(abs(rv))} YoY."
        )
        return _cap(s)

    # --- Priority 7: absolute numbers only — no prior-year data available ---
    # Used for first-year filers or when historical quarters aren't in the DB.
    if net_profit is not None and revenue is not None:
        s = (
            f"{name} reported {rev_label} of {fmt_inr(revenue)} "
            f"and net profit of {fmt_inr(net_profit)} in {quarter}."
        )
        return _cap(s)

    if net_profit is not None:
        s = f"{name} reported net profit of {fmt_inr(net_profit)} in {quarter}."
        return _cap(s)

    if revenue is not None:
        s = f"{name} reported {rev_label} of {fmt_inr(revenue)} in {quarter}."
        return _cap(s)

    # Not enough data to generate a useful sentence
    return None


def _cap(sentence: str) -> str:
    """Enforce ≤ 25 words. Truncates at word boundary and closes with '.'"""
    words = sentence.split()
    if len(words) <= 25:
        return sentence
    truncated = " ".join(words[:25])
    if not truncated.endswith("."):
        truncated += "."
    return truncated


# -----------------------------------------------------------------------
# Validation flags (Part 1 spec)
# -----------------------------------------------------------------------

def compute_flags(
    revenue: Optional[float],
    net_profit: Optional[float],
    profit_yoy: Optional[float],
    market_cap_bucket: Optional[str],
) -> list[str]:
    flags: list[str] = []
    CRORE_100 = 100 * CRORE

    # Large company revenue < ₹100 Cr — likely a unit mismatch
    if (
        revenue is not None
        and revenue < CRORE_100
        and market_cap_bucket == "LARGE"
    ):
        flags.append("revenue_low")

    # YoY > 1000% (10×) — from a near-zero base
    if (
        profit_yoy is not None
        and profit_yoy not in (TURNED_PROFITABLE, TURNED_LOSS_MAKING)
        and abs(profit_yoy) > 9.99
    ):
        flags.append("yoy_extreme")

    return flags


# -----------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------

def run(args: argparse.Namespace) -> None:
    sb = sb_client()

    # --- Fetch target rows ---
    since_hours = args.since_hours if not args.all else None
    cutoff: Optional[str] = None
    if since_hours is not None:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=since_hours)
        ).isoformat()

    q = (
        sb.from_("quarterly_financials")
        .select(
            "ticker, quarter_label, revenue, net_profit, "
            "data_quality_status, fetched_at, updated_at, source"
        )
        .in_("data_quality_status", ["ok", "partial"])
        .order("updated_at", desc=True)
        .limit(200)
    )

    if args.quarter:
        q = q.eq("quarter_label", args.quarter)
    elif cutoff:
        q = q.gte("updated_at", cutoff)

    if args.ticker:
        q = q.eq("ticker", args.ticker)

    resp = q.execute()
    rows = resp.data or []

    if not rows:
        print("No rows to process.")
        return

    # Fetch company metadata for names + industry + market_cap_bucket
    tickers = list({r["ticker"] for r in rows})
    co_resp = (
        sb.from_("companies")
        .select("ticker, company_name, industry, market_cap_bucket")
        .in_("ticker", tickers)
        .execute()
    )
    co_map = {c["ticker"]: c for c in (co_resp.data or [])}

    # Fetch prior-year quarter for YoY calculation
    # We do this by loading the 4Q-prior row for each ticker.
    # Build a mapping: ticker → {quarter_end_date: {revenue, net_profit}}
    fin_resp = (
        sb.from_("quarterly_financials")
        .select("ticker, quarter_end_date, revenue, net_profit")
        .in_("ticker", tickers)
        .order("quarter_end_date", desc=False)
        .execute()
    )
    fin_rows: list[dict] = fin_resp.data or []

    from collections import defaultdict
    by_ticker: dict[str, list[dict]] = defaultdict(list)
    for fr in fin_rows:
        by_ticker[fr["ticker"]].append(fr)

    def get_yoy(ticker: str, quarter_date: str, field: str) -> Optional[float]:
        history = by_ticker.get(ticker, [])
        dates = sorted(r["quarter_end_date"] for r in history)
        if quarter_date not in dates:
            return None
        idx = dates.index(quarter_date)
        if idx < 4:
            return None
        prior_date = dates[idx - 4]
        curr_row = next((r for r in history if r["quarter_end_date"] == quarter_date), None)
        prior_row = next((r for r in history if r["quarter_end_date"] == prior_date), None)
        if not curr_row or not prior_row:
            return None
        curr_v = curr_row.get(field)
        prior_v = prior_row.get(field)
        if curr_v is None or prior_v is None:
            return None
        if prior_v == 0:
            return None
        if prior_v < 0:
            if curr_v > 0:
                return TURNED_PROFITABLE
            if curr_v == 0:
                return None
            return (curr_v - prior_v) / abs(prior_v)
        if curr_v < 0:
            return TURNED_LOSS_MAKING
        return (curr_v - prior_v) / prior_v

    # We need the quarter_end_date to compute YoY — fetch it per row
    qd_resp = (
        sb.from_("quarterly_financials")
        .select("ticker, quarter_label, quarter_end_date")
        .in_("ticker", tickers)
        .execute()
    )
    qd_map: dict[tuple, str] = {
        (r["ticker"], r["quarter_label"]): r["quarter_end_date"]
        for r in (qd_resp.data or [])
    }

    # Sort: LARGE cap first, then by updated_at desc
    def sort_key(r: dict) -> tuple:
        co = co_map.get(r["ticker"], {})
        bucket = co.get("market_cap_bucket", "SMALL")
        bucket_rank = {"LARGE": 0, "MID": 1, "SMALL": 2}.get(bucket, 3)
        return (bucket_rank, r.get("updated_at", "") or "")

    rows_sorted = sorted(rows, key=sort_key)
    rows_sorted = rows_sorted[:20]  # top 20 per run

    # --- Generate + upsert ---
    inserted = 0
    skipped  = 0

    for row in rows_sorted:
        ticker  = row["ticker"]
        quarter = row["quarter_label"]
        revenue = row.get("revenue")
        profit  = row.get("net_profit")
        co      = co_map.get(ticker, {})
        company = co.get("company_name", ticker)
        industry = co.get("industry")
        bucket  = co.get("market_cap_bucket")
        qdate   = qd_map.get((ticker, quarter))

        revenue_yoy = get_yoy(ticker, qdate, "revenue") if qdate else None
        profit_yoy  = get_yoy(ticker, qdate, "net_profit") if qdate else None

        text = build_sentence(company, quarter, revenue, profit, revenue_yoy, profit_yoy, industry)
        if not text:
            skipped += 1
            print(f"  — skipped (no usable data): {ticker} {quarter}", file=sys.stderr)
            continue

        # Upsert — unique on (ticker, quarter)
        record = {
            "company":    company,
            "ticker":     ticker,
            "quarter":    quarter,
            "text":       text,
            "source":     "auto",
        }
        try:
            sb.from_("live_commentary").upsert(
                record,
                on_conflict="ticker,quarter",
                ignore_duplicates=False,
            ).execute()
            inserted += 1
            print(f"  ✓ {ticker} {quarter}: {text[:60]}…")
        except Exception as exc:
            print(f"  ✗ {ticker} {quarter}: {exc}", file=sys.stderr)

        # Write validation flags back to quarterly_financials.raw_json
        flags = compute_flags(revenue, profit, profit_yoy, bucket)
        if flags and qdate:
            try:
                existing = (
                    sb.from_("quarterly_financials")
                    .select("raw_json")
                    .eq("ticker", ticker)
                    .eq("quarter_end_date", qdate)
                    .single()
                    .execute()
                )
                raw = (existing.data or {}).get("raw_json") or {}
                raw["_data_flags"] = flags
                (
                    sb.from_("quarterly_financials")
                    .update({"raw_json": raw})
                    .eq("ticker", ticker)
                    .eq("quarter_end_date", qdate)
                    .execute()
                )
            except Exception:
                pass  # flag write is best-effort

    print(f"\nDone. inserted/updated={inserted}, skipped={skipped}")


# -----------------------------------------------------------------------
# Entry point
# -----------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate live commentary from quarterly financials."
    )
    parser.add_argument(
        "--since-hours",
        type=float,
        default=4.0,
        dest="since_hours",
        help="Only process rows updated in the last N hours (default: 4).",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Process all rows in the current quarter (ignores --since-hours).",
    )
    parser.add_argument("--quarter", help='Filter to a specific quarter, e.g. "Q4 FY26".')
    parser.add_argument("--ticker",  help="Filter to a specific ticker, e.g. RELIANCE.NS.")
    args = parser.parse_args()
    run(args)
