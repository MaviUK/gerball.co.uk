# Gerball daily odds collection

Deployed to Supabase project `hdueztssmsvvxkwqgcnm` on 24 November 2026.

## Source and deployed components

- `supabase/functions/gerball-odds-collector/index.ts`: Edge Function entrypoint.
- `supabase/functions/gerball-odds-collector/collector.mjs`: authentication, credential diagnostics, provider adapter and collection.
- `supabase/migrations/20261124164606_gerball_daily_odds.sql`: protected tables, scheduler authentication and transactional RPCs.
- `supabase/migrations/20261124164738_gerball_daily_odds_schedule.sql`: UK-noon cron schedule.
- `scripts/check-odds-collector.mjs`: behavioural tests run by GitHub Actions.
- `supabase/odds-collector-verification.sql`: rollback-only database integration checks for a database with no run on the current date. Prefer a test project for later reruns.

The collector stores market data in new tables. The existing prospective-prediction function, historical match table and football-data import workflow are independent of this deployment.

## Daily operation

The `gerball-daily-odds` cron job evaluates at `0,5,10 11,12 * * *` in GMT. Its SQL condition uses `Europe/London`, allowing the request only at local 12:00, 12:05 and 12:10. Collection starts at **12:00 UK time** throughout GMT and BST. The later calls recover unfinished work; a completed day's run returns immediately without provider requests.

The Edge Function independently checks the same 12:00–12:14 UK window. Each run selects its credential using the London date and weekday:

| Day | Existing Edge Function secret |
| --- | --- |
| Monday | `ODDS_API_KEY_MON` |
| Tuesday | `ODDS_API_KEY_TUE` |
| Wednesday | `ODDS_API_KEY_WED` |
| Thursday | `ODDS_API_KEY_THU` |
| Friday | `ODDS_API_KEY_FRI` |
| Saturday | `ODDS_API_KEY_SAT` |
| Sunday | `ODDS_API_KEY_SUN` |

The built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` support server-side RPC calls. `GERBALL_ODDS_LEAGUES` optionally narrows the comma-separated list of supported league keys. Empty or unrecognised configuration fails explicitly. A day's league configuration is frozen after its first claim.

The scheduler token is generated inside Supabase Vault as `gerball_odds_cron_token`. A SHA-256 digest is stored in `gerball_odds_private.settings`. The handler hashes the `x-gerball-token` header and checks it through a service-role-only RPC. No additional Edge secret setup or copying of provider keys is required. Raw tokens and provider keys are absent from source, responses, snapshots and request URLs.

## Coverage and timestamps

The Odds API v4 requests use header authentication, `regions=uk`, `markets=h2h,totals`, decimal odds and ISO times. Future kickoffs are requested and checked again during normalization. Only these selections are stored:

- Home, draw and away (`H`, `D`, `A`).
- Over and under 2.5 goals (`O25`, `U25`). Other totals lines and exchange lay markets are excluded.

The 18 configured provider leagues map to historical league codes: E0, E1, E2, E3, SC0, D1, D2, SP1, SP2, I1, I2, F1, F2, N1, P1, B1, T1 and G1. Scottish lower divisions have no invented provider mappings. Every daily run rechecks the provider's sports catalogue. Inactive leagues are recorded explicitly.

Each snapshot retains the provider timestamp (`source_updated_at`), actual fetch time (`collected_at`), database insertion time (`recorded_at`), kickoff, London collection date, bookmaker, market and selection. The SHA-256 digest of the provider response supplies an audit fingerprint; the raw provider payload is not retained. This fingerprint alone is not an independently verifiable archive of that payload.

The database rejects future source timestamps and non-prematch snapshots. A 15-second margin excludes fixtures about to start during database insertion. Coverage counts are derived from the rows actually stored. Some bookmakers or fixtures may lack the 2.5-goal line, so totals coverage can be lower than match-result coverage.

## Duplicate prevention and recovery

A unique date claims one collection run. The claim has an owner UUID and a 180-second lease. Concurrent requests cannot acquire the same active run. An expired lease can be reclaimed, and every store/finalize operation checks ownership and lease expiry under a row lock.

Each league commits its normalized snapshots and completion status together. Retries skip completed/inactive leagues and preserve the first saved snapshot. The unique identity is:

`provider + event_id + bookmaker_key + market + selection + line + collection_date`

Service-role permissions allow snapshot insertion and reading, but deny snapshot updates and deletes. Anonymous and ordinary authenticated clients have no access to the new tables or RPCs. All exposed tables have RLS enabled. RPCs use `SECURITY INVOKER` and have explicit service-role-only execution grants.

Three bounded workers collect leagues concurrently, each provider request has an eight-second timeout, and a 95-second collection deadline leaves time to finalize before the scheduler's 120-second HTTP timeout. Automatic claims are limited to three attempts per day. Errors and remaining quota are stored per league; the daily remaining allowance uses the minimum observed response header to handle out-of-order responses.

## Credential verification

Run this through the authenticated Supabase SQL Editor or management connection. It returns a request ID only; it does not reveal the scheduler token or provider keys.

```sql
select net.http_post(
  url := 'https://hdueztssmsvvxkwqgcnm.supabase.co/functions/v1/gerball-odds-collector',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-gerball-token', (
      select decrypted_secret from vault.decrypted_secrets
      where name = 'gerball_odds_cron_token'
    )
  ),
  body := '{"action":"verify"}'::jsonb,
  timeout_milliseconds := 45000
) as request_id;
```

Read the response using the returned ID:

```sql
select id, status_code, timed_out, error_msg, content::jsonb as result
from net._http_response
where id = <returned_request_id>;
```

Verification calls `/v4/sports/`, which costs zero usage credits. Results include presence, authentication status, HTTP status and quota headers for every daily credential. `pg_net` response records are temporary; run and odds tables provide the durable collection history.

## Manual commissioning and recovery

The same authenticated request with body `{"action":"collect","manual":true}` permits a collection outside the noon window. It uses the current London date and actual current timestamps. It also uses the same daily run and duplicate constraints. A completed daily run remains a no-op, even for a manual call. An incomplete run can be retried manually after its active lease expires.

A successful manual collection before midday occupies that date's daily snapshot. Use credential verification for routine morning checks. The commissioning run on 24 November took place after midday.

## Deployment and maintenance

The migration filenames match the versions recorded in the project's migration history. Apply new schema changes as separately reviewed migrations. For a source-only deployment using the verified Supabase CLI v3 command syntax:

```bash
npx --yes supabase@3.4.0 functions deploy gerball-odds-collector \
  --remote=hdueztssmsvvxkwqgcnm \
  --no-verify-jwt \
  --use-api \
  --yes
