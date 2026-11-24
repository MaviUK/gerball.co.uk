# Research reports and CSV downloads

The Compare tools, team profiles and cross-market Betting lab reports export the settings and results from a completed report. A changed input or a new request clears the earlier report's export readiness. Late responses cannot restore a report after its selection changes.

## Compare and team profiles

The seven table downloads contain the displayed data rows with repeated report context:

| Report | Context retained in the CSV |
| --- | --- |
| Spreadsheet data coverage | League and selected season, or all seasons |
| Opening vs closing odds | League, season, market and the existing return assumptions |
| Referee analysis | League, season and minimum match count |
| Finishing analysis | League, season, venue and minimum match count |
| Corners and cards | League, season, venue and minimum match count |
| Team season history | Team and the scope of the returned league/season history |
| Team fixtures | Team, league, season, cutoff and displayed fixture limit |

Loading, failed and empty reports cannot produce a download. Messages such as “No teams meet the selection criteria” are interface states, not exported observations. A team switch clears the previous team's in-memory fixtures before the new request starts; changing the fixture-count selector cannot resurrect them.

The main team comparison also captures its league, season, dates, venue, metric and minimum sample before requesting data. Its table and status accept only the current request for those settings.

## Cross-market Betting lab

Each comparison accepts its results after every requested league and market finishes successfully. The completed result captures the league scope, requested dates, form threshold, archived odds range, cost assumptions, derived selection settings and report tables. All three CSV downloads use that captured result:

- **Complete forward-test audit:** settings, forward selections, threshold sensitivity, risk ranking, uncertainty, season bootstrap, period stability, consistency comparison, wager overlap, reconciliation and the underlying selected settled wagers.
- **Exact wager differences:** every difference for the selected consistency comparison, including records beyond the visible table's 100-row limit.
- **Validation dashboard:** all displayed threshold assessments with the settings behind the comparison.

The forward audit requires agreement between the reported selection totals and its underlying wagers. The CSV retains the reported and reconciled counts and net units, making that check reproducible from the downloaded records. The section-based audit has a consistent column count; section headers describe the fields used in each section.

Native fixture IDs are included when the historical query supplies them. Each wager also has an explicit composite fixture key built from league, date, home team and away team, plus a wager key that adds the market. Both use JSON arrays to preserve unambiguous field boundaries. A missing database ID remains blank.

Changing a base calculation input invalidates the comparison. Derived selectors can recalculate the accepted historical comparison locally; the captured result is refreshed to match those displayed selections. An incomplete or failed rerun cannot make the preceding run's download available under new settings.

## File format

`assets/research-csv.js` writes a real UTF-8 byte-order mark and CRLF row separators. It escapes commas, quotes and embedded line breaks and rejects inconsistent row widths. Formula-like text is neutralized, including text with leading whitespace. Legitimate negative numbers and percentages remain numeric-looking values rather than apostrophe-prefixed text.

Historical qualification, settlement and profit calculations retain their existing definitions. The draft prospective candidate specification and its approval state remain separate from these report downloads.

## Research query performance

Live browser and deployment verification also exposed statement timeouts in the existing data-coverage, team-history and odds-movement RPCs. Their optimized query plans retain the same arguments, result fields, access rules and calculations:

- Coverage uses mutually exclusive branches for the optional league and season filters, allowing each selected scope to use the existing indexes. It materializes the selected source rows once before counting the same 13 fields.
- Team history first identifies the requested team's league and season partitions, then calculates complete standings within those partitions. Other teams in each relevant season still contribute to the table and rank.
- Odds movement separates its selected-season and all-season reads and materializes the parsed opening and closing prices once per fixture. Its existing price parsing, movement buckets, settlement and arithmetic are preserved.

All three functions remain stable security-invoker functions with their existing grants and search path. No timeout limit, archive record, importer or collection schedule is changed. Referee, finishing and discipline queries retain their existing definitions after bounded execution checks.

## Verification

```bash
node scripts/check-site.cjs
node --test scripts/check-research-report-state.mjs scripts/check-research-audit.mjs
node scripts/check-live-research-reports.mjs
```

The handler suite runs the actual page functions against delayed, failed and reversed-order responses and inspects their downloaded CSV bytes. The audit module checks use independently settled wagers and confirm that immutable captured records, summary counts and net returns agree. The public live checks reconcile coverage denominators with the archive and verify the five research RPCs and known-team history. Existing walk-forward and live historical benchmark checks continue to run in CI.
