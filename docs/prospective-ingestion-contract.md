# Prospective ingestion — implementation and acceptance contract

Status: **development only; ingestion disabled**. Branch: `feature/prospective-ingestion`.

## Existing schema
See [prospective-ledger.md](prospective-ledger.md). The private predictions and settlements tables and current-results view already exist. Never expose the private schema to browser roles.

## Trusted ingestion boundary
Implement a server-only endpoint (Supabase Edge Function or existing backend) with:
- Authentication using a dedicated server-held credential, constant-time comparison where applicable, and an explicit allowlist of permitted operators. Never accept browser JWT alone as authority to insert.
- Secrets in the deployment secret store, never source control or client environment variables.
- Explicit feature flag `PROSPECTIVE_INGESTION_ENABLED=false` by default. Return 503 while disabled.
- Exact request schema and strict field validation: event_key, kickoff_at, league, home_team, away_team, market (H/D/A/O25/U25), strategy_version, observed_odds, odds_source, odds_observed_at, stake_units, input_sha256, selection_snapshot.
- Do not accept or forward client-provided `recorded_at`. Database stamps insertion time.
- Verify a server-side, previously frozen and approved strategy version and approved odds source. Reject missing, unapproved, future-dated or stale odds observations. Freeze timestamp must precede selection recording.
- Reject kickoffs not strictly after the database recording time. Keep database trigger as final guard.
- Use a least-privilege database role restricted to INSERT on predictions, not owner/service-role when practical. No UPDATE/DELETE.
- Never trust request-provided odds-source metadata without provenance (signed provider payload or server-side verified provider fetch). A timestamp field alone does not prove observation.
- Idempotency: unique event_key + market + strategy_version; on replay return the original record identifier without modifying the record, after verifying identical immutable payload. Conflicting payload for same key returns 409.
- Redact credentials and sensitive payloads from logs; log request ID, outcome, server timestamp, strategy version and source reference.

## Settlement boundary
Use a separate trusted endpoint/role to append a settlement revision only after kickoff. Verify official source/event ID and score/outcome, calculate WIN/LOSS/VOID and net units on the server from immutable prediction details. For corrections, require a reason and next sequential revision. Never overwrite historical settlements. UNSETTLED must not contribute to ROI or drawdown.

## End-to-end test matrix
1. Disabled flag -> 503; no rows.
2. Missing/invalid authentication -> 401/403; no rows.
3. Valid authentication but unapproved strategy -> reject.
4. Unapproved, stale or unverified odds -> reject.
5. Client-supplied `recorded_at` -> reject at API; DB always stamps actual time.
6. Kickoff in past or at current time -> reject.
7. Valid pre-kickoff selection -> exactly one immutable row.
8. Identical replay -> same ID, no extra row.
9. Same key with changed odds/stake -> 409, no mutation.
10. Anonymous/authenticated browser roles -> no direct access.
11. Valid post-kickoff settlement -> append revision 1.
12. Duplicate settlement retry -> no extra revision.
13. Corrected official result -> append revision 2 with reason; current-results view shows revision 2, revision 1 remains.
14. Concurrent submissions/settlements -> unique, sequential, no gaps.
15. Reporting uses latest settled revision only, excludes UNSETTLED, handles VOID and zero-stake correctly.

## Activation gate
Do not enable live recording, scheduled predictions, betting, or public ROI until: strategy is frozen with immutable version and timestamp; odds source and verification method approved; all tests pass; deployment secrets configured; owner explicitly approves activation.

## Deployment blocker (2026-11-23)
Connected Supabase SQL execution returned `You do not have permission to perform this action`. No schema inspection, endpoint deployment or end-to-end database verification was possible in this session. This document is an implementation contract, **not** evidence that ingestion was built or tested.
