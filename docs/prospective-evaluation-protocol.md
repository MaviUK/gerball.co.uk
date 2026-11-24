# Gerball prospective evaluation protocol (draft, not yet frozen)

Created: 2026-11-23. Proposed prospective start: 2026-12-01 UTC.

Scope update, 2026-11-24: this draft describes the original priced, training-selected betting candidate. The fixed H/D/A form screen now has a separate [recorded research tracker](recorded-screens.md), with immutable inputs and imported outcome reconciliation. That tracker preserves the 1 December boundary and does not approve or activate this priced candidate.

## Purpose
Evaluate whether a preselected, reproducible strategy can demonstrate positive realized net returns without reusing development data for selection.

## Development vs evaluation
- All historical results available through 2026-11-30 are exploratory/development evidence, even when calculated with rolling forward-only selection.
- Prospective results on or after 2026-12-01 may count only if the exact selection algorithm, market universe, eligible leagues, thresholds, odds source, fees, staking and selection timing are committed before the first qualifying kickoff.
- A warning in the UI does **not** technically enforce this separation. No independent prospective record exists yet.
- Any post-start changes create a new version/cohort; do not silently merge the revised strategy with the original.

## Existing candidate method (not yet approved for prospective use)
- Markets: H, D, A, over 2.5, under 2.5.
- Prior form requires at least five prior fixtures for both teams.
- Home/away prior-points-per-game difference cutoff: 0.5.
- Odds window: 1.50–4.00.
- Current historical net P/L convention: winning net = (max(1.01, odds * 0.99) - 1) * 0.98; losing net = -1 unit.
- Training-only strategy selection by highest ROI, with at least two prior seasons and a configurable 30/50/100/200 training-bet minimum.
- **Unresolved before freeze:** exact chosen training threshold and profitable-season filter; fixed league scope; opening vs actually available pre-match prices; how bookmaker fees and slippage are realized; kickoff-time data availability; deduplication and market settlement rules; bet selection/recording timestamp.

## Prospective ledger requirements
Each prediction must be written before kickoff with UTC timestamp, event ID, kickoff, league, teams, market, selection rule version/commit, odds observed, source, fees, intended stake and model input snapshot/hash. Make entries append-only. Record cancellations, voids, unmatched bets and price changes. Settle independently from official final results, preserving corrections.

## Reporting
Report all qualifying selections, including missed/unmatched entries, number settled, unit P/L, ROI, maximum chronological drawdown, odds availability, confidence intervals and comparisons with a predeclared baseline. Include adverse outcomes and uncertainty. Avoid declaring a proven edge from bootstrap positivity or an exploratory ROI alone.

## Gate to begin
A human must approve the exact strategy version, source of executable odds, league/market coverage, thresholds and staking rules. Until then, mark this protocol DRAFT and do not represent post-boundary historical recalculations as untouched prospective testing.
