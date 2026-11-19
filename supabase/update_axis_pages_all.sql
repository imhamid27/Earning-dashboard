-- Show the Axis Credit Card sponsored card on every page.
-- Run in the Supabase SQL editor. Safe to re-run.
update public.ad_offers
set pages = array['home','q4','sectors','upcoming','company','compare','market-movers','results','year-in-review']
where id = 'x-axis-credit-card';
