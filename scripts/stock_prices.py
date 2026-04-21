"""
Batch stock-price fetcher.

Pulls last traded price + prior-day close for every active company in the
universe (~1,080 tickers), writes a snapshot to `fetch_logs` with
source='stock_price'. The dashboard's /api/prices endpoint reads the
latest row per ticker and serves it to the company page + data table.

Design tradeoffs:

  1. yfinance's per-ticker fast_info makes one HTTP call per ticker,
     which at 1,080 companies would take ~10 minutes and get
     rate-limited. Instead we use yf.download() in batches of 200 with
     period='5d' — a single call returns OHLCV for every ticker in the
     batch. Total wall time: ~40-60s for the full universe.
  2. We store snapshots in fetch_logs (append) rather than a dedicated
     stock_prices table because that keeps this change purely additive
     — no migration needed. To bound row count, the script deletes
     every stock_price row older than 3 days at the start of each run.
  3. The previous_close we use is the LAST row of the 5-day window,
     second from the end if today's market is open. Today's close is
     computed from the last row (which during market hours is live).

Schedule: every 15 minutes during NSE trading hours (09:15-15:30 IST
Monday-Friday), plus one snapshot 30 minutes after close to capture
the official day close.

Usage:
  py scripts/stock_prices.py                  # all active tickers
  py scripts/stock_prices.py --limit 50       # first 50 only (debug)
  py scripts/stock_prices.py --ticker HCLTECH.NS
"""

from __future__ import annotations

import argparse
import json
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
import pandas as pd  # noqa: F401 — imported indirectly by yfinance, used below
from supabase import create_client


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

BATCH_SIZE = 200     # yfinance handles ~200 tickers cleanly per call
PURGE_AFTER_DAYS = 3 # keep only the last 3 days of stock_price rows


def list_tickers(sb, one_ticker: str | None, limit: int | None) -> list[str]:
    q = sb.table("companies").select("ticker").eq("is_active", True)
    if one_ticker:
        q = q.eq("ticker", one_ticker.upper())
    rows = q.execute().data or []
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    return tickers[:limit] if limit else tickers


def fetch_batch(tickers: list[str]) -> dict[str, dict[str, Any]]:
    """Call yf.download for one batch. Returns
       {ticker: {last_price, previous_close, day_high, day_low, volume}}
       for tickers that came back with usable data."""
    # period='5d' covers the gap across weekends/holidays. interval='1d'
    # gives us daily OHLCV rows. group_by='ticker' yields a multi-index
    # DataFrame keyed on ticker → (Open, High, Low, Close, Adj Close, Volume).
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
        print(f"[warn] yf.download failed: {e}", file=sys.stderr)
        return {}

    if df is None or df.empty:
        return {}

    out: dict[str, dict[str, Any]] = {}
    # Single-ticker downloads return a flat DataFrame with top-level columns;
    # multi-ticker returns a 2-level column MultiIndex. Normalise.
    is_multi = isinstance(df.columns, pd.MultiIndex)

    for t in tickers:
        try:
            if is_multi:
                if t not in df.columns.get_level_values(0):
                    continue
                sub = df[t]
            else:
                sub = df
            # Yahoo sometimes returns a row with Volume but NaN Close for the
            # current trading day mid-session — keep only rows with a real
            # Close, then work off that cleaned series.
            sub = sub.dropna(subset=["Close"])
            if sub.empty:
                continue

            last_close  = float(sub["Close"].iloc[-1])
            prev_close  = float(sub["Close"].iloc[-2]) if len(sub) >= 2 else last_close
            day_high    = float(sub["High"].iloc[-1]) if "High" in sub else last_close
            day_low     = float(sub["Low"].iloc[-1])  if "Low"  in sub else last_close
            volume_raw  = sub["Volume"].iloc[-1] if "Volume" in sub else 0.0
            volume      = float(volume_raw) if math.isfinite(float(volume_raw)) else 0.0

            if not (math.isfinite(last_close) and math.isfinite(prev_close)):
                continue
            if prev_close == 0:
                continue

            change_pct = (last_close - prev_close) / prev_close
            out[t] = {
                "last_price":      round(last_close, 2),
                "previous_close":  round(prev_close, 2),
                "change_pct":      round(change_pct, 6),
                "day_high":        round(day_high, 2),
                "day_low":         round(day_low, 2),
                "volume":          int(volume),
            }
        except Exception:
            # Per-ticker errors are expected (delisted, renamed, etc.).
            # Skip silently — we've got 1,000+ others to process.
            continue
    return out


def purge_old(sb) -> int:
    """Delete stock_price rows older than PURGE_AFTER_DAYS so fetch_logs
    doesn't balloon unboundedly. Runs at the start of each sweep."""
    cutoff = (datetime.utcnow() - timedelta(days=PURGE_AFTER_DAYS)).isoformat() + "Z"
    try:
        res = sb.table("fetch_logs") \
            .delete() \
            .eq("source", "stock_price") \
            .lt("fetched_at", cutoff) \
            .execute()
        return len(res.data or [])
    except Exception as e:
        print(f"[warn] purge failed: {e}", file=sys.stderr)
        return 0


def write_snapshots(sb, data: dict[str, dict[str, Any]]) -> int:
    """Insert one fetch_logs row per ticker. Batches to avoid the 1000-row
    default limit on supabase inserts."""
    if not data:
        return 0
    now = datetime.utcnow().isoformat() + "Z"
    rows = [
        {
            "ticker": t,
            "source": "stock_price",
            "fetch_status": "success",
            "message": json.dumps(info),
            "fetched_at": now,
        }
        for t, info in data.items()
    ]
    written = 0
    BATCH = 500
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        try:
            sb.table("fetch_logs").insert(chunk).execute()
            written += len(chunk)
        except Exception as e:
            print(f"[warn] insert batch {i} failed: {e}", file=sys.stderr)
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", help="single ticker (debug)")
    ap.add_argument("--limit",  type=int, help="process at most N tickers (debug)")
    ap.add_argument("--skip-purge", action="store_true",
                    help="don't delete old rows at the start")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
              file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    if not args.skip_purge:
        purged = purge_old(sb)
        if purged:
            print(f"Purged {purged} stock_price rows older than {PURGE_AFTER_DAYS}d")

    tickers = list_tickers(sb, args.ticker, args.limit)
    if not tickers:
        print("No tickers to process.")
        return 0

    print(f"Fetching prices for {len(tickers)} tickers in batches of {BATCH_SIZE}...")

    all_data: dict[str, dict[str, Any]] = {}
    for i in range(0, len(tickers), BATCH_SIZE):
        chunk = tickers[i:i + BATCH_SIZE]
        print(f"  batch {i // BATCH_SIZE + 1}/{(len(tickers) - 1) // BATCH_SIZE + 1}: {len(chunk)} tickers", end=" ")
        t0 = time.time()
        batch_result = fetch_batch(chunk)
        all_data.update(batch_result)
        elapsed = time.time() - t0
        print(f"→ {len(batch_result)} prices ({elapsed:.1f}s)")
        # Yahoo's unofficial API gets unhappy about back-to-back floods.
        if i + BATCH_SIZE < len(tickers):
            time.sleep(2)

    written = write_snapshots(sb, all_data)
    print(f"\nWrote {written}/{len(tickers)} price snapshots.")
    return 0 if written > 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