```

Use an authenticated Supabase CLI account or an appropriately scoped access token. The explicit function name deploys only this collector. The handler's private-token authentication is required when gateway JWT verification is disabled.

Useful operational queries:

```sql
select collection_date, status, attempts, credential_slot, records_collected,
       requests_remaining, started_at, completed_at, error_message
from public.gerball_odds_runs
order by collection_date desc limit 14;

select sport_key, status, records_collected, event_count,
       bookmaker_count, h2h_records, totals_records, error_message
from public.gerball_odds_league_runs
where collection_date = (now() at time zone 'Europe/London')::date
order by sport_key;

select jobid, jobname, schedule, active
from cron.job where jobname = 'gerball-daily-odds';
```

To pause this collector alone, a database owner can use `cron.alter_job(<jobid>, active := false)` after obtaining the job ID above. This leaves all snapshots and the separate football-data workflow intact.

## Commissioning evidence — 24 November 2026

- All seven existing credentials returned HTTP 200 at 16:46 UK time, each with 500 credits remaining and zero credits charged by verification.
- A live collection completed from 16:48:49 to 16:48:53 UK time using `ODDS_API_KEY_TUE`.
- 13,821 odds rows were stored for 243 fixtures and 21 bookmakers across 17 active leagues.
- 12,633 rows were home/draw/away prices; 1,188 were over/under 2.5 prices.
- French Ligue 2 was marked inactive by the provider and recorded as inactive.
- The run consumed 34 Tuesday-key credits, leaving 466.
- Database checks found zero duplicate identities, zero invalid timestamp sequences and zero leftover test rows.
- Thirteen JavaScript behavioural tests and the rollback-only live database integration checks passed.
- The existing site's regression checks passed, including the Monday/Friday football-data import schedule.
- Historical match count remained 211,600 after applying the new schema.
- The active schedule's UTC-to-London mapping was checked across winter, summer and both 2027 clock changes.

## Provider and platform references

- [The Odds API v4: authentication, sports, markets and quota](https://the-odds-api.com/liveapi/guides/v4/)
- [The Odds API sport keys](https://the-odds-api.com/sports-odds-data/sports-apis.html)
- [Scheduling Supabase Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase Edge Function runtime limits](https://supabase.com/docs/guides/functions/limits)
