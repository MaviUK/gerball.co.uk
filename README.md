# Gerball EdgeLab

Static football strategy research dashboard deployed via Netlify.

## Infrastructure

- Frontend: `index.html` on the `main` branch
- Database: Supabase project `hdueztssmsvvxkwqgcnm`
- Tables: `public.matches`, `public.saved_strategies`, `public.data_imports`
- The frontend reads the populated historical match archive. The existing current-season import workflow runs on Mondays and Fridays.
- Daily UK-noon odds collection and public read-only fixture endpoints use separate Supabase functions and tables.

## Fixtures and historical analysis

Open `https://gerball.co.uk/#upcoming` for captured bookmaker prices, team form and historical match comparisons. Prices are daily snapshots with visible timestamps. Match analysis uses stored results, with explicit season, venue, sample size and cutoff dates.

- [Daily odds collection](docs/daily-odds-collector.md)
- [Upcoming fixtures and team matching](docs/upcoming-fixtures.md)
- [Historical fixture analysis](docs/fixture-analysis.md)
- [Historical strategy screening](docs/strategy-screen.md)
- [Recorded screens and result tracking](docs/recorded-screens.md)
- [Data status and coverage](docs/data-status.md)
- [Chronological strategy validation](docs/walkforward-validation.md)

## Source licensing and data provenance
Football-Data.co.uk publishes downloadable football CSVs at https://www.football-data.co.uk/englandm.php. The configured current-season importer runs on Mondays and Fridays at 08:15 UTC. Data status reports the rows and result dates actually stored; the importer does not currently persist a complete run audit. The manual CSV importer remains available for user-provided local research files. Source access and reuse must remain within the project's agreed permissions.

## Current limitations

- CSV uploads and saved strategies are local to each browser, not cloud synced.
- No authentication UI has been configured.
- Progressive staking is highly risky and historical backtests do not establish an edge.

## Deployment
Netlify should deploy the repository's `main` branch with no build command and publish directory `.`.

## Security
Only the Supabase publishable key is used in the frontend. Never commit service-role or secret keys. Public match data is read-only under RLS. Saved strategies have per-user RLS.
