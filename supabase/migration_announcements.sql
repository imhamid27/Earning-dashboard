-- =====================================================================
-- India Earnings Tracker — BSE integration migration
-- Adds BSE scrip codes to the company universe and a table to track
-- forthcoming result announcements as we detect them on the BSE calendar.
--
-- Run this AFTER supabase/schema.sql, in the Supabase SQL editor.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BSE scrip code column + index
-- ---------------------------------------------------------------------
alter table public.companies add column if not exists bse_scrip text;
create index if not exists idx_companies_bse_scrip on public.companies(bse_scrip);

-- ---------------------------------------------------------------------
-- 2. Seed BSE scrip codes for our 50 starter tickers.
--    (Equivalent to NSE ticker but BSE uses 6-digit numeric codes.)
-- ---------------------------------------------------------------------
update public.companies set bse_scrip = v.code
from (values
  ('RELIANCE.NS',   '500325'), ('TCS.NS',        '532540'),
  ('HDFCBANK.NS',   '500180'), ('INFY.NS',       '500209'),
  ('ICICIBANK.NS',  '532174'), ('SBIN.NS',       '500112'),
  ('LT.NS',         '500510'), ('ITC.NS',        '500875'),
  ('HINDUNILVR.NS', '500696'), ('BHARTIARTL.NS', '532454'),
  ('KOTAKBANK.NS',  '500247'), ('AXISBANK.NS',   '532215'),
  ('ASIANPAINT.NS', '500820'), ('MARUTI.NS',     '532500'),
  ('BAJFINANCE.NS', '500034'), ('HCLTECH.NS',    '532281'),
  ('WIPRO.NS',      '507685'), ('SUNPHARMA.NS',  '524715'),
  ('TITAN.NS',      '500114'), ('ULTRACEMCO.NS', '532538'),
  ('NESTLEIND.NS',  '500790'), ('POWERGRID.NS',  '532898'),
  ('NTPC.NS',       '532555'), ('ONGC.NS',       '500312'),
  ('TATAMOTORS.NS', '500570'), ('TATASTEEL.NS',  '500470'),
  ('JSWSTEEL.NS',   '500228'), ('ADANIENT.NS',   '512599'),
  ('ADANIPORTS.NS', '532921'), ('COALINDIA.NS',  '533278'),
  ('BAJAJ-AUTO.NS', '532977'), ('HEROMOTOCO.NS', '500182'),
  ('M&M.NS',        '500520'), ('EICHERMOT.NS',  '505200'),
  ('DRREDDY.NS',    '500124'), ('CIPLA.NS',      '500087'),
  ('DIVISLAB.NS',   '532488'), ('APOLLOHOSP.NS', '508869'),
  ('BRITANNIA.NS',  '500825'), ('TATACONSUM.NS', '500800'),
  ('GRASIM.NS',     '500300'), ('INDUSINDBK.NS', '532187'),
  ('BAJAJFINSV.NS', '532978'), ('SBILIFE.NS',    '540719'),
  ('HDFCLIFE.NS',   '540777'), ('TECHM.NS',      '532755'),
  ('LTIM.NS',       '540005'), ('HINDALCO.NS',   '500440'),
  ('SHRIRAMFIN.NS', '511218'), ('DABUR.NS',      '500096')
) as v(ticker, code)
where public.companies.ticker = v.ticker;

-- ---------------------------------------------------------------------
-- 3. announcement_events: calendar of forthcoming result announcements
--    The BSE calendar scraper upserts here; the results fetcher marks
--    `processed_at` once it has filed financial data for the company.
-- ---------------------------------------------------------------------
create table if not exists public.announcement_events (
  id                 uuid primary key default uuid_generate_v4(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  ticker             text not null,
  bse_scrip          text,
  announcement_date  date not null,
  source             text not null default 'bse',     -- bse / nse / manual
  purpose            text,                            -- "Q4 FY26 Board Meeting" etc.
  status             text not null default 'pending'  -- pending | fetched | missed
    check (status in ('pending','fetched','missed')),
  detected_at        timestamptz not null default now(),
  processed_at       timestamptz,
  raw_json           jsonb,
  constraint uq_ann unique (ticker, announcement_date, purpose)
);

create index if not exists idx_ann_date   on public.announcement_events(announcement_date);
create index if not exists idx_ann_status on public.announcement_events(status);
create index if not exists idx_ann_ticker on public.announcement_events(ticker);

alter table public.announcement_events enable row level security;

drop policy if exists "public read announcements" on public.announcement_events;
create policy "public read announcements"
  on public.announcement_events for select using (true);

-- ---------------------------------------------------------------------
-- 4. Helper view — upcoming events joined with company info
-- ---------------------------------------------------------------------
create or replace view public.v_upcoming_events as
select
  e.id,
  c.company_name,
  e.ticker,
  c.sector,
  c.bse_scrip,
  e.announcement_date,
  e.purpose,
  e.status,
  e.source,
  e.detected_at
from public.announcement_events e
join public.companies c on c.id = e.company_id
where e.announcement_date >= current_date - interval '1 day'
order by e.announcement_date asc;
