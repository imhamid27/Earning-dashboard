"""
Snapshot the three headline Indian indices (Nifty 50, Sensex, Bank
Nifty) and persist to Supabase so the dashboard's Markets strip can
read a rate-limit-free cache instead of hitting Yahoo from serverless.

We reuse yfinance here (already in the stack via scripts/ingest.py).
It handles Yahoo's cookie+crumb auth transparently and works reliably
from GitHub Actions / Coolify egress — much more dependable than a
bare Node fetch.

Storage: one row per index in `fetch_logs` (no migration needed).
  source='market_snapshot'
  ticker='^NSEI' | '^BSESN' | '^NSEBANK'
  message=JSON: {"name":"Nifty 50","change_pct":0.01396}
  fetched_at=now

Next.js /api/market-context reads the latest row per ticker and serves
it with a ~5-min client-facing cache on top.
"""

from __future__ import annotations

import json
import os
import sys
import traceback

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import yfinance as yf
from supabase import create_client


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

INDICES = [
    {"key": "nifty50",    "name": "Nifty 50",   "symbol": "^NSEI"},
    {"key": "sensex",     "name": "Sensex",     "symbol": "^BSESN"},
    {"key": "bank_nifty", "name": "Bank Nifty", "symbol": "^NSEBANK"},
]


def snapshot_one(symbol: str) -> tuple[float, float] | None:
    """Return (last_price, change_pct) where `last` is the current
    quote and `change_pct` is (last - prev_close)/prev_close as a
    decimal. None if Yahoo doesn't return usable values.

    yfinance's fast_info is the reliable source for indices — it
    exposes Yahoo's regularMarket fields (which match NSE's official
    day close) rather than the stale `chartPreviousClose` you get
    from the v8/chart endpoint.
    """
    try:
        t = yf.Ticker(symbol)
        fi = t.fast_info
        # fast_info uses camelCase keys. `lastPrice` = current quote;
        # `regularMarketPreviousClose` = the true previous-session close
        # that matches NSE's own day-over-day calculation.
        last = fi["lastPrice"] if "lastPrice" in fi.keys() else None
        prev = fi["regularMarketPreviousClose"] if "regularMarketPreviousClose" in fi.keys() else None
        if last is None or prev is None:
            return None
        last_f, prev_f = float(last), float(prev)
        if prev_f == 0:
            return None
        return last_f, (last_f - prev_f) / prev_f
    except Exception as e:
        print(f"[warn] {symbol}: {e}", file=sys.stderr)
        return None


def main() -> int:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    wrote = 0
    for ix in INDICES:
        res = snapshot_one(ix["symbol"])
        if res is None:
            print(f"  {ix['symbol']:<10} no data")
            continue
        last, change = res
        try:
            sb.table("fetch_logs").insert({
                "ticker": ix["symbol"],
                "source": "market_snapshot",
                "fetch_status": "success",
                "message": json.dumps({
                    "key": ix["key"],
                    "name": ix["name"],
                    "last_price": last,
                    "change_pct": change,
                }),
            }).execute()
            wrote += 1
            print(f"  {ix['symbol']:<10} {last:>10,.2f}  {change*100:+.2f}%")
        except Exception as e:
            print(f"  {ix['symbol']:<10} write err: {e}", file=sys.stderr)

    print(f"\nDone. Wrote {wrote}/{len(INDICES)} snapshots.")
    # Exit 0 always — a snapshot miss is not a workflow failure.
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(0)
