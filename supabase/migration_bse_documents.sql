-- =====================================================================
-- BSE documents migration
-- Adds two tables for BSE announcements and annual reports, populated
-- by scripts/bse_documents.py which runs with curl_cffi + Chrome TLS.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- =====================================================================

-- company_announcements: recent corporate announcements from BSE
create table if not exists public.company_announcements (
  id          uuid primary key default uuid_generate_v4(),
  ticker      text not null,
  bse_id      text not null,          -- BSE's seqno value
  date        date not null,
  subject     text not null,
  category    text,
  subcategory text,
  pdf_url     text,
  fetched_at  timestamptz not null default now(),
  constraint uq_ann_bse unique (ticker, bse_id)
);

create index if not exists idx_co_ann_ticker_date
  on public.company_announcements (ticker, date desc);

alter table public.company_announcements enable row level security;

drop policy if exists "public read company_announcements"
  on public.company_announcements;
create policy "public read company_announcements"
  on public.company_announcements for select using (true);

grant select                          on public.company_announcements to anon;
grant select, insert, update, delete  on public.company_announcements to service_role;


-- company_annual_reports: annual report PDFs from BSE
create table if not exists public.company_annual_reports (
  id         uuid primary key default uuid_generate_v4(),
  ticker     text not null,
  bse_id     text not null,
  year       text not null,          -- e.g. "2025-2026"
  title      text,
  pdf_url    text,
  fetched_at timestamptz not null default now(),
  constraint uq_ann_report_bse unique (ticker, bse_id)
);

create index if not exists idx_co_ar_ticker_year
  on public.company_annual_reports (ticker, year desc);

alter table public.company_annual_reports enable row level security;

drop policy if exists "public read company_annual_reports"
  on public.company_annual_reports;
create policy "public read company_annual_reports"
  on public.company_annual_reports for select using (true);

grant select                          on public.company_annual_reports to anon;
grant select, insert, update, delete  on public.company_annual_reports to service_role;
