# Gerball EdgeLab

Static football strategy research dashboard deployed via Netlify.

## Infrastructure
- Frontend: `index.html` on the `main` branch
- Database: Supabase project `hdueztssmsvvxkwqgcnm`
- Tables: `public.matches`, `public.saved_strategies`, `public.data_imports`
- The frontend can read match data from Supabase. No automatic import has been activated.

## Source licensing and data provenance
Football-Data.co.uk publishes downloadable English football CSVs at https://www.football-data.co.uk/englandm.php.
Do not schedule automated retrieval, redistribute their datasets, or expose their rows through the public database without confirming permission and the appropriate licence. The manual CSV importer is available for user-provided files. A licensed ingestion pipeline can be added after rights are confirmed.

## Current limitations
- CSV uploads and saved strategies are local to each browser, not cloud synced.
- The cloud match table is empty until an authorised importer populates it.
- No authentication UI has been configured.
- Progressive staking is highly risky and historical backtests do not establish an edge.

## Deployment
Netlify should deploy the repository's `main` branch with no build command and publish directory `.`.

## Security
Only the Supabase publishable key is used in the frontend. Never commit service-role or secret keys. Public match data is read-only under RLS. Saved strategies have per-user RLS.
