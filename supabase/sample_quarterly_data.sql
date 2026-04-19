-- Optional: a few hand-keyed sample rows so the dashboard has something to
-- render before the first ingestion run. All values in INR (not crores).
-- Delete once you've run scripts/ingest.py.

with c as (select id, ticker from public.companies)
insert into public.quarterly_financials
  (company_id, ticker, quarter_label, quarter_end_date, fiscal_year, fiscal_quarter,
   revenue, net_profit, operating_profit, eps, currency, source, data_quality_status)
select c.id, c.ticker, v.ql, v.qe, v.fy, v.fq, v.rev, v.np, v.op, v.eps, 'INR', 'seed', 'ok'
from c
join (values
  ('RELIANCE.NS', 'Q3 FY26', date '2025-12-31', 2026, 3, 2480000000000, 187000000000, 415000000000, 27.62),
  ('RELIANCE.NS', 'Q2 FY26', date '2025-09-30', 2026, 2, 2320000000000, 179000000000, 398000000000, 26.45),
  ('RELIANCE.NS', 'Q1 FY26', date '2025-06-30', 2026, 1, 2290000000000, 172000000000, 389000000000, 25.40),
  ('RELIANCE.NS', 'Q4 FY25', date '2025-03-31', 2025, 4, 2360000000000, 188000000000, 410000000000, 27.70),
  ('RELIANCE.NS', 'Q3 FY25', date '2024-12-31', 2025, 3, 2400000000000, 194000000000, 420000000000, 28.60),
  ('TCS.NS',      'Q3 FY26', date '2025-12-31', 2026, 3, 645000000000,  118000000000, 158000000000, 32.10),
  ('TCS.NS',      'Q2 FY26', date '2025-09-30', 2026, 2, 634000000000,  116000000000, 156000000000, 31.60),
  ('TCS.NS',      'Q1 FY26', date '2025-06-30', 2026, 1, 621000000000,  114000000000, 153000000000, 31.00),
  ('TCS.NS',      'Q4 FY25', date '2025-03-31', 2025, 4, 612000000000,  118000000000, 153000000000, 32.00),
  ('HDFCBANK.NS', 'Q3 FY26', date '2025-12-31', 2026, 3, 885000000000,  172000000000, null,          22.40),
  ('HDFCBANK.NS', 'Q2 FY26', date '2025-09-30', 2026, 2, 842000000000,  168000000000, null,          21.80),
  ('HDFCBANK.NS', 'Q1 FY26', date '2025-06-30', 2026, 1, 820000000000,  163000000000, null,          21.20),
  ('INFY.NS',     'Q3 FY26', date '2025-12-31', 2026, 3, 425000000000,   78000000000,  98000000000,  18.50),
  ('INFY.NS',     'Q2 FY26', date '2025-09-30', 2026, 2, 415000000000,   76000000000,  96000000000,  18.20),
  ('ICICIBANK.NS','Q3 FY26', date '2025-12-31', 2026, 3, 515000000000,  112000000000, null,          15.70),
  ('ICICIBANK.NS','Q2 FY26', date '2025-09-30', 2026, 2, 500000000000,  108000000000, null,          15.10),
  ('SBIN.NS',     'Q3 FY26', date '2025-12-31', 2026, 3, 1190000000000, 156000000000, null,          17.40),
  ('SBIN.NS',     'Q2 FY26', date '2025-09-30', 2026, 2, 1150000000000, 148000000000, null,          16.60),
  ('ITC.NS',      'Q3 FY26', date '2025-12-31', 2026, 3, 195000000000,   58000000000,  72000000000,   4.65),
  ('ITC.NS',      'Q2 FY26', date '2025-09-30', 2026, 2, 187000000000,   55000000000,  69000000000,   4.40)
) as v(ticker, ql, qe, fy, fq, rev, np, op, eps) on c.ticker = v.ticker
on conflict (ticker, quarter_end_date) do nothing;
