# Chronological strategy validation

Open `https://gerball.co.uk/#betting` and use **Chronological strategy validation** to inspect a fixed historical rule for Home, Draw, Away, Over 2.5 or Under 2.5.

## One set of settled records

The selected market, league, dates, form threshold, archived-price range and cost assumptions are captured when a run starts. The calculation module builds one ordered list of qualifying, scored fixtures. The sample tables, seasonal tables, equity curve, uncertainty text and CSV use this same list.

This repairs an earlier inconsistency where the detailed records used the selected market, but the summary and seasonal calculations still applied Home-win qualification and settlement.

| Market | Historical form condition | Winning result |
| --- | --- | --- |
| Home | Home prior PPG minus Away prior PPG is at least the threshold | Home goals exceed Away goals |
| Draw | Absolute prior PPG difference is at most the threshold | Equal full-time goals |
| Away | Away prior PPG minus Home prior PPG is at least the threshold | Away goals exceed Home goals |
| Over 2.5 | Absolute prior PPG difference is at least the threshold | At least three total goals |
| Under 2.5 | Absolute prior PPG difference is at least the threshold | At most two total goals |

Both teams need at least five prior games and usable prior PPG values. The existing backend supplies form based on prior distinct match dates in the same league. This repair preserves the frontend's existing direct PPG comparisons and inclusive archived-price limits.

The existing `edgelab_walkforward_market` RPC returns the chosen market's archived price in its legacy `opening_home` field. The name does not mean every run uses a Home-win price. The current frozen Strategy screen and Recorded screens remain separate research workflows.

## Historical samples and costs

The split is chosen from all distinct fixture dates before qualification. The earlier 70% of dates and later 30% are retrospective research slices. Every fixture on the split date belongs to the later slice. Historical results already examined during development do not become an untouched prospective trial through this split.

Raw archived prices determine eligibility. Cost assumptions are then applied:

```text
effective odds = max(1.01, archived odds × (1 − odds reduction))
winning net = (effective odds − 1) × (1 − winning-profit commission)
losing net = −1 unit
ROI = net result / settled bets × 100
```

Results use flat one-unit stakes. Records are ordered by date, Home name, Away name and fixture ID using a deterministic comparator. Drawdown starts from a zero equity peak and is calculated separately for each displayed sample or season. Seasons follow their first appearance in chronological fixture order; the first season provides context for subsequent seasonal rows.

Missing or invalid final scores are excluded from settled results and counted in the run status. Real zero scores and zero PPG values remain valid. A sample with no settled bets has no strike rate, ROI or numeric win-rate interval. Profit uncertainty retains the existing deterministic date-cluster bootstrap and its sample requirements.

## Controls and export

Changing a calculation input clears this panel's previous report and disables export. An older network response cannot restore results after inputs change or replace a newer run. Export also checks the captured settings before downloading.

The CSV contains real UTF-8 BOM and CRLF bytes, includes the selected market in its filename, and repeats the run's league, market, date range, threshold, price range, costs, split date and retrospective analysis basis on each record. Fixture identity, scores' derived win/loss result, prices, net units and sample membership remain auditable. Quoted names and embedded line breaks are escaped; text that resembles a spreadsheet formula is neutralized.

## Verification

```bash
node scripts/check-site.cjs
node --test scripts/check-walkforward-calculations.mjs scripts/check-walkforward-panel.mjs
node scripts/check-live-benchmarks.cjs
```

The pure calculation suite uses independently calculated examples for all five markets. The panel suite executes the actual page handlers and checks table values, equity labels, downloaded CSV bytes, empty results and stale-response protection.

The live benchmark script reuses its existing fetched datasets to run the actual frontend panel. It reconciles the displayed samples, seasonal rows, detailed records and CSV with independent historical settlement for seven league/market benchmarks. This adds no extra API calls to those benchmark runs.

This release changes frontend calculations and verification only. The historical importer, database records, existing backend functions, recording schedules, frozen research rules and 1 December 2026 evaluation boundary retain their existing behavior.
