# Data status and coverage

Open `https://gerball.co.uk/#data` for the shared archive, daily odds, recorded-screen coverage and result-check status. Overview includes a compact status panel linking to the same data. Refreshing either view reads stored status; it does not trigger an import, spend provider credits or modify research observations.

## What the numbers mean

The historical archive covers 21 configured leagues. Eighteen have a configured daily odds feed and recorded-screen capture. The three lower Scottish divisions remain available in the historical archive and are labelled as having no configured odds feed.

Historical coverage reports stored rows, current-season rows and the latest stored result date for each league. These dates describe the contents of the archive. They do not establish that every expected fixture is present, and a gap between dates does not by itself establish a failed import.

The existing importer has no reliable persisted run audit. The dashboard therefore does not report an invented last successful import time or treat row insertion timestamps as proof of a complete refresh. It displays the repository's declared Monday/Friday **08:15 UTC** schedule, its next occurrence in UK time, and its explicitly configured `2627` season. A calendar-season mismatch is shown for attention. GitHub can delay scheduled execution.

Daily collection shows completed, inactive, failed and missing leagues separately. An inactive provider league counts as a successful check with zero fixtures. A saved empty recording cohort also counts as successful recording coverage.

Result counts measure **stored observations**, including repeated daily records. They are operational counts. The unique qualifying-fixture outcomes remain on Recorded screens. A recent successful reconciliation does not mean every match has finished or entered the imported archive.

## Schedule states

| Stage | Planned runs | Missing data becomes overdue |
| --- | --- | --- |
| Daily odds | 12:00 UK; retries 12:05 and 12:10 | 12:15 UK |
| Recorded screens | 12:15 UK; retries 12:20 and 12:25 | 12:30 UK |
| Result reconciliation | Hourly at :30 | 90 minutes after the last successful check; initial run has a short grace period |

UK schedules use `Europe/London` and follow GMT/BST. Missing current-day data before its scheduled time is shown as not due. The period between the initial run and deadline is a waiting state. A failed run, disabled or missing job, changed job configuration, or incompatible frozen rule implementation is shown for attention.

The monitor checks the three existing database jobs using a restricted metadata projection. A successful odds-dispatch cron execution does not prove a successful provider collection; coverage also requires the actual parent and per-league run evidence. The import schedule is separately identified as declared repository configuration because it runs in GitHub Actions.

Recent history contains at most seven actual collection/recording dates from the recent window. Dates before installation are not invented as failed runs. Manual collection and initial recording retain their mode labels.

## Access and privacy

The `gerball-data-status` Edge Function allows GET and preflight only. It validates the existing public application key and calls only `public.gerball_data_status()` with no caller-supplied arguments. Server credentials remain inside the function.

The service-only RPC exposes fixed aggregate fields. Private monitoring helpers restrict access to the service role and database owner. The result contains no scheduler commands, Vault values, token hashes, credential slots, raw provider errors, arbitrary database logs or private priced-prediction records. A closed response schema rejects unexpected fields before returning data to the client.

A narrow, non-unique covering index supports the archive counts and stored-date checks. It adds no data constraints or match values. The monitor reads existing tables. It does not change the football-data importer, daily collector, frozen strategy functions, recording jobs, original observations or result revisions.

## Validation and deployment

```bash
node scripts/check-site.cjs
node --test scripts/check-data-status-endpoint.mjs scripts/check-data-status-ui.mjs scripts/check-data-status-bridge.mjs
node scripts/check-live-data-status.mjs
```

Database verification exercises scheduled and overdue states, clock changes, inactive/empty/unsupported leagues, restricted roles and safe output within a rolled-back transaction. Existing data counts and protected function definitions are compared before and after deployment. The full GitHub Actions workflow continues to check historical benchmarks and the existing collection and research features.

Apply the coverage-index migration in its own transaction, followed by the reviewed monitoring migration. Deploy the new Edge Function, then publish the frontend through the existing main-branch Netlify deployment. The index migration uses a two-second lock timeout and a ninety-second statement timeout. No existing schedule needs to be recreated or changed.
