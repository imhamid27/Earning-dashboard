-- =====================================================================
-- Migration: Live Commentary + Expert Quotes tables
-- Run in Supabase SQL editor (safe to re-run).
-- Part of the Corporate Earnings Dashboard upgrade (April 2026).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. live_commentary
--    Auto-generated, factual one-sentence summaries triggered when a
--    new earnings filing lands.  Max 25 words per entry.
--    Source: 'auto' = Python script; 'manual' = editorial override.
-- ---------------------------------------------------------------------
create table if not exists public.live_commentary (
  id           uuid primary key default uuid_generate_v4(),
  company      text not null,
  ticker       text,
  quarter      text,
  text         text not null,
  source       text not null default 'auto'
    check (source in ('auto', 'manual')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Upsert key: only one commentary entry per (ticker, quarter).
-- On re-run the script replaces the text if new data arrives.
create unique index if not exists uq_commentary_ticker_quarter
  on public.live_commentary (ticker, quarter)
  where ticker is not null and quarter is not null;

create index if not exists idx_commentary_created
  on public.live_commentary (created_at desc);

create index if not exists idx_commentary_ticker
  on public.live_commentary (ticker);

-- updated_at trigger
drop trigger if exists trg_commentary_touch on public.live_commentary;
create trigger trg_commentary_touch
  before update on public.live_commentary
  for each row execute function public.touch_updated_at();

-- RLS: public read, service-role write
alter table public.live_commentary enable row level security;

drop policy if exists "public read commentary" on public.live_commentary;
create policy "public read commentary"
  on public.live_commentary for select using (true);

-- ---------------------------------------------------------------------
-- 2. expert_quotes
--    Curated management / analyst commentary sourced from earnings
--    calls, investor presentations, and public news quotes.
--    A quote is hidden from the UI when is_active = false (allows
--    editorial removal without hard-deleting rows).
-- ---------------------------------------------------------------------
create table if not exists public.expert_quotes (
  id             uuid primary key default uuid_generate_v4(),
  expert_name    text not null,
  photo_url      text,
  designation    text,
  firm           text,
  quote          text not null,
  source_url     text,
  source_name    text,
  published_date date,
  ticker         text,                    -- optional company tie-in
  quarter        text,                    -- optional quarter tie-in
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_quotes_active
  on public.expert_quotes (is_active, created_at desc)
  where is_active = true;

create index if not exists idx_quotes_ticker
  on public.expert_quotes (ticker)
  where ticker is not null;

-- updated_at trigger
drop trigger if exists trg_quotes_touch on public.expert_quotes;
create trigger trg_quotes_touch
  before update on public.expert_quotes
  for each row execute function public.touch_updated_at();

-- RLS: public read, service-role write
alter table public.expert_quotes enable row level security;

drop policy if exists "public read quotes" on public.expert_quotes;
create policy "public read quotes"
  on public.expert_quotes for select using (is_active = true);

-- ---------------------------------------------------------------------
-- 3. Add 'source' column to quarterly_financials if not present
--    (safe: do nothing when already exists)
-- ---------------------------------------------------------------------
alter table public.quarterly_financials
  add column if not exists source text not null default 'unknown';

-- ---------------------------------------------------------------------
-- 4. Optional: seed a placeholder expert quote so the block renders
--    on first deploy (editors replace/add via Supabase dashboard).
-- ---------------------------------------------------------------------
insert into public.expert_quotes
  (expert_name, designation, firm, quote, source_name, published_date, is_active)
values
  (
    'Editorial note',
    'Dashboard',
    'The Core',
    'Expert commentary from earnings calls and public disclosures will appear here as results are reported.',
    'The Core',
    current_date,
    true
  )
on conflict do nothing;
