-- Optional: schedule the ingestion via Supabase/pg_cron.
--
-- Supabase hosts pg_cron in the `extensions` schema. The recommended pattern
-- is to call an Edge Function (which runs the Node ingester), not to hit
-- Yahoo directly from Postgres. See README.md "Scheduling" for the Edge
-- Function template; this file is the cron half of that setup.
--
-- Run once in the SQL editor after deploying the `ingest-earnings` Edge Function.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> with your values.
-- This fires every weekday at 14:45 UTC (post-IST market close).
select
  cron.schedule(
    'earnings-ingest-daily',
    '45 14 * * 1-5',
    $$
      select
        net.http_post(
          url     := 'https://<PROJECT_REF>.functions.supabase.co/ingest-earnings',
          headers := jsonb_build_object(
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
            'Content-Type',  'application/json'
          ),
          body    := '{}'::jsonb
        ) as request_id;
    $$
  );

-- Inspect / unschedule:
--   select * from cron.job;
--   select cron.unschedule('earnings-ingest-daily');
