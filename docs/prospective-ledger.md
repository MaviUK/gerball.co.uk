# Prospective prediction ledger — database foundation

## Current scope — 2026-11-24

The priced-prediction infrastructure now includes private ingestion approvals, a gated ingestion RPC, append-only settlement revisions and private result/performance views. The deployed `gerball-prospective-ingest` version 11 requires verified recent executable-quote provenance and retains its approval gate. At inspection on 24 November, predictions, settlements and approvals each contained zero rows.

The new [Recorded screens tracker](recorded-screens.md) saves unpriced observations of the fixed historical H/D/A rules in a separate private schema. Its public read projection includes only those research observations. It does not add prices/stakes to this ledger or activate its draft strategy. The dated foundation notes below describe the earlier implementation stages.

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

## Security verification — 2026-11-23

Implemented `gerball_private.enforce_prediction_insert()` as a BEFORE INSERT trigger. It replaces any caller-provided `recorded_at` with `clock_timestamp()`, rejects non-future kickoffs and blank key identifiers.

Verified with transactional, rolled-back test rows:
- Timestamp spoofing replaced by server clock.
- Duplicate event/market/version rejected.
- UPDATE and DELETE rejected by append-only trigger.
- Past-kickoff INSERT rejected.
- Anonymous role lacks schema USAGE and table INSERT; authenticated role lacks table SELECT.
- No test rows remain in the ledger after verification.

**Important limitation:** Privileged database owners may still alter or disable triggers; this is a protected application ledger, not cryptographic immutability. No ingestion API or prospective scheduler has been activated.

## Settlement ledger — 2026-11-23

Created private `gerball_private.prospective_settlements` with prediction foreign key, sequential revision, server timestamp, status (WIN/LOSS/VOID/UNSETTLED), net units, official result source and event ID, result snapshot and mandatory correction reason for revision >1.

The BEFORE INSERT trigger enforces server-generated timestamps, prevents pre-kickoff settlement, and enforces sequential revisions with a per-prediction advisory lock. An append-only UPDATE/DELETE rejection trigger prevents ordinary modifications. RLS is enabled and anon/authenticated roles have no table permissions. Verified table empty and privileges denied.

**Not yet done:** trusted settlement ingestion, end-to-end tests using settled predictions, outcome verification against authoritative sources, version freeze, and live dashboard. Privileged database administrators can still alter triggers, so this is not cryptographically immutable.

## Current-result reconciliation view — 2026-11-23

Added `gerball_private.prospective_current_results`, a `security_invoker=true` view joining each immutable prediction with only its highest-revision settlement. Earlier corrections remain preserved in the settlement ledger. The view is private and explicitly denies anonymous and ordinary authenticated reads. Verified zero current rows and denied client-role SELECT privileges. No public dashboard or ingestion endpoint is enabled yet.
