"""
One-time backfill of stock_price_history with 2 years of daily OHLCV.

Fetches from Yahoo Finance (yfinance) in batches of 200 tickers —
same approach as stock_prices.py, which already handles the full
~1,080-ticker universe reliably.

Safe to re-run: all writes use upsert (on_conflict ticker+date) so
duplicate rows are never created. Existing data in ALL other tables
is never touched.

Usage:
  py scripts/backfill_price_history.py               # full universe, 2 years
  py scripts/backfill_price_history.py --limit 50    # first 50 tickers (test)
  py scripts/backfill_price_history.py --ticker RELIANCE.NS  # single ticker
  py scripts/backfill_price_history.py --period 1y   # shorter period (default 2y)

Expect ~5-10 minutes for the full universe.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time
import traceback
from datetime import date, datetime
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import yfinance as yf
import pandas as pd
from supabase import create_client

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

BATCH_SIZE   = 100   # smaller than stock_prices.py — longer period = more data per call
UPSERT_CHUNK = 500   # rows per Supabase upsert call


def list_tickers(sb, one_ticker: str | None, limit: int | None) -> list[str]:
    q = sb.table("companies").select("ticker").eq("is_active", True)
    if one_ticker:
        q = q.eq("ticker", one_ticker.upper())
    rows = q.execute().data or []
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    return tickers[:limit] if limit else tickers


def fetch_batch(tickers: list[str], period: str) -> list[dict[str, Any]]:
    """Download OHLCV for a batch. Returns a flat list of row dicts."""
    try:
        df = yf.download(
            tickers=" ".join(tickers),
            period=period,
            interval="1d",
            group_by="ticker",
            auto_adjust=False,
            progress=False,
            threads=True,
        )
    except Exception as e:
        print(f"  [warn] yf.download failed: {e}", file=sys.stderr)
        return []

    if df is None or df.empty:
        return []

    rows: list[dict[str, Any]] = []
    is_multi = isinstance(df.columns, pd.MultiIndex)

    for t in tickers:
        try:
            if is_multi:
                if t not in df.columns.get_level_values(0):
                    continue
                sub = df[t]
            else:
                sub = df

            sub = sub.dropna(subset=["Close"])
            if sub.empty:
                continue

            for idx, row in sub.iterrows():
                close_val = row.get("Close")
                adj_val   = row.get("Adj Close")

                if close_val is None or not math.isfinite(float(close_val)):
                    continue

                def safe(v) -> float | None:
                    try:
                        f = float(v)
                        return round(f, 4) if math.isfinite(f) else None
                    except Exception:
                        return None

                trade_date = idx.date() if hasattr(idx, "date") else date.fromisoformat(str(idx)[:10])

                rows.append({
                    "ticker":    t,
                    "date":      trade_date.isoformat(),
                    "open":      safe(row.get("Open")),
                    "high":      safe(row.get("High")),
                    "low":       safe(row.get("Low")),
                    "close":     safe(close_val),
                    "adj_close": safe(adj_val),
                    "volume":    int(float(row["Volume"])) if row.get("Volume") and math.isfinite(float(row["Volume"])) else None,
                })
        except Exception:
            continue

    return rows


def upsert_rows(sb, rows: list[dict[str, Any]]) -> int:
    """Upsert rows into stock_price_history in chunks."""
    if not rows:
        return 0
    written = 0
    for i in range(0, len(rows), UPSERT_CHUNK):
        chunk = rows[i:i + UPSERT_CHUNK]
        try:
            sb.table("stock_price_history").upsert(
                chunk,
                on_conflict="ticker,date"
            ).execute()
            written += len(chunk)
        except Exception as e:
            print(f"  [warn] upsert chunk {i} failed: {e}", file=sys.stderr)
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", help="single ticker (debug)")
    ap.add_argument("--limit",  type=int, help="process at most N tickers")
    ap.add_argument("--period", default="2y",
                    help="yfinance period string: 1y, 2y, 5y (default: 2y)")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    tickers = list_tickers(sb, args.ticker, args.limit)

    if not tickers:
        print("No tickers found.")
        return 0

    print(f"Backfilling {len(tickers)} tickers · period={args.period} · batch={BATCH_SIZE}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    total_rows = 0
    total_batches = math.ceil(len(tickers) / BATCH_SIZE)

    for i in range(0, len(tickers), BATCH_SIZE):
        chunk = tickers[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        print(f"  batch {batch_num}/{total_batches}: {len(chunk)} tickers ...", end=" ", flush=True)
        t0 = time.time()

        rows = fetch_batch(chunk, args.period)
        written = upsert_rows(sb, rows)
        total_rows += written

        elapsed = time.time() - t0
        print(f"{written} rows ({elapsed:.1f}s)")

        if i + BATCH_SIZE < len(tickers):
            time.sleep(3)  # be polite to Yahoo's API

    print(f"\nDone. Total rows written: {total_rows}")
    print(f"Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
