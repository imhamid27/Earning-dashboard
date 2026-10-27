-- Migration: stock_price_history
-- Run this once in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run — uses IF NOT EXISTS / IF EXISTS throughout.
-- Does NOT touch any existing table.

CREATE TABLE IF NOT EXISTS stock_price_history (
  ticker      TEXT        NOT NULL,
  date        DATE        NOT NULL,
  open        NUMERIC(14, 4),
  high        NUMERIC(14, 4),
  low         NUMERIC(14, 4),
  close       NUMERIC(14, 4),
  adj_close   NUMERIC(14, 4),  -- split + bonus adjusted; use this for return calculations
  volume      BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, date)
);

-- Fast lookups by date range (period filters: YTD, 1M, 3M, etc.)
CREATE INDEX IF NOT EXISTS idx_sph_date   ON stock_price_history (date);
-- Fast single-ticker history (company chart, quick-view panel)
CREATE INDEX IF NOT EXISTS idx_sph_ticker ON stock_price_history (ticker);

-- Optional: comment explaining the table so future readers understand intent.
COMMENT ON TABLE stock_price_history IS
  'Daily OHLCV for all tracked companies. adj_close is split/bonus adjusted '
  'and is the correct column for computing price returns. Populated by '
  'scripts/backfill_price_history.py (one-time) and scripts/eod_price_history.py (daily).';
