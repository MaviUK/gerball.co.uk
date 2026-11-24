# Recorded historical screens

Open `https://gerball.co.uk/#tracking` to inspect saved rule observations and their imported results. The live Strategy screen recalculates upcoming fixtures; Recorded screens retains what was actually available when each observation was saved.

This is an unpriced research tracker for the fixed `ppg_last5_dates_050_v1` form rules. It records qualification and subsequent match outcomes. Its figures are outcome counts and match rates. The existing priced-prediction ledger, strategy approval workflow, quote-provenance requirements and draft betting candidate remain separate.

## Fixed method

- Same 18 leagues as the daily odds collector, with H/D/A assessed independently.
- Each team's five previous distinct match dates, all venues in the same league, including earlier seasons.
- At least five prior games for both teams; points per game rounded to three decimals.
- Home qualifies at home PPG minus away PPG >= 0.500; Away at the reverse >= 0.500; Draw at an absolute difference <= 0.500.
- The inclusive boundary can qualify both Draw and a directional market. No combined-winner interpretation is added.
- Current odds do not change qualification. No prices, intended stakes, profit, ROI or model probabilities are introduced by this tracker.
- Fixed 14-day upcoming horizon.

The manifest freezes the rule version, parameters, league universe, capture policy and the implementation hashes of the deployed screen and its fixture-data dependency. The recorder checks those hashes before saving another cohort. A change requires a reviewed new version; the old version cannot silently acquire different rules.

## Daily recording

Recording runs at **12:15 Europe/London**, after the existing noon odds collection. Bounded retries run at **12:20 and 12:25**. The UTC cron expression covers both UK offsets and a London-clock guard admits only the correct hour, handling GMT/BST automatically.

Each league needs a successful or inactive collection for the current UK date. A failed or missing collection is shown as missing coverage, rather than a successful zero-fixture capture. A successful empty capture is retained. The existing provider collector and football-data importer retain their schedules and behavior.

There is one immutable cohort per UK date, league and rule version. The cohort records its collection provenance, capture mode, time, fixture count and hash. The first installation can make an explicitly labelled bootstrap capture using the real current database time; this does not backfill earlier recording dates or pretend the records were saved at noon.

Each fixture observation retains:

- Provider event ID and provider/canonical team names.
- League, season, captured kickoff and London fixture date.
- Actual database recording time and historical cutoff.
- Both teams' date groups, game counts, points and rounded PPG.
- All three market statuses and reasons, including exclusions and unavailable history.
- Rule version, phase and a SHA-256 hash of the saved inputs.

The database supplies recording timestamps and rejects insertion at or after kickoff. Ordinary UPDATE and DELETE operations are blocked on the evidence tables. Duplicate daily requests reuse the existing cohort rather than rewriting it. These are application-level integrity controls; a database owner can still change database definitions.

## Repeated appearances and the evaluation boundary

Daily observations remain visible for audit. Overall outcome totals use the **first qualifying capture per event, market and rule version**. Aliased provider IDs for one exact canonical fixture are handled deterministically so the same imported result cannot inflate the settled denominator. Non-qualifying first observations do not prevent a later, genuinely pre-kickoff qualifying observation from becoming the first qualifier.

The phase is frozen from the captured London kickoff date:

| Captured fixture date | Reporting phase |
| --- | --- |
| Before 1 December 2026 | Calibration |
| 1 December 2026 onward | Post-boundary recorded observations |

A November capture of a December fixture is a valid advance observation and retains its November timestamp. November fixture outcomes remain outside the post-boundary totals. The phase is not rewritten if a fixture is later postponed. These observations do not approve the different priced betting candidate described in `prospective-evaluation-protocol.md`.

Each market has its own totals. A fixture qualifying for two markets is visible in each relevant market, without being presented as two independent matches. Match rate is matched outcomes divided by settled qualifying fixtures; when none have settled, the rate is absent rather than zero.

## Result reconciliation

A separate database job runs **hourly at :30**. It reads existing imported `public.matches` rows; it makes no sports-provider requests and does not run or alter the importer. Results therefore become available according to the existing Monday/Friday football-data import cadence.

Reconciliation begins at least three hours after the captured kickoff. Matching uses the frozen league, season, London fixture date and canonical home/away names. A settled result requires exactly one matching source row, nonnegative full-time scores and an H/D/A result consistent with those scores. The result source is the existing `football-data.co.uk` importer.

Missing, ambiguous, conflicting or rescheduled identities retain a pending/review state with an explicit reason. They are not assigned a guessed result or an automatic void. Original kickoff and input records stay intact.

Result evidence is append-only. A changed source result adds a new numbered revision, retaining the earlier evidence and a correction reason. An unchanged re-import adds no revision. The current projection uses the latest revision while exposing its audit history. Source match ID, source timestamp and reconciliation timestamp remain available for inspection.

## Page and export

The page offers league, H/D/A market, recorded date, qualification/outcome and team filters. It shows daily records alongside clearly labelled all-time unique-qualifier totals, split by phase. Records remain visible after kickoff. The browser renders saved qualification and inputs; it does not recalculate historical form using today's data.

Cards expose the frozen features and result provenance. Repeated observations identify their first qualifying record. CSV export retains recording time, version, phase, identity, rule inputs and result metadata, with spreadsheet formula prefixes neutralized.

## Access and deployment

Private research tables live in `gerball_tracking_private`. Anonymous and ordinary authenticated roles have no direct table or recorder access. Database cron performs recording and reconciliation. The service-only `public.gerball_recorded_screens(text, date)` RPC returns a bounded projection of these new unpriced research observations.

The `gerball-recorded-screens` Edge Function accepts GET and preflight only, validates the existing public application key, and invokes that one read RPC using its server-only credential. It exposes no capture or settlement operation. The existing private prediction, settlement and approval tables are excluded from its request path.

Deploy the committed tracking migration, verify its schema and role protections, make the bootstrap capture, deploy the read Edge Function, and publish the frontend through the existing main-branch Netlify flow. The migration registers the independent capture and reconciliation jobs.

Validation includes:

```bash
node scripts/check-site.cjs
node --test scripts/check-recorded-screens-endpoint.mjs scripts/check-recorded-screens-ui.mjs scripts/check-recorded-screens-bridge.mjs
node scripts/check-live-recorded-screens.mjs
```

`supabase/recorded-screen-verification.sql` checks database invariants, role isolation, immutable inputs, duplicate handling, source reconciliation and phase-separated outcome counts. Existing historical benchmarks remain part of CI.
