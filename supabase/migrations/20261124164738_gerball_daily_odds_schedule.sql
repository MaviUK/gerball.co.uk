-- Apply after deploying and verifying gerball-odds-collector.
-- One UK-noon collection, with two bounded retries for incomplete leagues.
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'gerball-daily-odds',
  '0,5,10 11,12 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://hdueztssmsvvxkwqgcnm.supabase.co/functions/v1/gerball-odds-collector',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gerball-token', (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'gerball_odds_cron_token'
      )
    ),
    body := '{"action":"collect","manual":false}'::jsonb,
    timeout_milliseconds := 120000
  )
  WHERE extract(hour FROM clock_timestamp() AT TIME ZONE 'Europe/London') = 12
    AND extract(minute FROM clock_timestamp() AT TIME ZONE 'Europe/London') < 15;
  $job$
);
