-- =====================================================================
-- India Earnings Tracker — related_coverage migration
-- Stores contextual news articles for the "In Context" timeline card.
-- Populated by scripts/fetch_related_coverage.py (daily cron).
--
-- Run this AFTER supabase/schema.sql in the Supabase SQL editor.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
create table if not exists public.related_coverage (
  id               uuid primary key default uuid_generate_v4(),
  title            text not null,
  commentary       text,                          -- ≤ 20-word plain summary
  source_name      text not null,                 -- "Economic Times" etc.
  source_url       text not null unique,           -- canonical article URL
  published_at     timestamptz,
  matched_sector   text,                          -- sector that triggered the fetch
  matched_company  text,                          -- company name if targeted
  match_reason     text,                          -- e.g. "leading sector"
  is_active        boolean not null default true, -- false = older than 7 days
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_rc_published   on public.related_coverage(published_at desc);
create index if not exists idx_rc_active      on public.related_coverage(is_active) where is_active = true;
create index if not exists idx_rc_sector      on public.related_coverage(matched_sector);

-- Keep updated_at fresh
drop trigger if exists trg_rc_touch on public.related_coverage;
create trigger trg_rc_touch before update on public.related_coverage
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. Row Level Security
-- ---------------------------------------------------------------------
alter table public.related_coverage enable row level security;

-- Public read: the "In Context" card in the dashboard reads via anon key.
drop policy if exists "public read related_coverage" on public.related_coverage;
create policy "public read related_coverage"
  on public.related_coverage for select using (true);

-- Writes are done by the Python ingestion script using the service role
-- key, which bypasses RLS entirely — no insert/update policy needed.
