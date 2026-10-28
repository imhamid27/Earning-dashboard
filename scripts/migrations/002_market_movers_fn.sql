-- Migration 002: market_movers() Postgres function
-- Run once in Supabase SQL Editor.
--
-- Returns top N gainers and top N losers for a given look-back period
-- using adj_close from stock_price_history.
--
-- Call via Supabase RPC:
--   supabase.rpc('market_movers', { period_days: 30, result_limit: 25 })

CREATE OR REPLACE FUNCTION market_movers(
  period_days  INT     DEFAULT 30,
  result_limit INT     DEFAULT 25,
  p_sector     TEXT    DEFAULT NULL
)
RETURNS TABLE (
  ticker       TEXT,
  company_name TEXT,
  sector       TEXT,
  exchange     TEXT,
  end_date     DATE,
  start_date   DATE,
  end_price    NUMERIC,
  start_price  NUMERIC,
  return_pct   NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH latest_date AS (
    SELECT MAX(date) AS d
    FROM   stock_price_history
    WHERE  adj_close IS NOT NULL
  ),
  end_prices AS (
    SELECT DISTINCT ON (h.ticker)
      h.ticker,
      h.date      AS end_date,
      h.adj_close AS end_price
    FROM stock_price_history h
    CROSS JOIN latest_date ld
    WHERE h.adj_close IS NOT NULL
      AND h.date <= ld.d
    ORDER BY h.ticker, h.date DESC
  ),
  start_prices AS (
    SELECT DISTINCT ON (h.ticker)
      h.ticker,
      h.date      AS start_date,
      h.adj_close AS start_price
    FROM stock_price_history h
    CROSS JOIN latest_date ld
    WHERE h.adj_close IS NOT NULL
      AND h.date <= (ld.d - period_days)
    ORDER BY h.ticker, h.date DESC
  ),
  computed AS (
    SELECT
      ep.ticker,
      c.company_name,
      c.sector,
      c.exchange,
      ep.end_date,
      sp.start_date,
      ep.end_price,
      sp.start_price,
      ROUND(
        ((ep.end_price - sp.start_price) / NULLIF(sp.start_price, 0)) * 100,
        2
      ) AS return_pct
    FROM   end_prices ep
    JOIN   start_prices sp ON sp.ticker = ep.ticker
    JOIN   companies    c  ON c.ticker  = ep.ticker AND c.is_active = TRUE
    WHERE  sp.start_price > 0
      AND  ep.end_price   > 0
      AND  c.sector IS NOT NULL
      AND  (p_sector IS NULL OR c.sector = p_sector)
  )
  (SELECT * FROM computed ORDER BY return_pct DESC LIMIT result_limit)
  UNION ALL
  (SELECT * FROM computed ORDER BY return_pct ASC  LIMIT result_limit)
$$;
