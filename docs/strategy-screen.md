# Historical strategy screen

Open `https://gerball.co.uk/#screening` to apply the existing default points-per-game rules to upcoming fixtures in a selected league. This is a research screen with retrospective evidence, not an approved prospective selection run.

## Fixed version and qualification

Version: `ppg_last5_dates_050_v1`.

The screen reproduces `edgelab_walkforward_matches` rather than substituting the season totals shown on the fixture cards:

1. Use recorded scored matches in the same league, at all venues, including earlier seasons.
2. Group each team's points and games by match date.
3. Select the previous five distinct recorded match dates.
4. Divide total points by total games and round PPG to three decimal places.
5. Require at least five prior games for both teams.

For upcoming fixtures, the cutoff is the earlier of today in Europe/London and the day before the fixture's London date. Results on the fixture's date are excluded. The response and interface expose game counts and the actual date groups; history can cross a season boundary or contain a long gap.

| Market | Historical condition |
| --- | --- |
| Home win | Home prior PPG minus away prior PPG is at least 0.50 |
| Draw | Absolute prior PPG difference is at most 0.50 |
| Away win | Away prior PPG minus home prior PPG is at least 0.50 |

Markets are assessed independently. At an exact 0.500 difference, the directional win rule and draw rule can both match. They are not combined into a single predicted winner. The old lab's over/under rules share the same absolute-PPG condition, which does not select a goals direction, so this screen offers H/D/A only.

Statuses distinguish `match`, `no_match`, `insufficient_history` and `unmatched_team`. The existing reviewed aliases resolve provider names; unresolved names are not guessed. A real zero PPG remains zero. Missing inputs remain null and cannot qualify.

Current prices do not affect qualification. The new endpoint returns no current odds, recommendations, expected values or calibrated probabilities. The detailed Match analysis button opens the existing historical comparison, whose season/venue controls are a separate descriptive view.

## Historical evidence

The fixed research interval is **1 August 2023 through 30 June 2026**, matching the existing lab defaults. For each H/D/A rule, the screen reports the full period and its final 30% by distinct match dates. The split date is selected before rule and price filtering, exactly as in the existing historical benchmark code. This final slice is retrospective research; it has already been available during development.

Returns use stored `B365H`, `B365D` and `B365A` fields, an archived odds range of **1.50–4.00**, flat **one-unit stakes**, **1% assumed price reduction** and **2% assumed commission on winning profit**. These are the existing comparison assumptions, not a claim about an executable price or a bookmaker's actual fee schedule.

```text
winning net = (max(1.01, archived_odds × 0.99) − 1) × 0.98
losing net = −1 unit
ROI = total net / priced bets × 100
```

Both samples report bets, wins, net units, ROI, average archived odds, chronological maximum drawdown, and first/last qualifying dates. The final slice starts its own equity curve at zero. Equal-date results are ordered by home team, away team and row ID. Per-season results and price coverage are available for inspection.

Coverage reconciles as:

```text
historical rule matches = priced bets + missing/invalid prices + prices outside the range
```

The current fixture screen applies the historical form condition alone. Archived returns additionally apply the stated historical price range. Matching the form condition therefore does not imply that a current price satisfies the archived comparison's price assumptions.

## Interface

The workspace has league, market, fixture horizon, result-status and team-search controls. Market/status/search filtering uses the loaded league response; league or horizon changes fetch a fresh response. It can show rule matches or all fixtures so exclusions remain inspectable. Every card shows its rule reason, both PPG inputs, sample size and effective cutoff.

The view initializes only when opened. Superseded fetches are cancelled or ignored; data from a previously selected league cannot be displayed as the new league. Returning to an expired screen refreshes it. Started fixtures are removed from displayed results. The research CSV export retains rule/version, inputs and statuses, and escapes spreadsheet formula prefixes.

## Endpoint and access

```text
GET /functions/v1/gerball-strategy-screen?league=E0&days=14
```

`league` is one of the collector's 18 supported league codes; `days` is an integer from 1 to 31. Defaults are E0 and 14. Unknown or duplicated query parameters are rejected. The endpoint permits GET and CORS preflight only.

The browser sends the site's existing public application key in the `apikey` header. Supabase publishable keys are not JWTs, so `verify_jwt = false` is paired with explicit application-key validation in the handler against `SUPABASE_PUBLISHABLE_KEYS`. This identifies the public application, not an individual user. It grants access only to this bounded read projection. Missing or incorrect keys are rejected before database work; absent runtime key configuration fails closed.

The handler invokes the single fixed RPC `public.gerball_strategy_screen(text, integer)` using a server-only key. It uses the platform's modern `SUPABASE_SECRET_KEYS.default` when available and the existing service-role environment key as a compatibility fallback. The RPC is SECURITY INVOKER with an empty search path and EXECUTE restricted to service_role. Errors are sanitized and uncached; successful responses have a 60-second cache lifetime.

No new private credentials, provider requests, collector schedules, historical writes, prospective approvals, predictions or settlements are introduced.

## Deployment and verification

Apply the committed `gerball_strategy_screen` migration to production project `hdueztssmsvvxkwqgcnm`, deploy `gerball-strategy-screen`, then publish the frontend through the existing GitHub main-branch Netlify deployment. No runtime secrets need to be copied into browser code.

```bash
node scripts/check-site.cjs
node --test scripts/check-strategy-screen-endpoint.mjs scripts/check-strategy-screen-ui.mjs scripts/check-strategy-screen-bridge.mjs
node scripts/check-live-strategy-screen.mjs
```

`supabase/strategy-screen-verification.sql` is a read-only integration check. It independently reconstructs current fixture features from stored scores, checks cutoffs and classification, verifies archived benchmark counts/returns, and reconciles seasonal and price-coverage totals. It also checks the RPC's role permissions.

The existing football-data importer, daily collector and historical benchmark workflow retain their behavior.
