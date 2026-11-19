-- =====================================================================
-- Ad tracker: sponsored cards, their on/off state, and sync data.
-- Run in the Supabase SQL editor. Safe to re-run.
-- Both tables are server-only: RLS is on with no policies, so the anon
-- key can read nothing. The app reads and writes with the service role.
-- =====================================================================
create table if not exists public.ad_offers (
  id            text primary key,              -- 'x<cuelinks campaign>' or 'a<admitad campaign>'
  network       text not null check (network in ('cuelinks','admitad')),
  campaign_id   integer,
  name          text not null default '',
  domain        text not null default '',
  pages         text[] not null default '{}',  -- page keys, see lib/ads/pages.ts
  title         text not null default '',
  body          text not null default '',
  cta           text not null default '',
  note          text not null default '',
  url           text not null default '',
  orig          jsonb not null default '{}'::jsonb,  -- copy at creation, used by Reset
  live          boolean not null default false,      -- the Switch
  auto_paused   boolean not null default false,      -- set by the health check
  paused_reason text not null default '',
  live_at       timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists public.ad_kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.ad_offers enable row level security;
alter table public.ad_kv     enable row level security;
