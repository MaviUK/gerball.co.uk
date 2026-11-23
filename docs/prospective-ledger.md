# Prospective prediction ledger — database foundation

Created 2026-11-23 in Supabase project hdueztssmsvvxkwqgcnm.

## Database
Private schema: `gerball_private`
Table: `gerball_private.prospective_predictions`

Columns: generated identity ID, server-side recorded_at, kickoff_at, event_key, league, home_team, away_team, market (H/D/A/O25/U25), strategy_version, observed_odds, odds_source, stake_units, input_sha256, selection_snapshot.

Guards:
- A database constraint requires recorded_at < kickoff_at.
- Unique event_key + market + strategy_version prevents identical selection duplicates.
- Row-level security enabled.
- No privileges granted to anon or authenticated roles; private schema is not exposed through normal browser REST API.
- BEFORE UPDATE/DELETE trigger rejects modifications to stored selections.
- Records are stamped with database clock at insertion; clients cannot be trusted to supply recording time. A future ingestion function should explicitly omit recorded_at and should enforce that only server-side trusted code can insert.
- There is **no public insertion API, live selection scheduler, settled-outcome table or admin UI yet**. No bets are recorded automatically.

## Remaining security and reliability work
- Add trusted server-side authenticated ingestion that does not accept caller-provided recorded_at, validates an approved strategy version and verifies odds source/timestamp.
- Ensure database roles used by ingestion cannot bypass append-only protections or edit clock values.
- Add append-only settlement events and reconciliation against official results.
- Add timestamped strategy approval/freeze before 2026-12-01.
- Test pre-kickoff rejection, duplicate rejection, mutation rejection, access control and replay safety.
