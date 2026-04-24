#!/usr/bin/env bash
# ============================================================================
# India Earnings Tracker — cron wrapper (Linux/Mac)
# ----------------------------------------------------------------------------
# Call with one of: daily | hourly | backfill
# Example crontab:
#   # Every morning 08:00 IST: refresh all calendars + mark tomorrow's reporters
#   30 2 * * 1-5  /path/to/Earning-Dashboard/scripts/cron.example.sh daily
#   # Every 30 min, 10:00–22:00 IST: pull freshly-filed results
#   */30 4-16 * * 1-5  /path/to/Earning-Dashboard/scripts/cron.example.sh hourly
#   # Weekly Sunday: full backfill across the whole NIFTY 500
#   0 18 * * 0  /path/to/Earning-Dashboard/scripts/cron.example.sh backfill
# ============================================================================

set -euo pipefail

MODE="${1:-hourly}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# Load env. We expect .env at repo root with Supabase keys.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Pick a Python binary: prefer the venv, then system python3.
if [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
else
  PY="$(command -v python3 || command -v python)"
fi

LOG_DIR="${EARNINGS_LOG_DIR:-$APP_DIR/logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/earnings-$(date +%Y-%m-%d).log"
echo "=== $(date -Iseconds) · mode=$MODE ===" >> "$LOG_FILE"

case "$MODE" in
  daily)
    # Three calendar sources (NSE, BSE, Moneycontrol) — dedup on (ticker, date).
    # Scope is NIFTY 500 only. Calendars silently skip untracked scrips.
    "$PY" scripts/nse_calendar.py             >> "$LOG_FILE" 2>&1
    "$PY" scripts/bse_calendar.py             >> "$LOG_FILE" 2>&1
    "$PY" scripts/moneycontrol_calendar.py    >> "$LOG_FILE" 2>&1
    ;;
  hourly)
    # Two-pass sweep:
    # 1. NSE XBRL poll across the NIFTY-500 — catches new filings we didn't
    #    have a calendar entry for.
    # 2. Gap-filler: for every announced-but-un-numbered company, try
    #    NSE XBRL → Screener until one yields numbers. Closes the gap
    #    between calendar detection and numbers landing on the dashboard.
    "$PY" scripts/bse_pdf_results.py        >> "$LOG_FILE" 2>&1
    "$PY" scripts/nse_results.py            >> "$LOG_FILE" 2>&1
    "$PY" scripts/bse_results.py            >> "$LOG_FILE" 2>&1
    "$PY" scripts/fetch_results.py          >> "$LOG_FILE" 2>&1
    ;;
  backfill)
    # Weekly sweep across the whole universe. Slower (~30 min) but picks up
    # restated filings and newly-added companies in one pass.
    "$PY" scripts/nse_results.py --all --quarters 2  >> "$LOG_FILE" 2>&1
    "$PY" scripts/screener_results.py --missing      >> "$LOG_FILE" 2>&1
    ;;
  *)
    echo "usage: $0 {daily|hourly|backfill}" >&2
    exit 2
    ;;
esac

echo "=== $(date -Iseconds) · done ===" >> "$LOG_FILE"
