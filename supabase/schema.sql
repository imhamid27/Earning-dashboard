-- =====================================================================
-- India Earnings Tracker — Supabase schema
-- Run this in the Supabase SQL editor once, in order.
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT where it matters.
-- =====================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- 1. companies
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id              uuid primary key default uuid_generate_v4(),
  company_name    text not null,
  ticker          text not null unique,            -- e.g. RELIANCE.NS
  exchange        text not null default 'NSE',     -- NSE / BSE
  sector          text,
  industry        text,
  isin            text,
  market_cap_bucket text,                          -- LARGE / MID / SMALL
  is_active       boolean not null default true,
  -- Optional "upcoming announcement" surface (feature #5 in spec).
  next_result_date date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_companies_sector on public.companies(sector);
create index if not exists idx_companies_active on public.companies(is_active) where is_active = true;
create index if not exists idx_companies_next_result on public.companies(next_result_date)
  where next_result_date is not null;

-- ---------------------------------------------------------------------
-- 2. quarterly_financials
-- ---------------------------------------------------------------------
-- All monetary values are stored in rupees (not crores) as numeric(20,2).
-- revenue / net_profit / operating_profit can be null when the source is
-- missing the field — use data_quality_status to surface that.
create table if not exists public.quarterly_financials (
  id                   uuid primary key default uuid_generate_v4(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  ticker               text not null,
  quarter_label        text not null,              -- "Q4 FY26"
  quarter_end_date     date not null,              -- canonical quarter close
  fiscal_year          int  not null,              -- 2026 for FY26
  fiscal_quarter       int  not null check (fiscal_quarter between 1 and 4),
  revenue              numeric(20,2),
  net_profit           numeric(20,2),
  operating_profit     numeric(20,2),
  eps                  numeric(12,4),
  currency             text not null default 'INR',
  source               text not null default 'yahoo',
  raw_json             jsonb,                      -- preserved source payload
  data_quality_status  text not null default 'ok'  -- ok | partial | missing | stale
    check (data_quality_status in ('ok','partial','missing','stale')),
  fetched_at           timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Upsert key: a given company can only have one row per quarter close.
  constraint uq_quarterly unique (ticker, quarter_end_date)
);

create index if not exists idx_qf_company on public.quarterly_financials(company_id);
create index if not exists idx_qf_quarter on public.quarterly_financials(quarter_label);
create index if not exists idx_qf_quarter_end on public.quarterly_financials(quarter_end_date desc);
create index if not exists idx_qf_fiscal on public.quarterly_financials(fiscal_year desc, fiscal_quarter desc);

-- ---------------------------------------------------------------------
-- 3. fetch_logs
-- ---------------------------------------------------------------------
create table if not exists public.fetch_logs (
  id           uuid primary key default uuid_generate_v4(),
  ticker       text,
  source       text not null default 'yahoo',
  fetch_status text not null check (fetch_status in ('success','partial','failed','skipped')),
  message      text,
  fetched_at   timestamptz not null default now()
);

create index if not exists idx_logs_fetched_at on public.fetch_logs(fetched_at desc);
create index if not exists idx_logs_status on public.fetch_logs(fetch_status);

-- ---------------------------------------------------------------------
-- Triggers: keep updated_at fresh
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''   -- pin search_path; prevents search-path injection attacks
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_companies_touch on public.companies;
create trigger trg_companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_qf_touch on public.quarterly_financials;
create trigger trg_qf_touch before update on public.quarterly_financials
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Helpful views for the dashboard
-- ---------------------------------------------------------------------

-- Latest quarter per company (used by the main table + summary cards).
create or replace view public.v_latest_quarter
  with (security_invoker = true)
as
select distinct on (qf.ticker)
  c.id            as company_id,
  c.company_name,
  c.sector,
  c.industry,
  c.exchange,
  qf.ticker,
  qf.quarter_label,
  qf.quarter_end_date,
  qf.revenue,
  qf.net_profit,
  qf.operating_profit,
  qf.eps,
  qf.data_quality_status,
  qf.fetched_at
from public.quarterly_financials qf
join public.companies c on c.id = qf.company_id
order by qf.ticker, qf.quarter_end_date desc;

-- Sector aggregates for the current max quarter.
create or replace view public.v_sector_current
  with (security_invoker = true)
as
with latest as (
  select max(quarter_end_date) as d from public.quarterly_financials
)
select
  c.sector,
  count(*) filter (where qf.revenue is not null)     as companies_reported,
  sum(qf.revenue)                                    as total_revenue,
  sum(qf.net_profit)                                 as total_net_profit,
  avg(qf.revenue)                                    as avg_revenue,
  avg(qf.net_profit)                                 as avg_net_profit
from public.quarterly_financials qf
join public.companies c on c.id = qf.company_id
join latest l on qf.quarter_end_date = l.d
where c.sector is not null
group by c.sector
order by total_revenue desc nulls last;

-- ---------------------------------------------------------------------
-- Row Level Security — read-only public, writes via service role only
-- ---------------------------------------------------------------------
alter table public.companies             enable row level security;
alter table public.quarterly_financials  enable row level security;
alter table public.fetch_logs            enable row level security;

drop policy if exists "public read companies" on public.companies;
create policy "public read companies"
  on public.companies for select using (true);

drop policy if exists "public read quarterly" on public.quarterly_financials;
create policy "public read quarterly"
  on public.quarterly_financials for select using (true);

-- fetch_logs is internal-only. Explicit deny-all policy silences the
-- "RLS Enabled No Policy" advisor suggestion and documents the intent.
-- The service role key (used by Python scripts) bypasses RLS so writes work.
drop policy if exists "no public access" on public.fetch_logs;
create policy "no public access"
  on public.fetch_logs for all using (false);

-- ---------------------------------------------------------------------
-- Seed: top-50 starter companies (expand via lib/tickers.ts)
-- ---------------------------------------------------------------------
insert into public.companies (company_name, ticker, exchange, sector, industry, market_cap_bucket) values
  ('Reliance Industries',         'RELIANCE.NS',   'NSE', 'Energy',            'Oil & Gas Refining', 'LARGE'),
  ('Tata Consultancy Services',   'TCS.NS',        'NSE', 'Information Technology', 'IT Services', 'LARGE'),
  ('HDFC Bank',                   'HDFCBANK.NS',   'NSE', 'Financials',        'Private Banks',      'LARGE'),
  ('Infosys',                     'INFY.NS',       'NSE', 'Information Technology', 'IT Services', 'LARGE'),
  ('ICICI Bank',                  'ICICIBANK.NS',  'NSE', 'Financials',        'Private Banks',      'LARGE'),
  ('State Bank of India',         'SBIN.NS',       'NSE', 'Financials',        'Public Sector Banks','LARGE'),
  ('Larsen & Toubro',             'LT.NS',         'NSE', 'Industrials',       'Construction',       'LARGE'),
  ('ITC',                         'ITC.NS',        'NSE', 'Consumer Staples',  'Tobacco/FMCG',       'LARGE'),
  ('Hindustan Unilever',          'HINDUNILVR.NS', 'NSE', 'Consumer Staples',  'FMCG',               'LARGE'),
  ('Bharti Airtel',               'BHARTIARTL.NS', 'NSE', 'Communication Services', 'Telecom',       'LARGE'),
  ('Kotak Mahindra Bank',         'KOTAKBANK.NS',  'NSE', 'Financials',        'Private Banks',      'LARGE'),
  ('Axis Bank',                   'AXISBANK.NS',   'NSE', 'Financials',        'Private Banks',      'LARGE'),
  ('Asian Paints',                'ASIANPAINT.NS', 'NSE', 'Materials',         'Paints',             'LARGE'),
  ('Maruti Suzuki',               'MARUTI.NS',     'NSE', 'Consumer Discretionary', 'Automobiles',   'LARGE'),
  ('Bajaj Finance',               'BAJFINANCE.NS', 'NSE', 'Financials',        'NBFC',               'LARGE'),
  ('HCL Technologies',            'HCLTECH.NS',    'NSE', 'Information Technology', 'IT Services', 'LARGE'),
  ('Wipro',                       'WIPRO.NS',      'NSE', 'Information Technology', 'IT Services', 'LARGE'),
  ('Sun Pharmaceutical',          'SUNPHARMA.NS',  'NSE', 'Healthcare',        'Pharmaceuticals',    'LARGE'),
  ('Titan Company',               'TITAN.NS',      'NSE', 'Consumer Discretionary', 'Jewellery',     'LARGE'),
  ('UltraTech Cement',            'ULTRACEMCO.NS', 'NSE', 'Materials',         'Cement',             'LARGE'),
  ('Nestle India',                'NESTLEIND.NS',  'NSE', 'Consumer Staples',  'FMCG',               'LARGE'),
  ('Power Grid Corporation',      'POWERGRID.NS',  'NSE', 'Utilities',         'Power Transmission', 'LARGE'),
  ('NTPC',                        'NTPC.NS',       'NSE', 'Utilities',         'Power Generation',   'LARGE'),
  ('Oil & Natural Gas Corp',      'ONGC.NS',       'NSE', 'Energy',            'Oil & Gas E&P',      'LARGE'),
  ('Tata Motors',                 'TATAMOTORS.NS', 'NSE', 'Consumer Discretionary', 'Automobiles',   'LARGE'),
  ('Tata Steel',                  'TATASTEEL.NS',  'NSE', 'Materials',         'Steel',              'LARGE'),
  ('JSW Steel',                   'JSWSTEEL.NS',   'NSE', 'Materials',         'Steel',              'LARGE'),
  ('Adani Enterprises',           'ADANIENT.NS',   'NSE', 'Industrials',       'Diversified',        'LARGE'),
  ('Adani Ports',                 'ADANIPORTS.NS', 'NSE', 'Industrials',       'Ports & Logistics',  'LARGE'),
  ('Coal India',                  'COALINDIA.NS',  'NSE', 'Energy',            'Coal Mining',        'LARGE'),
  ('Bajaj Auto',                  'BAJAJ-AUTO.NS', 'NSE', 'Consumer Discretionary', 'Automobiles',   'LARGE'),
  ('Hero MotoCorp',               'HEROMOTOCO.NS', 'NSE', 'Consumer Discretionary', 'Automobiles',   'LARGE'),
  ('Mahindra & Mahindra',         'M&M.NS',        'NSE', 'Consumer Discretionary', 'Automobiles',   'LARGE'),
  ('Eicher Motors',               'EICHERMOT.NS',  'NSE', 'Consumer Discretionary', 'Automobiles',   'LARGE'),
  ('Dr Reddy''s Laboratories',    'DRREDDY.NS',    'NSE', 'Healthcare',        'Pharmaceuticals',    'LARGE'),
  ('Cipla',                       'CIPLA.NS',      'NSE', 'Healthcare',        'Pharmaceuticals',    'LARGE'),
  ('Divis Laboratories',          'DIVISLAB.NS',   'NSE', 'Healthcare',        'Pharmaceuticals',    'LARGE'),
  ('Apollo Hospitals',            'APOLLOHOSP.NS', 'NSE', 'Healthcare',        'Hospitals',          'LARGE'),
  ('Britannia Industries',        'BRITANNIA.NS',  'NSE', 'Consumer Staples',  'FMCG',               'LARGE'),
  ('Tata Consumer Products',      'TATACONSUM.NS', 'NSE', 'Consumer Staples',  'FMCG',               'LARGE'),
  ('Grasim Industries',           'GRASIM.NS',     'NSE', 'Materials',         'Diversified',        'LARGE'),
  ('IndusInd Bank',               'INDUSINDBK.NS', 'NSE', 'Financials',        'Private Banks',      'LARGE'),
  ('Bajaj Finserv',               'BAJAJFINSV.NS', 'NSE', 'Financials',        'Diversified Finance','LARGE'),
  ('SBI Life Insurance',          'SBILIFE.NS',    'NSE', 'Financials',        'Life Insurance',     'LARGE'),
  ('HDFC Life Insurance',         'HDFCLIFE.NS',   'NSE', 'Financials',        'Life Insurance',     'LARGE'),
  ('Tech Mahindra',               'TECHM.NS',      'NSE', 'Information Technology', 'IT Services', 'LARGE'),
  ('LTIMindtree',                 'LTIM.NS',       'NSE', 'Information Technology', 'IT Services', 'LARGE'),
  ('Hindalco Industries',         'HINDALCO.NS',   'NSE', 'Materials',         'Aluminium',          'LARGE'),
  ('Shriram Finance',             'SHRIRAMFIN.NS', 'NSE', 'Financials',        'NBFC',               'LARGE'),
  ('Dabur India',                 'DABUR.NS',      'NSE', 'Consumer Staples',  'FMCG',               'LARGE')
on conflict (ticker) do nothing;

-- ---------------------------------------------------------------------
-- Example upsert (executed by the ingestion script; here for reference)
-- ---------------------------------------------------------------------
-- insert into public.quarterly_financials
--   (company_id, ticker, quarter_label, quarter_end_date, fiscal_year,
--    fiscal_quarter, revenue, net_profit, operating_profit, eps,
--    currency, source, raw_json, data_quality_status, fetched_at)
-- values (...)
-- on conflict (ticker, quarter_end_date) do update set
--   -- "Do not overwrite good historical data with null values" (spec)
--   revenue          = coalesce(excluded.revenue,          quarterly_financials.revenue),
--   net_profit       = coalesce(excluded.net_profit,       quarterly_financials.net_profit),
--   operating_profit = coalesce(excluded.operating_profit, quarterly_financials.operating_profit),
--   eps              = coalesce(excluded.eps,              quarterly_financials.eps),
--   raw_json         = coalesce(excluded.raw_json,         quarterly_financials.raw_json),
--   data_quality_status = excluded.data_quality_status,
--   fetched_at       = excluded.fetched_at,
--   updated_at       = now();
