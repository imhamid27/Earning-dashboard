-- Seed: Axis Credit Card (Cuelinks) sponsored card for Home and Sectors.
-- Run in the Supabase SQL editor after migration_ad_tracker.sql. Safe to re-run (does nothing if it exists).
-- The link was opened and lands on Axis Bank's online credit card application form (web.axis.bank.in).
-- It starts SWITCHED ON. To turn it off: Offers tab > Switch off, or run:
--   update public.ad_offers set live = false where id = 'x-axis-credit-card';
insert into public.ad_offers
  (id, network, campaign_id, name, domain, pages, title, body, cta, note, url, orig, live, live_at)
values (
  'x-axis-credit-card', 'cuelinks', null, 'Axis Credit Card CPL', 'bank.in',
  array['home','sectors'],
  'Looking for a credit card?',
  'Axis Bank has an online application for its credit cards. Check the fees and eligibility on the bank''s page before you apply.',
  'Apply on Axis Bank',
  'Sponsored link. We may earn a commission if you apply.',
  'https://linksredirect.com/?cid=336975&source=api&url=https%3A%2F%2Fweb.axis.bank.in%2FDigitalChannel%2FWebForm%2F',
  jsonb_build_object(
    'title', 'Looking for a credit card?',
    'text', 'Axis Bank has an online application for its credit cards. Check the fees and eligibility on the bank''s page before you apply.',
    'cta', 'Apply on Axis Bank',
    'note', 'Sponsored link. We may earn a commission if you apply.',
    'url', 'https://linksredirect.com/?cid=336975&source=api&url=https%3A%2F%2Fweb.axis.bank.in%2FDigitalChannel%2FWebForm%2F'
  ),
  true, now()
)
on conflict (id) do nothing;
