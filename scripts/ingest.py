"""
India Earnings Tracker — Yahoo Finance ingestion.

Usage:
    # pulls tickers from the `companies` table (preferred)
    python scripts/ingest.py

    # or override with an env var
    INGEST_TICKERS=RELIANCE.NS,TCS.NS python scripts/ingest.py

Requires:
    pip install yfinance supabase python-dotenv pandas

Environment (see .env.example):
    NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY    # needed — row level security blocks writes otherwise
    INGEST_TICKERS               # optional comma-separated override
    INGEST_RPS                   # optional requests-per-second cap (default 2)

Design notes
------------
- Defensive parsing: Yahoo's quarterly income-statement DataFrame uses
  different row labels across tickers ("Total Revenue" vs "TotalRevenue"
  vs "Revenue"), so we look up fields via a list of aliases.
- Upsert on (ticker, quarter_end_date). COALESCE semantics in SQL keep
  historical non-null values safe when a later fetch returns nulls.
- Every attempt is logged to `fetch_logs` — successes, partials, failures.
- Rate-limited with a simple sleep; Yahoo will 429 otherwise.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass  # dotenv is optional in prod

try:
    import yfinance as yf
    import pandas as pd
    from supabase import create_client, Client
except ImportError as e:
    print(f"Missing dependency: {e}. Install with: pip install yfinance supabase python-dotenv pandas", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
RPS          = float(os.environ.get("INGEST_RPS", "2"))
DELAY_S      = 1.0 / max(RPS, 0.1)

# Yahoo field aliases — ordered by preference.
REVENUE_ALIASES = ["Total Revenue", "TotalRevenue", "Revenue", "Operating Revenue", "OperatingRevenue"]
NET_PROFIT_ALIASES = [
    "Net Income", "NetIncome", "Net Income Common Stockholders",
    "NetIncomeCommonStockholders", "Net Income From Continuing Operations"
]
OP_PROFIT_ALIASES = ["Operating Income", "OperatingIncome", "Total Operating Income As Reported", "Ebit"]
EPS_ALIASES = ["Basic EPS", "BasicEPS", "Diluted EPS", "DilutedEPS"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
@dataclass
class QuarterPayload:
    ticker: str
    company_id: str
    quarter_end_date: str     # ISO YYYY-MM-DD (canonical fiscal quarter close)
    fiscal_year: int
    fiscal_quarter: int
    quarter_label: str        # "Q4 FY26"
    revenue: float | None
    net_profit: float | None
    operating_profit: float | None
    eps: float | None
    raw: dict[str, Any]
    quality: str              # ok / partial / missing


def to_fiscal(dt) -> tuple[int, int, str, str]:
    """Date -> (fiscal_year, fiscal_quarter, label, quarter_end_iso)."""
    if hasattr(dt, "to_pydatetime"):
        dt = dt.to_pydatetime()
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))

    m, y = dt.month, dt.year
    if 4 <= m <= 6:
        fq, fy_end = 1, y + 1; q_month, q_year = 6, y
    elif 7 <= m <= 9:
        fq, fy_end = 2, y + 1; q_month, q_year = 9, y
    elif 10 <= m <= 12:
        fq, fy_end = 3, y + 1; q_month, q_year = 12, y
    else:  # Jan–Mar
        fq, fy_end = 4, y;     q_month, q_year = 3, y

    # Canonical last day of the fiscal quarter (30 Jun / 30 Sep / 31 Dec / 31 Mar).
    last_day = {3: 31, 6: 30, 9: 30, 12: 31}[q_month]
    end = f"{q_year}-{q_month:02d}-{last_day:02d}"
    label = f"Q{fq} FY{str(fy_end)[-2:]}"
    return fy_end, fq, label, end


def pick(df: pd.DataFrame, column, aliases: list[str]) -> float | None:
    """Find the first matching row in `aliases` inside the quarterly DataFrame."""
    if df is None or df.empty or column not in df.columns:
        return None
    # df is indexed by concept; we want column = quarter end timestamp
    index_strs = {str(i).strip(): i for i in df.index}
    for name in aliases:
        for k, idx in index_strs.items():
            if k.lower() == name.lower():
                val = df.loc[idx, column]
                if val is None or (isinstance(val, float) and math.isnan(val)):
                    return None
                return float(val)
    return None


def safe_fetch(ticker: str) -> dict[str, Any]:
    """Pull quarterly income statement + metadata. Returns a dict we can log."""
    t = yf.Ticker(ticker)
    # .quarterly_income_stmt is the modern attr (as of yfinance >= 0.2.40);
    # fall back to the legacy attr for older installs.
    q_df = getattr(t, "quarterly_income_stmt", None)
    if q_df is None or (hasattr(q_df, "empty") and q_df.empty):
        q_df = getattr(t, "quarterly_financials", None)

    info = {}
    try:
        info = t.get_info() or {}
    except Exception:
        # `info` sometimes throws on thinly traded stocks; that's fine.
        pass

    return {"quarterly_df": q_df, "info": info}


def dataframe_to_json(df) -> dict[str, Any] | None:
    """Small JSON dump of the raw DF for debugging + the detail page."""
    if df is None or df.empty:
        return None
    # Columns are Timestamps — stringify them so Supabase jsonb accepts them.
    out: dict[str, Any] = {}
    for col in df.columns:
        key = str(col.date()) if hasattr(col, "date") else str(col)
        col_map: dict[str, Any] = {}
        for idx, val in df[col].items():
            if isinstance(val, float) and math.isnan(val):
                val = None
            col_map[str(idx)] = val
        out[key] = col_map
    return out


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------
def fetch_one(sb: Client, ticker: str, company_id: str, company_name: str) -> tuple[int, int, str]:
    """Returns (rows_written, rows_skipped, status_for_log)."""
    try:
        bundle = safe_fetch(ticker)
    except Exception as e:
        return 0, 0, f"fetch failed: {e!s}"

    q_df = bundle.get("quarterly_df")
    if q_df is None or (hasattr(q_df, "empty") and q_df.empty):
        return 0, 0, "no quarterly statement available"

    raw_payload = dataframe_to_json(q_df)
    written, skipped = 0, 0
    errors: list[str] = []

    for col in q_df.columns:
        try:
            fy, fq, label, end_iso = to_fiscal(col)
            revenue = pick(q_df, col, REVENUE_ALIASES)
            net_profit = pick(q_df, col, NET_PROFIT_ALIASES)
            op_profit = pick(q_df, col, OP_PROFIT_ALIASES)
            eps = pick(q_df, col, EPS_ALIASES)

            missing = sum(v is None for v in (revenue, net_profit))
            quality = "ok" if missing == 0 else ("partial" if missing == 1 else "missing")
            if revenue is None and net_profit is None:
                skipped += 1
                continue

            row = {
                "company_id": company_id,
                "ticker": ticker,
                "quarter_label": label,
                "quarter_end_date": end_iso,
                "fiscal_year": fy,
                "fiscal_quarter": fq,
                "revenue": revenue,
                "net_profit": net_profit,
                "operating_profit": op_profit,
                "eps": eps,
                "currency": "INR",
                "source": "yahoo",
                "raw_json": raw_payload,
                "data_quality_status": quality,
                "fetched_at": datetime.now(timezone.utc).isoformat()
            }

            # Upsert. Supabase-py's upsert uses Postgres ON CONFLICT with
            # our unique (ticker, quarter_end_date) — see schema.sql.
            sb.table("quarterly_financials").upsert(
                row, on_conflict="ticker,quarter_end_date"
            ).execute()
            written += 1
        except Exception as e:
            errors.append(str(e))
            continue

    status = "success" if written > 0 and not errors else ("partial" if written > 0 else "failed")
    msg = f"{company_name}: wrote {written}, skipped {skipped}"
    if errors:
        msg += f"; errors: {'; '.join(errors[:3])}"
    return written, skipped, msg if status == "success" else f"[{status}] {msg}"


def log_fetch(sb: Client, ticker: str | None, status: str, message: str) -> None:
    try:
        sb.table("fetch_logs").insert({
            "ticker": ticker,
            "source": "yahoo",
            "fetch_status": status,
            "message": message[:2000]
        }).execute()
    except Exception as e:
        print(f"[warn] could not write fetch_log: {e}", file=sys.stderr)


def resolve_targets(sb: Client) -> list[dict[str, str]]:
    override = os.environ.get("INGEST_TICKERS", "").strip()
    if override:
        tickers = [t.strip().upper() for t in override.split(",") if t.strip()]
        res = sb.table("companies").select("id,ticker,company_name").in_("ticker", tickers).execute()
        return res.data or []
    res = sb.table("companies").select("id,ticker,company_name").eq("is_active", True).execute()
    return res.data or []


def main() -> int:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env", file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    targets = resolve_targets(sb)
    if not targets:
        print("No companies found. Run supabase/schema.sql first (seeds the universe).")
        return 1

    print(f"Ingesting {len(targets)} tickers @ {RPS} req/s ...")
    total_ok = 0
    total_fail = 0
    for i, row in enumerate(targets, 1):
        tk = row["ticker"]
        try:
            written, skipped, msg = fetch_one(sb, tk, row["id"], row["company_name"])
            status = "success" if written > 0 else "failed"
            total_ok += 1 if written > 0 else 0
            total_fail += 0 if written > 0 else 1
            log_fetch(sb, tk, status, msg)
            print(f"[{i:3d}/{len(targets)}] {tk:<16} {msg}")
        except Exception:
            total_fail += 1
            err = traceback.format_exc(limit=2)
            log_fetch(sb, tk, "failed", err)
            print(f"[{i:3d}/{len(targets)}] {tk:<16} ERROR\n{err}", file=sys.stderr)
        time.sleep(DELAY_S)

    print(f"\nDone. {total_ok} ok, {total_fail} failed.")
    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
