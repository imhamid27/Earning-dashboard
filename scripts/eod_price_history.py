"""
Daily end-of-day price writer for stock_price_history.

Runs once after NSE market close (~15:45 IST = 10:15 UTC) to append
today's official closing OHLCV to stock_price_history.

Uses the same yf.download() batch approach as stock_prices.py.
Skips weekends and market holidays automatically — if Yahoo has no
data for today, no row is written (no stub rows with nulls).

Safe to re-run: uses upsert on (ticker, date) so a second run on
the same day just updates the row with the same values.

Never touches any existing table.

Usage:
  py scripts/eod_price_history.py               # full universe
  py scripts/eod_price_history.py --limit 50    # debug
  py scripts/eod_price_history.py --date 2026-10-25  # specific date (backfill gap)
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time
import traceback
from datetime import date, datetime, timedelta
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

BATCH_SIZE   = 200
UPSERT_CHUNK = 500


def list_tickers(sb, limit: int | None) -> list[str]:
    rows = sb.table("companies").select("ticker").eq("is_active", True).execute().data or []
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    return tickers[:limit] if limit else tickers


def fetch_eod(tickers: list[str], target_date: date) -> list[dict[str, Any]]:
    """Download the last 5 trading days and extract the target date row."""
    try:
        df = yf.download(
            tickers=" ".join(tickers),
            period="5d",
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

            # Filter to the target date only.
            sub.index = pd.to_datetime(sub.index)
            day_rows = sub[sub.index.date == target_date]
            if day_rows.empty:
                continue

            row = day_rows.iloc[0]
            close_val = row.get("Close")
            if close_val is None or not math.isfinite(float(close_val)):
                continue

            def safe(v) -> float | None:
                try:
                    f = float(v)
                    return round(f, 4) if math.isfinite(f) else None
                except Exception:
                    return None

            rows.append({
                "ticker":    t,
                "date":      target_date.isoformat(),
                "open":      safe(row.get("Open")),
                "high":      safe(row.get("High")),
                "low":       safe(row.get("Low")),
                "close":     safe(close_val),
                "adj_close": safe(row.get("Adj Close")),
                "volume":    int(float(row["Volume"])) if row.get("Volume") and math.isfinite(float(row["Volume"])) else None,
            })
        except Exception:
            continue

    return rows


def upsert_rows(sb, rows: list[dict[str, Any]]) -> int:
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
    ap.add_argument("--limit", type=int)
    ap.add_argument("--date", help="YYYY-MM-DD, defaults to today")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2

    target_date = date.fromisoformat(args.date) if args.date else date.today()

    # Skip weekends — NSE is closed Sat/Sun.
    if target_date.weekday() >= 5:
        print(f"Skipping {target_date} (weekend). Run with --date for a specific date.")
        return 0

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    tickers = list_tickers(sb, args.limit)

    if not tickers:
        print("No tickers found.")
        return 0

    print(f"EOD price history: {target_date} · {len(tickers)} tickers")
    total_batches = math.ceil(len(tickers) / BATCH_SIZE)
    total_rows = 0

    for i in range(0, len(tickers), BATCH_SIZE):
        chunk = tickers[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        print(f"  batch {batch_num}/{total_batches}: {len(chunk)} tickers ...", end=" ", flush=True)
        t0 = time.time()

        rows = fetch_eod(chunk, target_date)
        written = upsert_rows(sb, rows)
        total_rows += written

        elapsed = time.time() - t0
        print(f"{written} rows ({elapsed:.1f}s)")

        if i + BATCH_SIZE < len(tickers):
            time.sleep(2)

    print(f"Done. {total_rows} rows written for {target_date}.")
    return 0 if total_rows > 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
