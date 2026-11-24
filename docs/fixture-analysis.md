# Historical fixture analysis

Every upcoming fixture has a **Match analysis** button. It opens a focused comparison using Gerball's stored match results. The analysis is independent of captured bookmaker prices: it does not use them to select a team, produce a probability or certify a betting edge.

## What the comparison shows

- Current-season results, points per game and goals scored/conceded.
- Season totals or the most recent 5, 10 or 20 recorded current-season matches.
- All venues, or home matches for the upcoming home team and away matches for the upcoming away team.
- Win/draw/loss, over/under 2.5 goals, both-teams-to-score, clean-sheet and failed-to-score frequencies. Rates show their actual sample counts.
- A separately labelled full-season league baseline.
- Each team's recent recorded results.
- The latest five recorded meetings between the matched names in the fixture's league, across seasons.

These are observed frequencies. An 80% historical rate means the event occurred in 80% of the displayed sample; it is not a calibrated 80% probability for the upcoming match. Team samples may overlap in a previous head-to-head match, so the interface does not combine them into a synthetic probability.

## Scope and cutoff

The fixture identity and canonical club names reuse the reviewed mapping from the Upcoming Fixtures read model. Explicit aliases take priority over exact historical spellings. Unknown names are left unmatched.

The season follows July–June. Only completed recorded results with valid goals are included. The analysis cutoff is the earlier of today in Europe/London and the calendar day before the upcoming fixture. Matches on the fixture's own date are excluded because historical kickoff times are not consistently available.

The venue filter applies **before** the last-N selection: “Last 10, relevant venue” means up to ten home matches for the home team and ten away matches for the away team within that season. It does not mean the home/away subset of ten mixed-venue games.

If fewer matches exist, the actual count is displayed. No-sample counts are zero, while rates, averages and points per game are null and display as unavailable. A genuine 0% from a nonempty sample remains 0%. Head-to-head win totals follow the identities of the upcoming teams, even when their historical venues were reversed.

## Implementation

- UI: `assets/fixture-analysis.js` and `assets/fixture-analysis.css`.
- Card integration: `assets/upcoming.js` and `assets/upcoming-bridge.js`.
- Public endpoint: `supabase/functions/gerball-fixture-analysis/`.
- Service-only SQL RPC: `public.gerball_fixture_analysis(text, integer)`.
- Read-only production assertions: `supabase/fixture-analysis-verification.sql`.

The endpoint accepts only:

```text
GET /functions/v1/gerball-fixture-analysis?event_id=EVENT_ID&window=10
```

`event_id` is required; `window` is 5, 10 or 20 and defaults to 10. Invalid/duplicate parameters are rejected before any database request. Missing or started fixtures return HTTP 404. GET and OPTIONS are the only supported methods.

The Edge Function uses the built-in server-side service-role credential to call the fixed RPC. The RPC is SECURITY INVOKER with an empty search path, and execution is denied to PUBLIC, anon and authenticated. Its output contains explicit historical aggregates and bounded result lists. No provider credentials, raw source payloads, current prices or private ledger records are returned.

The function is intentionally configured with `verify_jwt = false` for this public read-only view. Successful HTTP responses have a 60-second cache lifetime; error responses are uncached. The dialog loads on demand, cancels superseded requests and reuses a short-lived cache by fixture and window. Close/Escape returns keyboard focus to the fixture action.

**Captured prices** opens that same event's stored bookmaker comparison above the analysis dialog. Closing it returns to the chosen historical sample and venue, with focus on the price action. The history request and historical calculations remain independent of prices. See [Captured prices](captured-prices.md).

## Deployment and checks

Apply the committed `gerball_fixture_analysis` migration to project `hdueztssmsvvxkwqgcnm`, deploy the `gerball-fixture-analysis` Edge Function, then publish the frontend through the existing GitHub `main` to Netlify deployment. No new secrets, importer settings or collection schedules are required.

```bash
node scripts/check-site.cjs
node --test scripts/check-fixture-analysis-endpoint.mjs scripts/check-fixture-analysis-ui.mjs
node --test scripts/check-upcoming-endpoint.mjs scripts/check-upcoming-ui.mjs scripts/check-upcoming-bridge.mjs scripts/check-team-aliases.mjs
```

The read-only database verification independently derives results from recorded scores and checks recent-window ordering, venue selection, same-day exclusion, head-to-head identity orientation, empty samples and service-only access. Existing historical benchmark and collector checks remain in the GitHub workflow.
