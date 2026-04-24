"""
Orchestrator: calendar scrape + filings fetch.

  --daily  : scrape NSE event calendar (run once a morning)
  --hourly : fetch NSE financial-results XBRL for companies due today
  --fallback-yahoo : also run the Yahoo ingester for gaps (optional)

With no flag, runs both.

Example cron:
    30 2 * * 1-5       py scripts/nse_pipeline.py --daily
    */30 4-16 * * 1-5  py scripts/nse_pipeline.py --hourly
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = sys.executable


def run(name: str, args: list[str]) -> int:
    script = HERE / name
    print(f"\n===== {name} {' '.join(args)} =====")
    return subprocess.call([PY, str(script), *args], cwd=str(HERE.parent))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--daily", action="store_true")
    ap.add_argument("--hourly", action="store_true")
    ap.add_argument("--fallback-yahoo", action="store_true")
    args = ap.parse_args()

    do_daily  = args.daily  or not (args.daily or args.hourly)
    do_hourly = args.hourly or not (args.daily or args.hourly)

    code = 0
    if do_daily:
        # Scrape all three calendars. BSE + NSE + Moneycontrol have different
        # levels of coverage and latency — Moneycontrol is the fastest for
        # freshly-filed Q4 results (because it pulls from BSE announcements
        # and its own newsroom, not NSE's structured filings API).
        code |= run("nse_calendar.py", []) or 0
        code |= run("bse_calendar.py", []) or 0
        code |= run("moneycontrol_calendar.py", []) or 0
    if do_hourly:
        code |= run("bse_pdf_results.py", []) or 0
        code |= run("nse_results.py", []) or 0
    if args.fallback_yahoo:
        code |= run("ingest.py", []) or 0
    return code


if __name__ == "__main__":
    sys.exit(main())
